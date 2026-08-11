import { Inject, Injectable } from '@nestjs/common';
import {
  ACTION_LABELS,
  ALL_PERMISSIONS,
  MODULE_ACTIONS,
  MODULE_LABELS,
  type PermissionCode,
} from '@nbr/shared';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { AUDIT, AuditService, buildDiff } from '../audit/audit.service';
import { randomToken } from '../common/crypto';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../common/errors';
import { requireActor } from '../common/request-context';
import { AuthService } from '../auth/auth.service';
import { MailService } from '../mail/mail.service';
import { PermissionsService } from '../auth/permissions.service';
import type { Database } from '../database/client';
import { DB } from '../database/database.tokens';
import * as schema from '../database/schema';

export interface UserRow {
  readonly id: string;
  readonly fullName: string;
  readonly email: string;
  readonly employeeCode: string | null;
  readonly designation: string | null;
  readonly roleId: string;
  readonly roleName: string;
  readonly status: string;
  readonly lastLoginAt: string | null;
  readonly mustChangePassword: boolean;
  readonly isLocked: boolean;
}

export interface RoleRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly isSystem: boolean;
  readonly isProtected: boolean;
  readonly isSuperAdmin: boolean;
  readonly userCount: number;
  readonly permissions: PermissionCode[];
}

/**
 * Users & Roles administration (W-28, P1-04).
 *
 * The permission grid is fully configurable: an Admin can create a role and
 * toggle any module × action cell without a deploy. The guards read from these
 * same rows, so the screen and the enforcement can never drift apart.
 */
