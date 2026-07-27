import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, primaryId, timestamps } from './_shared';
import { users } from './identity';

/** §26 Settings — key/value, namespaced, typed by the consuming service. */
export const settings = pgTable(
  'settings',
  {
    id: primaryId(),
    /** e.g. `notifications.payment_reminder_days`, `session.idle_timeout_minutes`. */
    key: varchar('key', { length: 120 }).notNull(),
    value: jsonb('value').notNull(),
    category: varchar('category', { length: 40 }).notNull().default('general'),
    label: varchar('label', { length: 200 }),
    description: text('description'),
    /** Non-editable settings are shown read-only (env-controlled values). */
    isEditable: boolean('is_editable').notNull().default(true),
    updatedByUserId: uuid('updated_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('settings_key_uq').on(t.key),
    index('settings_category_idx').on(t.category),
  ],
);

/** Courier partners for the Dispatch dropdown (§12). Editable in Settings. */
export const couriers = pgTable(
  'couriers',
  {
    id: primaryId(),
    name: varchar('name', { length: 120 }).notNull(),
    /** `{tracking_no}` is substituted to build the applicant-facing link. */
    trackingUrlTemplate: varchar('tracking_url_template', { length: 500 }),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps(),
  },
  (t) => [uniqueIndex('couriers_name_uq').on(t.name)],
);

/**
 * Inbound integration events from the existing NBR website (P2-14).
 *
 * Every webhook delivery is persisted *before* it is processed. That makes
 * retries idempotent (unique on externalId), gives operations a queue they can
 * inspect and replay when a field mapping turns out to be wrong, and means a
 * bad payload can never silently vanish.
 */
export const integrationEvents = pgTable(
  'integration_events',
  {
    id: primaryId(),
    source: varchar('source', { length: 60 }).notNull().default('nbr_website'),
    /** The legacy system's primary key for this application. */
    externalId: varchar('external_id', { length: 120 }).notNull(),
    eventType: varchar('event_type', { length: 60 }).notNull().default('application.approved'),

    /** Raw body exactly as received — the ground truth when debugging a
     *  mis-mapped import months later. */
    payload: jsonb('payload').notNull(),
    signatureValid: boolean('signature_valid').notNull(),
    /** 'webhook' | 'poll' */
    deliveryMode: varchar('delivery_mode', { length: 20 }).notNull().default('webhook'),

    status: varchar('status', { length: 30 }).notNull().default('received'),
    attemptCount: integer('attempt_count').notNull().default(0),
    error: text('error'),

    /** Populated once the import succeeds. */
    applicantId: uuid('applicant_id'),
    recordId: uuid('record_id'),

    receivedAt: timestamp('received_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    processedAt: timestamp('processed_at', { withTimezone: true, mode: 'date' }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('integration_events_external_uq').on(t.source, t.externalId),
    index('integration_events_status_idx').on(t.status, t.receivedAt),
    index('integration_events_pending_idx')
      .on(t.receivedAt)
      .where(sql`${t.status} in ('received', 'processing')`),
  ],
);

/**
 * Queued report exports (§24). Large exports never block a request — the API
 * returns 202, a BullMQ worker builds the file, and the user gets a
 * notification with a download link.
 */
export const exportJobs = pgTable(
  'export_jobs',
  {
    id: primaryId(),
    requestedByUserId: uuid('requested_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    reportType: varchar('report_type', { length: 40 }).notNull(),
    format: varchar('format', { length: 10 }).notNull(),
    filters: jsonb('filters').$type<Record<string, unknown>>().notNull(),
    columns: jsonb('columns').$type<string[]>(),

    status: varchar('status', { length: 20 }).notNull().default('queued'),
    rowCount: integer('row_count'),
    storageKey: varchar('storage_key', { length: 500 }),
    error: text('error'),

    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
    /** Export files hold personal data — they expire rather than living forever. */
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('export_jobs_user_idx').on(t.requestedByUserId, t.createdAt),
    index('export_jobs_status_idx').on(t.status, t.createdAt),
    index('export_jobs_expiry_idx')
      .on(t.expiresAt)
      .where(sql`${t.storageKey} is not null`),
  ],
);

/**
 * Saved views on the applicant list (§3 "saved column set"). Per-user, so a
 * verifier's default filters don't overwrite an accountant's.
 */
export const savedViews = pgTable(
  'saved_views',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    scope: varchar('scope', { length: 40 }).notNull().default('applicants'),
    filters: jsonb('filters').$type<Record<string, unknown>>().notNull(),
    columns: jsonb('columns').$type<string[]>(),
    isDefault: boolean('is_default').notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('saved_views_user_name_uq').on(t.userId, t.scope, t.name),
    index('saved_views_user_idx').on(t.userId, t.scope),
  ],
);
