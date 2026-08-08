import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { primaryId, timestamps } from './_shared';
import { users } from './identity';

/**
 * Certificates the website issued offline, with no application behind them.
 *
 * These come from the website's Certificates → Import screen, which writes a
 * certificate row with `application_id = NULL` and an awardee beside it. There
 * is no applicant, no evidence, no payment and no pipeline — somebody already
 * holds the record and the paperwork is being catalogued after the fact.
 *
 * Kept deliberately apart from `applicants` and `records`, with no foreign key
 * to either:
 *
 *  • They are not applications and must never appear in the verification,
 *    payment, certificate or dispatch queues. Merging them in would put
 *    hundreds of rows into worklists where no work is possible.
 *  • The applicant schema requires a mobile and an email. Most historic holders
 *    have neither, so importing them as applicants would mean inventing contact
 *    details — exactly the kind of fabricated data that makes a CRM untrusted.
 *
 * The website stays the source of truth: it issues, revokes and publicly
 * verifies these. This table is a readable mirror an operator can search,
 * annotate and follow up on.
 */
export const importedRecords = pgTable(
  'imported_records',
  {
    id: primaryId(),

    /**
     * The website's certificate number, and the natural key for this mirror.
     * Unique over there, stable across re-syncs, and the thing an operator
     * actually quotes on the phone.
     */
    certificateNumber: varchar('certificate_number', { length: 120 }).notNull(),

    holderName: varchar('holder_name', { length: 200 }).notNull(),
    recordTitle: varchar('record_title', { length: 1400 }).notNull(),
    category: varchar('category', { length: 150 }),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),

    /** Optional on the website, so optional here. No placeholders invented. */
    email: varchar('email', { length: 200 }),
    phone: varchar('phone', { length: 30 }),

    location: varchar('location', { length: 250 }),
    bio: text('bio'),
    achievementDate: timestamp('achievement_date', { withTimezone: true }),
    coverImageUrl: varchar('cover_image_url', { length: 1000 }),

    /** Whatever else the import carried. Mirrored rather than interpreted. */
    extraData: jsonb('extra_data').$type<Record<string, unknown>>().default({}).notNull(),

    awardeeSlug: varchar('awardee_slug', { length: 250 }),
    /** Public pages on the website — the authoritative view of this record. */
    verifyUrl: varchar('verify_url', { length: 1000 }),
    awardeeUrl: varchar('awardee_url', { length: 1000 }),

    isPublished: boolean('is_published').notNull().default(false),
    revoked: boolean('revoked').notNull().default(false),
    revokeReason: text('revoke_reason'),

    /** When this mirror last agreed with the website. */
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),

    ...timestamps(),
  },
  (t) => [
    // Re-running the sync updates in place instead of duplicating.
    uniqueIndex('imported_records_certificate_uq').on(t.certificateNumber),
    index('imported_records_holder_idx').on(t.holderName),
    index('imported_records_issued_idx').on(t.issuedAt),
  ],
);

/**
 * Contact attempts and reminders against an imported record.
 *
 * The client asked for exactly four actions and nothing else: send an email,
 * send a WhatsApp message, add a note, add a task. Those live here rather than
 * in `communications` and `tasks` because both of those are keyed to a record
 * id, and an imported certificate has none — wiring a nullable branch through
 * them would put a permanent "or maybe not an applicant" caveat into the
 * pipeline's own tables.
 */
export const importedRecordActivity = pgTable(
  'imported_record_activity',
  {
    id: primaryId(),
    importedRecordId: uuid('imported_record_id')
      .notNull()
      .references(() => importedRecords.id, { onDelete: 'cascade' }),

    /** `email` | `whatsapp` | `note` | `task` — the four, and only the four. */
    kind: varchar('kind', { length: 20 }).notNull(),

    subject: varchar('subject', { length: 300 }),
    body: text('body').notNull(),

    /** Set on tasks only. */
    dueAt: timestamp('due_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),

    /** Delivery outcome for email and WhatsApp: sent | failed | queued. */
    status: varchar('status', { length: 20 }),
    error: text('error'),

    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    ...timestamps(),
  },
  (t) => [
    index('imported_activity_record_idx').on(t.importedRecordId),
    index('imported_activity_due_idx').on(t.dueAt),
  ],
);

export const importedRecordsRelations = relations(importedRecords, ({ many }) => ({
  activity: many(importedRecordActivity),
}));

export const importedRecordActivityRelations = relations(importedRecordActivity, ({ one }) => ({
  record: one(importedRecords, {
    fields: [importedRecordActivity.importedRecordId],
    references: [importedRecords.id],
  }),
  createdBy: one(users, {
    fields: [importedRecordActivity.createdByUserId],
    references: [users.id],
  }),
}));