@Injectable()
export class UsersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly auth: AuthService,
    private readonly permissions: PermissionsService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  async listUsers(): Promise<UserRow[]> {
    const rows = await this.db
      .select({
        id: schema.users.id,
        fullName: schema.users.fullName,
        email: schema.users.email,
        employeeCode: schema.users.employeeCode,
        designation: schema.users.designation,
        roleId: schema.users.roleId,
        roleName: schema.roles.name,
        status: schema.users.status,
        lastLoginAt: schema.users.lastLoginAt,
        mustChangePassword: schema.users.mustChangePassword,
        lockedUntil: schema.users.lockedUntil,
      })
      .from(schema.users)
      .innerJoin(schema.roles, eq(schema.users.roleId, schema.roles.id))
      .where(isNull(schema.users.deletedAt))
      .orderBy(asc(schema.users.fullName));

    return rows.map((row) => ({
      id: row.id,
      fullName: row.fullName,
      email: row.email,
      employeeCode: row.employeeCode,
      designation: row.designation,
      roleId: row.roleId,
      roleName: row.roleName,
      status: row.status,
      lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
      mustChangePassword: row.mustChangePassword,
      isLocked: Boolean(row.lockedUntil && row.lockedUntil > new Date()),
    }));
  }

  async createUser(input: {
    fullName: string;
    email: string;
    employeeCode?: string;
    phone?: string;
    roleId: string;
    designation?: string;
    password?: string;
    /** Skip the joining email — the caller is sending its own. */
    suppressEmail?: boolean;
  }): Promise<{ id: string; temporaryPassword: string | null; credentialsEmailed: boolean }> {
    const [role] = await this.db
      .select({
        id: schema.roles.id,
        name: schema.roles.name,
        isSuperAdmin: schema.roles.isSuperAdmin,
      })
      .from(schema.roles)
      .where(eq(schema.roles.id, input.roleId))
      .limit(1);

    if (!role) throw new ValidationError({ roleId: ['That role does not exist.'] });

    // Only an existing Super Admin can mint another one — otherwise any Admin
    // with user-create rights could escalate themselves.
    const actor = requireActor();
    if (role.isSuperAdmin && !actor.isSuperAdmin) {
      throw new ForbiddenError('Only a Super Admin can create another Super Admin.');
    }

    // A generated password is never shown twice and forces rotation on first
    // login, so it is a bootstrap credential rather than a real one.
    const temporaryPassword = input.password ?? `Nbr-${randomToken(9)}`;
    const passwordHash = await this.auth.hashPassword(temporaryPassword);

    const [user] = await this.db
      .insert(schema.users)
      .values({
        fullName: input.fullName,
        email: input.email,
        employeeCode: input.employeeCode ?? null,
        phone: input.phone ?? null,
        designation: input.designation ?? null,
        roleId: input.roleId,
        passwordHash,
        mustChangePassword: true,
        status: 'active',
      })
      .returning({ id: schema.users.id });

    await this.audit.record({
      action: AUDIT.USER_CREATED,
      entityType: 'user',
      entityId: user!.id,
      entityLabel: `${input.fullName} <${input.email}>`,
      meta: { roleId: input.roleId },
    });

    /**
     * Send the credentials, when this system generated them.
     *
     * A caller-supplied password is theirs to communicate; a generated one
     * exists nowhere else, so an account created without this mail going out is
     * an account nobody can reach. Whether it was sent is returned so the
     * screen can show the password once and say to pass it on by hand.
     */
    const generated = !input.password;
    const credentialsEmailed =
      generated && !input.suppressEmail
        ? await this.mail.sendAccountCredentials({
            to: input.email,
            fullName: input.fullName,
            temporaryPassword,
            roleName: role.name,
          })
        : false;

    return {
      id: user!.id,
      temporaryPassword: generated ? temporaryPassword : null,
      credentialsEmailed,
    };
  }

  async updateUser(
    userId: string,
    input: {
      fullName?: string;
      employeeCode?: string;
      phone?: string;
      roleId?: string;
      designation?: string;
      status?: string;
    },
  ): Promise<void> {
    const actor = requireActor();

    const [existing] = await this.db
      .select()
      .from(schema.users)
      .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
      .limit(1);

    if (!existing) throw new NotFoundError('User');

    // Deactivating or demoting yourself is almost always a mistake, and in the
    // Super Admin case it can lock the organisation out of its own system.
    if (userId === actor.userId && (input.status === 'deactivated' || input.roleId)) {
      throw new ForbiddenError('You cannot change your own role or deactivate your own account.');
    }

    const roleChanged = Boolean(input.roleId && input.roleId !== existing.roleId);

    await this.db.update(schema.users).set(input).where(eq(schema.users.id, userId));

    // §1 "force logout on role change" — a user whose permissions just changed
    // must not keep operating on a token minted under the old ones.
    if (roleChanged || input.status === 'deactivated' || input.status === 'suspended') {
      await this.auth.revokeAllSessions(userId, roleChanged ? 'role_changed' : 'account_disabled');
    }

    await this.audit.record({
      action: input.status === 'deactivated' ? AUDIT.USER_DEACTIVATED : AUDIT.USER_UPDATED,
      entityType: 'user',
      entityId: userId,
      entityLabel: `${existing.fullName} <${existing.email}>`,
      changes: buildDiff(existing as unknown as Record<string, unknown>, input),
    });
  }

  /** Force-logout every device for a user (W-28 "session revocation"). */
  async revokeSessions(userId: string): Promise<void> {
    await this.auth.revokeAllSessions(userId, 'admin_revoked');
    await this.audit.record({
      action: AUDIT.SESSION_REVOKED,
      entityType: 'user',
      entityId: userId,
    });
  }

  // ── Roles ────────────────────────────────────────────────────────────────

  async listRoles(): Promise<RoleRow[]> {
    const roles = await this.db
      .select({
        id: schema.roles.id,
        code: schema.roles.code,
        name: schema.roles.name,
        description: schema.roles.description,
        isSystem: schema.roles.isSystem,
        isProtected: schema.roles.isProtected,
        isSuperAdmin: schema.roles.isSuperAdmin,
      })
      .from(schema.roles)
      .where(isNull(schema.roles.deletedAt))
      .orderBy(asc(schema.roles.name));

    // Counted with a GROUP BY rather than a correlated subquery inside a raw
    // `sql` fragment — Drizzle does not correlate the outer table reference
    // there, so the subquery silently returns zero for every row.
    const userCounts = await this.db
      .select({
        roleId: schema.users.roleId,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.users)
      .where(isNull(schema.users.deletedAt))
      .groupBy(schema.users.roleId);

    const countByRole = new Map(userCounts.map((row) => [row.roleId, row.count]));

    const grants = await this.db
      .select({
        roleId: schema.rolePermissions.roleId,
        code: schema.permissions.code,
      })
      .from(schema.rolePermissions)
      .innerJoin(schema.permissions, eq(schema.rolePermissions.permissionId, schema.permissions.id));

    const byRole = new Map<string, PermissionCode[]>();
    for (const grant of grants) {
      const list = byRole.get(grant.roleId) ?? [];
      list.push(grant.code as PermissionCode);
      byRole.set(grant.roleId, list);
    }

    return roles.map((role) => ({
      ...role,
      userCount: countByRole.get(role.id) ?? 0,
      // Super Admin holds everything implicitly — report it as such rather than
      // as an empty grid, which would read as "no access".
      permissions: role.isSuperAdmin ? [...ALL_PERMISSIONS] : (byRole.get(role.id) ?? []),
    }));
  }

  /** The module × action grid the Users & Roles screen renders. */
  getPermissionCatalogue() {
    return Object.entries(MODULE_ACTIONS).map(([module, actions]) => ({
      module,
      label: MODULE_LABELS[module as keyof typeof MODULE_LABELS],
      actions: actions.map((action) => ({
        action,
        label: ACTION_LABELS[action],
        code: `${module}:${action}`,
      })),
    }));
  }

  async upsertRole(
    roleId: string | null,
    input: { name: string; description?: string; permissions: string[] },
  ): Promise<{ id: string }> {
    // Reject unknown permission codes rather than silently dropping them — a
    // typo would otherwise present as "the toggle didn't save".
    const unknown = input.permissions.filter(
      (code) => !ALL_PERMISSIONS.includes(code as PermissionCode),
    );
    if (unknown.length > 0) {
      throw new ValidationError({ permissions: [`Unknown permissions: ${unknown.join(', ')}`] });
    }

    return this.db.transaction(async (tx) => {
      let id = roleId;

      if (id) {
        const [existing] = await tx
          .select()
          .from(schema.roles)
          .where(eq(schema.roles.id, id))
          .limit(1);

        if (!existing) throw new NotFoundError('Role');
        if (existing.isProtected) {
          throw new ConflictError(
            'ROLE_PROTECTED',
            'The Super Admin role cannot be edited — that is what guarantees the system can always be administered.',
          );
        }

        await tx
          .update(schema.roles)
          .set({ name: input.name, description: input.description ?? null })
          .where(eq(schema.roles.id, id));
      } else {
        const code = input.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_|_$/g, '');

        const [created] = await tx
          .insert(schema.roles)
          .values({ code, name: input.name, description: input.description ?? null })
          .returning({ id: schema.roles.id });
        id = created!.id;
      }

      // Replace the whole grid rather than diffing: the screen PUTs exactly
      // what the Admin saw, so the saved state always matches the UI state.
      await tx.delete(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, id));

      if (input.permissions.length > 0) {
        const permissionRows = await tx
          .select({ id: schema.permissions.id, code: schema.permissions.code })
          .from(schema.permissions);

        const idByCode = new Map(permissionRows.map((p) => [p.code, p.id]));
        const grants = input.permissions
          .map((code) => idByCode.get(code))
          .filter((permissionId): permissionId is string => Boolean(permissionId))
          .map((permissionId) => ({ roleId: id!, permissionId }));

        if (grants.length > 0) await tx.insert(schema.rolePermissions).values(grants);
      }

      await this.audit.record(
        {
          action: roleId ? AUDIT.ROLE_PERMISSIONS_CHANGED : AUDIT.ROLE_CREATED,
          entityType: 'role',
          entityId: id,
          entityLabel: input.name,
          meta: { permissionCount: input.permissions.length },
        },
        tx,
      );

      return { id: id! };
    });
  }

  /**
   * Called after any grid change. Without this, the permission cache would
   * serve the old grid for up to five minutes — a revocation that doesn't take
   * effect is a security problem, not a caching nuance.
   */
  async invalidatePermissionCache(): Promise<void> {
    await this.permissions.invalidate();
  }
}
