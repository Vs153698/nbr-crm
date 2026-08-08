import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  date,
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
import { createdAt, deletedAt, primaryId, timestamps } from './_shared';
import { applicants } from './applicants';
import { users } from './identity';

/** Record categories (§6). Editable from Settings (§26). */
export const categories = pgTable(
  'categories',
  {
    id: primaryId(),
    name: varchar('name', { length: 150 }).notNull(),
    slug: varchar('slug', { length: 160 }).notNull(),
    description: text('description'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps(),
  },
  (t) => [uniqueIndex('categories_slug_uq').on(t.slug)],
);

/**
 * Configurable status list (§26 "Status Lists").
 *
 * The *codes* are compiled into @nbr/shared because the state machine branches
 * on them; this table exists so Admins can relabel and reorder statuses, and so
 * future phases can add a stage without a code change on the read paths.
 */
export const statuses = pgTable(
  'statuses',
  {
    id: primaryId(),
    code: varchar('code', { length: 40 }).notNull(),
    label: varchar('label', { length: 80 }).notNull(),
    tone: varchar('tone', { length: 20 }).notNull().default('slate'),
    stage: varchar('stage', { length: 30 }).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isTerminal: boolean('is_terminal').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps(),
  },
  (t) => [uniqueIndex('statuses_code_uq').on(t.code)],
);

/**
 * ── Records / applications (§5) ──────────────────────────────────────────────
 * One row per record attempt. Hangs off the master applicant so the same person
 * applying again keeps their whole history in one place.
 */
export const records = pgTable(
  'records',
  {
    id: primaryId(),
    /** Human-facing ID: NBRR00001. */
    recordCode: varchar('record_code', { length: 20 }).notNull(),
    applicantId: uuid('applicant_id')
      .notNull()
      .references(() => applicants.id, { onDelete: 'restrict' }),

    status: varchar('status', { length: 40 }).notNull().default('new_lead'),
    /** Set when the record enters a terminal state; blocks further transitions
     *  unless an Admin overrides (§11 stage 9 "Lock Workflow"). */
    lockedAt: timestamp('locked_at', { withTimezone: true, mode: 'date' }),

    source: varchar('source', { length: 40 }).notNull().default('walk_in'),
    applicationDate: timestamp('application_date', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    assignedToUserId: uuid('assigned_to_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    internalRemarks: text('internal_remarks'),

    /** §8 Selection Module. */
    selectionDate: timestamp('selection_date', { withTimezone: true, mode: 'date' }),
    reviewedByUserId: uuid('reviewed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    selectionRemarks: text('selection_remarks'),
    selectionLetterKey: varchar('selection_letter_key', { length: 500 }),
    rejectionReason: text('rejection_reason'),

    /**
     * Denormalised roll-ups so the applicant list (§3) renders its Payment and
     * Dispatch columns without joining four tables per row. Written inside the
     * same transaction as the source-of-truth row, never independently editable.
     */
    paymentStatus: varchar('payment_status', { length: 30 }).notNull().default('not_raised'),
    deliveryStatus: varchar('delivery_status', { length: 30 })
      .notNull()
      .default('not_dispatched'),
    hasCertificate: boolean('has_certificate').notNull().default(false),
    hasPublication: boolean('has_publication').notNull().default(false),
    evidenceCount: integer('evidence_count').notNull().default(0),

    /** Set by the inbound NBR-website importer (P2-14). */
    externalId: varchar('external_id', { length: 120 }),
    externalSource: varchar('external_source', { length: 60 }),

    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    ...timestamps(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('records_code_uq').on(t.recordCode),
    // The applicant list's default sort and its most common filters (§3, §7).
    index('records_status_assigned_updated_idx').on(t.status, t.assignedToUserId, t.updatedAt),
    index('records_applicant_idx').on(t.applicantId),
    index('records_updated_idx').on(t.updatedAt),
    index('records_payment_status_idx').on(t.paymentStatus),
    index('records_delivery_status_idx').on(t.deliveryStatus),
    // Idempotency for webhook retries — the same website application can arrive
    // five times and still produce exactly one record.
    uniqueIndex('records_external_uq')
      .on(t.externalSource, t.externalId)
      .where(sql`${t.externalId} is not null`),
    // Partial indexes on the hot operational queues.
    index('records_pending_review_idx')
      .on(t.updatedAt)
      .where(sql`${t.status} in ('under_review', 'verification_pending')`),
    index('records_payment_pending_idx')
      .on(t.updatedAt)
      .where(sql`${t.status} = 'payment_pending'`),
    index('records_dispatch_pending_idx')
      .on(t.updatedAt)
      .where(sql`${t.status} = 'dispatch_pending'`),
  ],
);

/** §6 Achievement Module — one per record. */
export const achievements = pgTable(
  'achievements',
  {
    id: primaryId(),
    recordId: uuid('record_id')
      .notNull()
      .references(() => records.id, { onDelete: 'cascade' }),
    /**
     * Unbounded, like the website's own column.
     *
     * This was varchar(1400) and had been widened twice already, each time
     * after a real title was rejected. A record title is prose written by an
     * applicant and there is no length at which the next one stops being
     * valid — every cap is a future sync failure waiting for a long enough
     * achievement. Postgres stores text and varchar identically, so the limit
     * bought nothing.
     */
    recordTitle: text('record_title').notNull(),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'restrict' }),
    recordType: varchar('record_type', { length: 20 }).notNull().default('individual'),
    description: text('description'),
    /** What the verification team approved for print — may differ from the
     *  applicant's own wording (§6 "Final Approved Description"). */
    approvedDescription: text('approved_description'),
    achievementDate: date('achievement_date', { mode: 'string' }),
    location: varchar('location', { length: 250 }),
    participantCount: integer('participant_count').notNull().default(1),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('achievements_record_uq').on(t.recordId),
    index('achievements_category_idx').on(t.categoryId),
    index('achievements_date_idx').on(t.achievementDate),
  ],
);

/**
 * ── Timeline (§13) ───────────────────────────────────────────────────────────
 *
 * "Every activity should automatically create a log… Timeline must be
 * read-only." Append-only in the strongest sense available: the migration
 * revokes UPDATE and DELETE on this table from the application role, so a bug
 * or a compromised API process still cannot rewrite history.
 */
export const timelineEvents = pgTable(
  'timeline_events',
  {
    id: primaryId(),
    applicantId: uuid('applicant_id')
      .notNull()
      .references(() => applicants.id, { onDelete: 'restrict' }),
    recordId: uuid('record_id').references(() => records.id, { onDelete: 'restrict' }),

    /** From TIMELINE_EVENT in @nbr/shared. */
    eventType: varchar('event_type', { length: 60 }).notNull(),
    /** Rendered sentence, e.g. "Status changed to Under Review". */
    summary: varchar('summary', { length: 500 }).notNull(),
    /** Structured payload — from/to status, amount, file name, and so on. */
    meta: jsonb('meta').$type<Record<string, unknown>>(),

    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Snapshotted so the timeline still reads correctly after a staff member
     *  leaves and their user row is deactivated. */
    actorName: varchar('actor_name', { length: 150 }),
    /** 'user' | 'system' | 'integration' — who really did it. */
    actorKind: varchar('actor_kind', { length: 20 }).notNull().default('user'),

    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    createdAt: createdAt(),
  },
  (t) => [
    // Cursor pagination on the profile timeline: newest first, keyed.
    index('timeline_record_occurred_idx').on(t.recordId, t.occurredAt, t.id),
    index('timeline_applicant_occurred_idx').on(t.applicantId, t.occurredAt, t.id),
    // Dashboard "Recent Activities" feed.
    index('timeline_occurred_idx').on(t.occurredAt),
    index('timeline_event_type_idx').on(t.eventType, t.occurredAt),
  ],
);

/**
 * Allowed transitions, mirrored into the database (§6 "status_transitions").
 * The compiled state machine in @nbr/shared is the enforcement point; this
 * table lets an Admin *narrow* it per role from Settings in a later phase
 * without a deploy. Seeded from STATUS_TRANSITIONS.
 */
export const statusTransitions = pgTable(
  'status_transitions',
  {
    id: primaryId(),
    fromStatus: varchar('from_status', { length: 40 }).notNull(),
    toStatus: varchar('to_status', { length: 40 }).notNull(),
    label: varchar('label', { length: 120 }).notNull(),
    requiredPermission: varchar('required_permission', { length: 60 }).notNull(),
    guards: jsonb('guards').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    requiresRemark: boolean('requires_remark').notNull().default(false),
    requiresOverride: boolean('requires_override').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps(),
  },
  (t) => [uniqueIndex('status_transitions_uq').on(t.fromStatus, t.toStatus)],
);

export const recordsRelations = relations(records, ({ one, many }) => ({
  applicant: one(applicants, { fields: [records.applicantId], references: [applicants.id] }),
  achievement: one(achievements, {
    fields: [records.id],
    references: [achievements.recordId],
  }),
  assignedTo: one(users, { fields: [records.assignedToUserId], references: [users.id] }),
  timeline: many(timelineEvents),
}));

export const achievementsRelations = relations(achievements, ({ one }) => ({
  record: one(records, { fields: [achievements.recordId], references: [records.id] }),
  category: one(categories, { fields: [achievements.categoryId], references: [categories.id] }),
}));

export const timelineEventsRelations = relations(timelineEvents, ({ one }) => ({
  record: one(records, { fields: [timelineEvents.recordId], references: [records.id] }),
  applicant: one(applicants, {
    fields: [timelineEvents.applicantId],
    references: [applicants.id],
  }),
  actor: one(users, { fields: [timelineEvents.actorUserId], references: [users.id] }),
}));
