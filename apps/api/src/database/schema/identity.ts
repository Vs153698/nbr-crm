import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, primaryId, timestamps } from './_shared';

/**
 * ── Identity & access (§1, §25) ──────────────────────────────────────────────
 * Roles and permissions are rows, not code, so an Admin can build a new role
 * from the Users & Roles screen without a deploy (P1-04).
 */

export const permissions = pgTable(
  'permissions',
  {
    id: primaryId(),
    /** `module:action`, e.g. `payments:export`. */
    code: varchar('code', { length: 60 }).notNull(),
    module: varchar('module', { length: 40 }).notNull(),
    action: varchar('action', { length: 40 }).notNull(),
    description: text('description'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('permissions_code_uq').on(t.code),
    index('permissions_module_idx').on(t.module),
  ],
);

export const roles = pgTable(
  'roles',
  {
    id: primaryId(),
    code: varchar('code', { length: 40 }).notNull(),
    name: varchar('name', { length: 80 }).notNull(),
    description: text('description'),
    /** Seeded roles cannot be deleted. */
    isSystem: boolean('is_system').notNull().default(false),
    /** Super Admin cannot be edited either — prevents locking the org out. */
    isProtected: boolean('is_protected').notNull().default(false),
    /** Short-circuits every permission check to "allowed". */
    isSuperAdmin: boolean('is_super_admin').notNull().default(false),
    ...timestamps(),
    deletedAt: deletedAt(),
  },
  (t) => [uniqueIndex('roles_code_uq').on(t.code)],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    id: primaryId(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('role_permissions_uq').on(t.roleId, t.permissionId),
    index('role_permissions_role_idx').on(t.roleId),
  ],
);

export const users = pgTable(
  'users',
  {
    id: primaryId(),
    fullName: varchar('full_name', { length: 150 }).notNull(),
    email: varchar('email', { length: 255 }).notNull(),
    /** Staff can log in with either email or employee code (W-01). */
    employeeCode: varchar('employee_code', { length: 40 }),
    phone: varchar('phone', { length: 20 }),
    designation: varchar('designation', { length: 120 }),
    avatarKey: varchar('avatar_key', { length: 500 }),

    /** argon2id. Never logged, never returned by any endpoint. */
    passwordHash: text('password_hash').notNull(),
    /** Bumped on password change / role change — invalidates every live token. */
    tokenVersion: integer('token_version').notNull().default(0),
    mustChangePassword: boolean('must_change_password').notNull().default(true),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true, mode: 'date' }),

    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    status: varchar('status', { length: 20 }).notNull().default('active'),

    /** Login throttling state (§1 — lockout after 5 failures). */
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true, mode: 'date' }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true, mode: 'date' }),
    lastLoginIp: inet('last_login_ip'),

    ...timestamps(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('users_email_uq').on(sql`lower(${t.email})`),
    uniqueIndex('users_employee_code_uq')
      .on(t.employeeCode)
      .where(sql`${t.employeeCode} is not null`),
    index('users_role_idx').on(t.roleId),
    index('users_status_idx').on(t.status),
  ],
);

/**
 * Refresh-token sessions. The token itself is never stored — only a SHA-256
 * hash — so a database leak can't be replayed as a live session. Rows are the
 * source of truth for "log this device out" from the Users screen.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    refreshTokenHash: varchar('refresh_token_hash', { length: 64 }).notNull(),
    /** Rotation chain — set when this token is exchanged for a new one. */
    replacedBySessionId: uuid('replaced_by_session_id'),
    userAgent: text('user_agent'),
    ipAddress: inet('ip_address'),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    /** Idle timeout is enforced against this, not against `createdAt` (§1). */
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    /**
     * Carried from the original login and re-propagated on every rotation.
     * "Remember me" sessions are exempt from the idle timeout — they live
     * until `expiresAt` (7 days) regardless of gaps between requests.
     */
    rememberMe: boolean('remember_me').notNull().default(false),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    revokedReason: varchar('revoked_reason', { length: 60 }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_uq').on(t.refreshTokenHash),
    index('sessions_user_active_idx')
      .on(t.userId, t.expiresAt)
      .where(sql`${t.revokedAt} is null`),
  ],
);

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true, mode: 'date' }),
    requestedIp: inet('requested_ip'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('password_reset_token_hash_uq').on(t.tokenHash),
    index('password_reset_user_idx').on(t.userId),
  ],
);

/**
 * Every authentication attempt, successful or not (§23 audit: "Login History").
 * Kept separate from `audit_logs` because it is written on the unauthenticated
 * path and is the input to rate limiting and lockout decisions.
 */
export const loginAttempts = pgTable(
  'login_attempts',
  {
    id: primaryId(),
    identifier: varchar('identifier', { length: 255 }).notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    succeeded: boolean('succeeded').notNull(),
    failureReason: varchar('failure_reason', { length: 60 }),
    ipAddress: inet('ip_address'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => [
    index('login_attempts_identifier_idx').on(t.identifier, t.createdAt),
    index('login_attempts_ip_idx').on(t.ipAddress, t.createdAt),
  ],
);

/**
 * ── Audit log (§23) ──────────────────────────────────────────────────────────
 * Append-only. A Postgres rule (see migration `0001_immutability.sql`) revokes
 * UPDATE and DELETE from the application role, so "cannot be edited or deleted"
 * is enforced by the database and not just by convention.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: primaryId(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actorName: varchar('actor_name', { length: 150 }),
    actorRole: varchar('actor_role', { length: 40 }),
    /** `applicant.updated`, `payment.recorded`, `auth.login`… */
    action: varchar('action', { length: 80 }).notNull(),
    entityType: varchar('entity_type', { length: 60 }),
    entityId: uuid('entity_id'),
    /** Human-readable entity label so the log stays readable after erasure. */
    entityLabel: varchar('entity_label', { length: 250 }),
    /** Before → after diff on sensitive edits. */
    changes: jsonb('changes').$type<Record<string, { from: unknown; to: unknown }>>(),
    meta: jsonb('meta').$type<Record<string, unknown>>(),
    ipAddress: inet('ip_address'),
    userAgent: text('user_agent'),
    requestId: varchar('request_id', { length: 40 }),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_logs_created_idx').on(t.createdAt),
    index('audit_logs_actor_idx').on(t.actorUserId, t.createdAt),
    index('audit_logs_entity_idx').on(t.entityType, t.entityId, t.createdAt),
    index('audit_logs_action_idx').on(t.action, t.createdAt),
  ],
);

export const usersRelations = relations(users, ({ one, many }) => ({
  role: one(roles, { fields: [users.roleId], references: [roles.id] }),
  sessions: many(sessions),
}));

export const rolesRelations = relations(roles, ({ many }) => ({
  users: many(users),
  rolePermissions: many(rolePermissions),
}));

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, { fields: [rolePermissions.roleId], references: [roles.id] }),
  permission: one(permissions, {
    fields: [rolePermissions.permissionId],
    references: [permissions.id],
  }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));
