import { Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { SessionUser } from '@nbr/shared';
import * as argon2 from 'argon2';
import { addMinutes, addMilliseconds } from 'date-fns';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { AUDIT, AuditService } from '../audit/audit.service';
import { randomToken, sha256 } from '../common/crypto';
import { RateLimitedError, UnauthorisedError, ValidationError } from '../common/errors';
import { getContext } from '../common/request-context';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import type { Database } from '../database/client';
import { DB } from '../database/database.tokens';
import * as schema from '../database/schema';
import { CacheService, CacheTag } from '../redis/cache.service';
import type { AccessTokenPayload } from './auth.guard';
import { PermissionsService } from './permissions.service';

export interface TokenPair {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly accessExpiresAt: Date;
  readonly refreshExpiresAt: Date;
}

export interface LoginResult extends TokenPair {
  readonly user: SessionUser;
}

/**
 * Authentication (§1, P1-03).
 *
 * Hardening decisions worth stating, because each one closes a specific attack:
 *
 *  • argon2id at OWASP parameters — GPU-resistant, unlike bcrypt at low cost.
 *  • Failed-login counting is per *account* in the database, so it survives a
 *    Redis outage and cannot be reset by rotating source IPs.
 *  • Login responses are identical for "no such user" and "wrong password",
 *    and an argon2 verify is performed against a dummy hash in the no-user
 *    case, so response timing does not enumerate valid accounts.
 *  • Refresh tokens are rotated on every use and the old one is marked
 *    replaced; reusing a rotated token revokes the whole chain, which is what
 *    detects a stolen refresh token.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  /**
   * A real argon2id hash of a random value, verified against when the account
   * does not exist. Without this, "no such user" returns in ~1ms and "wrong
   * password" in ~50ms — a trivially observable account oracle.
   */
  private dummyHash: string | null = null;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly jwt: JwtService,
    private readonly cache: CacheService,
    private readonly permissionsService: PermissionsService,
    private readonly audit: AuditService,
  ) {}

  private get argonOptions(): argon2.Options {
    return {
      type: argon2.argon2id,
      memoryCost: 19_456, // 19 MiB — OWASP minimum for argon2id
      timeCost: 2,
      parallelism: 1,
    };
  }

  async hashPassword(plain: string): Promise<string> {
    return argon2.hash(plain, this.argonOptions);
  }

  private async getDummyHash(): Promise<string> {
    this.dummyHash ??= await argon2.hash(randomToken(24), this.argonOptions);
    return this.dummyHash;
  }

  async login(identifier: string, password: string, rememberMe: boolean): Promise<LoginResult> {
    const context = getContext();
    const ip = context?.ipAddress ?? null;

    // Per-IP throttle in front of the per-account lockout, so one attacker
    // cannot lock out every account in the organisation from a single host.
    await this.assertIpNotThrottled(ip);

    const normalised = identifier.trim().toLowerCase();
    const [user] = await this.db
      .select()
      .from(schema.users)
      .where(
        and(
          or(
            eq(sql`lower(${schema.users.email})`, normalised),
            eq(sql`lower(${schema.users.employeeCode})`, normalised),
          ),
          isNull(schema.users.deletedAt),
        ),
      )
      .limit(1);

    if (!user) {
      // Burn the same CPU we would have burned on a real verify.
      await argon2.verify(await this.getDummyHash(), password).catch(() => false);
      await this.recordAttempt(identifier, null, false, 'user_not_found');
      throw new UnauthorisedError('INVALID_CREDENTIALS', 'Incorrect email or password.');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      await this.recordAttempt(identifier, user.id, false, 'account_locked');
      throw new RateLimitedError(
        minutes * 60,
        `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      );
    }

    if (user.status !== 'active') {
      await this.recordAttempt(identifier, user.id, false, 'account_inactive');
      throw new UnauthorisedError(
        'ACCOUNT_INACTIVE',
        'This account has been deactivated. Contact an administrator.',
      );
    }

    const passwordValid = await argon2.verify(user.passwordHash, password).catch(() => false);

    if (!passwordValid) {
      await this.registerFailedAttempt(user.id, user.failedLoginCount);
      await this.recordAttempt(identifier, user.id, false, 'bad_password');
      throw new UnauthorisedError('INVALID_CREDENTIALS', 'Incorrect email or password.');
    }

    // Success — clear the counters.
    await this.db
      .update(schema.users)
      .set({
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        lastLoginIp: ip,
      })
      .where(eq(schema.users.id, user.id));

    await this.recordAttempt(identifier, user.id, true);

    const tokens = await this.issueTokens(user.id, user.roleId, user.tokenVersion, user.mustChangePassword, rememberMe);
    const sessionUser = await this.buildSessionUser(user.id, tokens.accessExpiresAt);

    await this.audit.record({
      action: AUDIT.LOGIN_SUCCESS,
      entityType: 'user',
      entityId: user.id,
      entityLabel: user.fullName,
      meta: { rememberMe },
    });

    return { ...tokens, user: sessionUser };
  }

  private async assertIpNotThrottled(ip: string | null): Promise<void> {
    if (!ip) return;
    const attempts = await this.cache.increment(`login-ip:${ip}`, 60);
    // 20/min from one IP is far above any human, well below a shared office NAT
    // running into it during normal use.
    if (attempts > 20) {
      const retryAfter = await this.cache.ttl(`login-ip:${ip}`);
      throw new RateLimitedError(retryAfter > 0 ? retryAfter : 60);
    }
  }

  private async registerFailedAttempt(userId: string, currentCount: number): Promise<void> {
    const nextCount = currentCount + 1;
    const shouldLock = nextCount >= this.env.LOGIN_MAX_ATTEMPTS;

    await this.db
      .update(schema.users)
      .set({
        failedLoginCount: nextCount,
        lockedUntil: shouldLock ? addMinutes(new Date(), this.env.LOGIN_LOCKOUT_MINUTES) : null,
      })
      .where(eq(schema.users.id, userId));

    if (shouldLock) {
      this.logger.warn(`Account ${userId} locked after ${nextCount} failed attempts`);
    }
  }

  private async recordAttempt(
    identifier: string,
    userId: string | null,
    succeeded: boolean,
    failureReason?: string,
  ): Promise<void> {
    const context = getContext();
    await this.db.insert(schema.loginAttempts).values({
      identifier: identifier.slice(0, 255),
      userId,
      succeeded,
      failureReason: failureReason ?? null,
      ipAddress: context?.ipAddress ?? null,
      userAgent: context?.userAgent ?? null,
    });
  }

  async issueTokens(
    userId: string,
    roleId: string,
    tokenVersion: number,
    mustChangePassword: boolean,
    rememberMe: boolean,
  ): Promise<TokenPair> {
    const sessionId = crypto.randomUUID();

    const payload: AccessTokenPayload = {
      sub: userId,
      sid: sessionId,
      rid: roleId,
      tv: tokenVersion,
      mcp: mustChangePassword,
    };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.env.JWT_ACCESS_SECRET,
      // Seconds rather than the "15m" string: jsonwebtoken's string form is a
      // narrow literal type, and a number is unambiguous either way.
      expiresIn: Math.floor(parseDuration(this.env.JWT_ACCESS_TTL) / 1000),
    });

    // The refresh token is opaque: a random string whose SHA-256 is stored.
    // A JWT here would still be replayable after a database-level revocation.
    const refreshToken = randomToken(48);
    const refreshTtlMs = rememberMe
      ? parseDuration(this.env.JWT_REFRESH_TTL)
      : // Without "remember me", the refresh window is the idle timeout: close
        // the laptop lid for an hour and you sign in again.
        this.env.SESSION_IDLE_TIMEOUT_MINUTES * 60_000;

    const refreshExpiresAt = addMilliseconds(new Date(), refreshTtlMs);
    const context = getContext();

    await this.db.insert(schema.sessions).values({
      id: sessionId,
      userId,
      refreshTokenHash: sha256(refreshToken),
      userAgent: context?.userAgent ?? null,
      ipAddress: context?.ipAddress ?? null,
      expiresAt: refreshExpiresAt,
    });

    return {
      accessToken,
      refreshToken,
      accessExpiresAt: addMilliseconds(new Date(), parseDuration(this.env.JWT_ACCESS_TTL)),
      refreshExpiresAt,
    };
  }

  /**
   * Rotate a refresh token.
   *
   * The old token is marked as replaced rather than deleted, so presenting it
   * again is detectable. That reuse means one of the two holders is an
   * attacker — we cannot tell which, so the entire session chain is revoked and
   * both are forced to re-authenticate.
   */
  async refresh(refreshToken: string): Promise<TokenPair> {
    const tokenHash = sha256(refreshToken);

    const [session] = await this.db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.refreshTokenHash, tokenHash))
      .limit(1);

    if (!session) throw new UnauthorisedError('REFRESH_INVALID', 'Please sign in again.');

    if (session.replacedBySessionId || session.revokedAt) {
      this.logger.warn(
        `Refresh token reuse detected for user ${session.userId} (session ${session.id}) — revoking chain`,
      );
      await this.revokeAllSessions(session.userId, 'token_reuse_detected');
      throw new UnauthorisedError(
        'REFRESH_REUSED',
        'For your security this session was ended. Please sign in again.',
      );
    }

    if (session.expiresAt <= new Date()) {
      throw new UnauthorisedError('REFRESH_EXPIRED', 'Your session has expired. Please sign in again.');
    }

    // Idle timeout (§1): measured from last activity, not from issue time.
    const idleCutoff = addMinutes(session.lastSeenAt, this.env.SESSION_IDLE_TIMEOUT_MINUTES);
    if (idleCutoff <= new Date()) {
      await this.revokeSession(session.id, 'idle_timeout');
      throw new UnauthorisedError('SESSION_IDLE_TIMEOUT', 'You were signed out due to inactivity.');
    }

    const [user] = await this.db
      .select()
      .from(schema.users)
      .where(and(eq(schema.users.id, session.userId), isNull(schema.users.deletedAt)))
      .limit(1);

    if (!user || user.status !== 'active') {
      throw new UnauthorisedError('ACCOUNT_INACTIVE', 'This account is no longer active.');
    }

    const tokens = await this.issueTokens(
      user.id,
      user.roleId,
      user.tokenVersion,
      user.mustChangePassword,
      true,
    );

    // Link the chain and close the old link.
    const newSessionId = (await this.jwt.decode(tokens.accessToken)) as AccessTokenPayload;
    await this.db
      .update(schema.sessions)
      .set({ replacedBySessionId: newSessionId.sid, lastSeenAt: new Date() })
      .where(eq(schema.sessions.id, session.id));

    return tokens;
  }

  async logout(sessionId: string, userId: string): Promise<void> {
    await this.revokeSession(sessionId, 'logout');
    await this.audit.record({
      action: AUDIT.LOGOUT,
      entityType: 'user',
      entityId: userId,
    });
  }

  async revokeSession(sessionId: string, reason: string): Promise<void> {
    await this.db
      .update(schema.sessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(eq(schema.sessions.id, sessionId));

    // Also deny-list in Redis so the still-valid access token stops working
    // immediately rather than at its 15-minute expiry.
    await this.cache.revokeSession(sessionId, parseDuration(this.env.JWT_ACCESS_TTL) / 1000 + 60);
  }

  /** Used on password change, role change, and refresh-token reuse. */
  async revokeAllSessions(userId: string, reason: string): Promise<void> {
    const live = await this.db
      .select({ id: schema.sessions.id })
      .from(schema.sessions)
      .where(and(eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt)));

    await this.db
      .update(schema.sessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt)));

    const ttl = parseDuration(this.env.JWT_ACCESS_TTL) / 1000 + 60;
    await Promise.all(live.map((s) => this.cache.revokeSession(s.id, ttl)));

    // Bumping the token version invalidates every access token ever issued to
    // this user, including ones from sessions we may not have rows for.
    await this.db
      .update(schema.users)
      .set({ tokenVersion: sql`${schema.users.tokenVersion} + 1` })
      .where(eq(schema.users.id, userId));

    await this.cache.invalidateTags(CacheTag.user(userId));
  }

  /** Marks the session as active — feeds the idle-timeout calculation. */
  async touchSession(sessionId: string): Promise<void> {
    await this.db
      .update(schema.sessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(schema.sessions.id, sessionId));
  }

  // ── Password reset (§1 Forgot Password) ──────────────────────────────────

  /**
   * Always resolves successfully, whether or not the address exists.
   * Returning "no such account" here would turn the reset form into an account
   * enumeration endpoint.
   */
  async requestPasswordReset(email: string): Promise<{ token: string; userId: string } | null> {
    const [user] = await this.db
      .select({ id: schema.users.id, status: schema.users.status })
      .from(schema.users)
      .where(and(eq(sql`lower(${schema.users.email})`, email.toLowerCase()), isNull(schema.users.deletedAt)))
      .limit(1);

    if (!user || user.status !== 'active') return null;

    // One live reset per account: issuing a second invalidates the first.
    await this.db
      .update(schema.passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(schema.passwordResetTokens.userId, user.id),
          isNull(schema.passwordResetTokens.usedAt),
        ),
      );

    const token = randomToken(32);
    const context = getContext();

    await this.db.insert(schema.passwordResetTokens).values({
      userId: user.id,
      tokenHash: sha256(token),
      expiresAt: addMinutes(new Date(), 30),
      requestedIp: context?.ipAddress ?? null,
    });

    await this.audit.record({
      action: AUDIT.PASSWORD_RESET_REQUESTED,
      entityType: 'user',
      entityId: user.id,
    });

    return { token, userId: user.id };
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const [row] = await this.db
      .select()
      .from(schema.passwordResetTokens)
      .where(eq(schema.passwordResetTokens.tokenHash, sha256(token)))
      .limit(1);

    if (!row || row.usedAt || row.expiresAt <= new Date()) {
      throw new ValidationError({
        token: ['This reset link is invalid or has expired. Request a new one.'],
      });
    }

    const passwordHash = await this.hashPassword(newPassword);

    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.users)
        .set({ passwordHash, mustChangePassword: false, passwordChangedAt: new Date() })
        .where(eq(schema.users.id, row.userId));

      await tx
        .update(schema.passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(eq(schema.passwordResetTokens.id, row.id));
    });

    // Anyone still holding a session on this account may be the reason the
    // password is being reset. End all of them.
    await this.revokeAllSessions(row.userId, 'password_reset');

    await this.audit.record({
      action: AUDIT.PASSWORD_RESET_COMPLETED,
      entityType: 'user',
      entityId: row.userId,
    });
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const [user] = await this.db
      .select({ passwordHash: schema.users.passwordHash })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    if (!user) throw new UnauthorisedError();

    const valid = await argon2.verify(user.passwordHash, currentPassword).catch(() => false);
    if (!valid) {
      throw new ValidationError({ currentPassword: ['That is not your current password.'] });
    }

    const sameAsOld = await argon2.verify(user.passwordHash, newPassword).catch(() => false);
    if (sameAsOld) {
      throw new ValidationError({ password: ['Choose a password you have not used before.'] });
    }

    await this.db
      .update(schema.users)
      .set({
        passwordHash: await this.hashPassword(newPassword),
        mustChangePassword: false,
        passwordChangedAt: new Date(),
      })
      .where(eq(schema.users.id, userId));

    await this.revokeAllSessions(userId, 'password_changed');

    await this.audit.record({
      action: AUDIT.PASSWORD_CHANGED,
      entityType: 'user',
      entityId: userId,
    });
  }

  async buildSessionUser(userId: string, sessionExpiresAt: Date): Promise<SessionUser> {
    const [user] = await this.db
      .select({
        id: schema.users.id,
        fullName: schema.users.fullName,
        email: schema.users.email,
        employeeCode: schema.users.employeeCode,
        designation: schema.users.designation,
        avatarKey: schema.users.avatarKey,
        roleId: schema.users.roleId,
        mustChangePassword: schema.users.mustChangePassword,
        lastLoginAt: schema.users.lastLoginAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    if (!user) throw new UnauthorisedError();

    const role = await this.permissionsService.resolveRole(user.roleId);
    if (!role) throw new UnauthorisedError('ROLE_MISSING', 'Your role no longer exists.');

    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      employeeCode: user.employeeCode,
      designation: user.designation,
      avatarUrl: null,
      role: {
        id: role.id,
        code: role.code,
        name: role.name,
        isSuperAdmin: role.isSuperAdmin,
      },
      permissions: role.permissions,
      mustChangePassword: user.mustChangePassword,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      sessionExpiresAt: sessionExpiresAt.toISOString(),
    };
  }
}

/** Parse "15m", "7d", "30s" into milliseconds. */
export function parseDuration(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value.trim());
  if (!match) throw new Error(`Invalid duration: "${value}" (expected e.g. 15m, 7d)`);
  const amount = Number(match[1]);
  const unit = match[2] as 's' | 'm' | 'h' | 'd';
  const multipliers = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;
  return amount * multipliers[unit];
}
