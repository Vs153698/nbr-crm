import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { PermissionCode } from '@nbr/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { ForbiddenError, UnauthorisedError } from '../common/errors';
import { setActor, type Actor } from '../common/request-context';
import type { Database } from '../database/client';
import { DB } from '../database/database.tokens';
import * as schema from '../database/schema';
import { CacheService } from '../redis/cache.service';
import {
  ALLOW_PASSWORD_CHANGE_KEY,
  PERMISSIONS_KEY,
  PERMISSION_MODE_KEY,
  PUBLIC_KEY,
} from './auth.decorators';
import { PermissionsService } from './permissions.service';

export interface AccessTokenPayload {
  /** user id */
  sub: string;
  /** session id — lets a single session be revoked without a password change */
  sid: string;
  /** role id */
  rid: string;
  /** token version — bumped on password/role change to kill live tokens */
  tv: number;
  /** must change password */
  mcp: boolean;
}

/**
 * The single authentication + authorisation gate.
 *
 * Registered globally, so the default for any route is *denied*. A route
 * becomes reachable only by explicitly opting out with `@Public()`, and
 * reachable-with-privilege only by declaring `@RequirePermissions(...)`.
 * Fail-closed by construction.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly permissionsService: PermissionsService,
    private readonly cache: CacheService,
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const token = extractToken(request);
    if (!token) throw new UnauthorisedError();

    const payload = await this.verify(token);
    const actor = await this.buildActor(payload);

    // Forced password change (§ "forced password change on first login").
    // Every route except the change-password endpoint itself is closed until
    // the user actually rotates the credential.
    if (payload.mcp) {
      const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_PASSWORD_CHANGE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (!allowed) {
        throw new ForbiddenError('Set a new password before continuing.', {
          reason: 'PASSWORD_CHANGE_REQUIRED',
        });
      }
    }

    setActor(actor);
    this.assertPermissions(context, actor);
    return true;
  }

  private async verify(token: string): Promise<AccessTokenPayload> {
    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.env.JWT_ACCESS_SECRET,
      });
    } catch {
      // Deliberately does not distinguish expired from malformed to the
      // caller; the client just refreshes and retries either way.
      throw new UnauthorisedError('TOKEN_INVALID', 'Your session has expired. Please sign in again.');
    }

    // Revocation deny-list: makes "log this device out" immediate rather than
    // waiting for the 15-minute access token to expire.
    if (await this.cache.isSessionRevoked(payload.sid)) {
      throw new UnauthorisedError('SESSION_REVOKED', 'This session was signed out. Please sign in again.');
    }

    return payload;
  }

  private async buildActor(payload: AccessTokenPayload): Promise<Actor> {
    const [user] = await this.db
      .select({
        id: schema.users.id,
        fullName: schema.users.fullName,
        email: schema.users.email,
        roleId: schema.users.roleId,
        status: schema.users.status,
        tokenVersion: schema.users.tokenVersion,
      })
      .from(schema.users)
      .where(and(eq(schema.users.id, payload.sub), isNull(schema.users.deletedAt)))
      .limit(1);

    if (!user) throw new UnauthorisedError('USER_NOT_FOUND', 'Your account is no longer available.');

    if (user.status !== 'active') {
      throw new ForbiddenError('Your account has been deactivated. Contact an administrator.');
    }

    // Token version mismatch = the password or role changed after this token
    // was issued. §"force logout on role change".
    if (user.tokenVersion !== payload.tv) {
      throw new UnauthorisedError(
        'TOKEN_STALE',
        'Your access has changed. Please sign in again.',
      );
    }

    const role = await this.permissionsService.resolveRole(user.roleId);
    if (!role) throw new ForbiddenError('Your role no longer exists. Contact an administrator.');

    return {
      userId: user.id,
      fullName: user.fullName,
      email: user.email,
      roleId: role.id,
      roleCode: role.code,
      isSuperAdmin: role.isSuperAdmin,
      permissions: new Set(role.permissions),
      sessionId: payload.sid,
    };
  }

  private assertPermissions(context: ExecutionContext, actor: Actor): void {
    const required = this.reflector.getAllAndOverride<PermissionCode[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return;
    if (actor.isSuperAdmin) return;

    const mode = this.reflector.getAllAndOverride<'any' | 'all'>(PERMISSION_MODE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const satisfied =
      mode === 'any'
        ? required.some((p) => actor.permissions.has(p))
        : required.every((p) => actor.permissions.has(p));

    if (!satisfied) {
      const missing = required.filter((p) => !actor.permissions.has(p));
      throw new ForbiddenError(
        'You do not have permission to do this. Ask an administrator if you need access.',
        { required: missing },
      );
    }
  }
}

function extractToken(request: FastifyRequest): string | null {
  // Cookie first: the web app uses an HttpOnly cookie, which is not readable
  // by JavaScript and therefore not stealable by an XSS payload.
  const cookieToken = (request as FastifyRequest & { cookies?: Record<string, string> }).cookies
    ?.nbr_access;
  if (cookieToken) return cookieToken;

  // Bearer header for API clients and integration tests.
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);

  return null;
}
