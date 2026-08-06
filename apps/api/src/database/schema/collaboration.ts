import { relations, sql } from 'drizzle-orm';
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
import { applicants } from './applicants';
import { users } from './identity';
import { records } from './records';

/**
 * ── Internal notes (§14) ─────────────────────────────────────────────────────
 * "Only visible to internal staff… Notes should keep edit history."
 * Editing a note writes a revision row; nothing is ever destroyed.
 */
export const notes = pgTable(
  'notes',
  {
    id: primaryId(),
    applicantId: uuid('applicant_id')
      .notNull()
      .references(() => applicants.id, { onDelete: 'restrict' }),
    recordId: uuid('record_id').references(() => records.id, { onDelete: 'restrict' }),

    body: text('body').notNull(),
    category: varchar('category', { length: 40 }).notNull().default('general'),
    priority: varchar('priority', { length: 20 }).notNull().default('normal'),
    followUpDate: timestamp('follow_up_date', { withTimezone: true, mode: 'date' }),

    /** Empty array = visible to all staff. Otherwise restricted to these roles. */
    visibleToRoleIds: jsonb('visible_to_role_ids')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),

    revisionCount: integer('revision_count').notNull().default(0),
    lastEditedAt: timestamp('last_edited_at', { withTimezone: true, mode: 'date' }),

    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdByName: varchar('created_by_name', { length: 150 }),
    ...timestamps(),
  },
  (t) => [
    index('notes_applicant_idx').on(t.applicantId, t.createdAt),
    index('notes_record_idx').on(t.recordId, t.createdAt),
    index('notes_followup_idx')
      .on(t.followUpDate)
      .where(sql`${t.followUpDate} is not null`),
  ],
);

/** Append-only edit history for notes (§14). */
export const noteRevisions = pgTable(
  'note_revisions',
  {
    id: primaryId(),
    noteId: uuid('note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'restrict' }),
    revision: integer('revision').notNull(),
    /** The body *before* this edit — so revision N shows what N-1 said. */
    previousBody: text('previous_body').notNull(),
    editReason: varchar('edit_reason', { length: 300 }),
    editedByUserId: uuid('edited_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    editedByName: varchar('edited_by_name', { length: 150 }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('note_revisions_uq').on(t.noteId, t.revision)],
);

/** §15 Task Management — per-applicant and on the global task board. */
export const tasks = pgTable(
  'tasks',
  {
    id: primaryId(),
    applicantId: uuid('applicant_id').references(() => applicants.id, { onDelete: 'cascade' }),
    recordId: uuid('record_id').references(() => records.id, { onDelete: 'cascade' }),

    title: varchar('title', { length: 250 }).notNull(),
    description: text('description'),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    priority: varchar('priority', { length: 20 }).notNull().default('normal'),

    assignedToUserId: uuid('assigned_to_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    dueDate: timestamp('due_date', { withTimezone: true, mode: 'date' }).notNull(),
    remindAt: timestamp('remind_at', { withTimezone: true, mode: 'date' }),

    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
    completedByUserId: uuid('completed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    completionRemark: text('completion_remark'),

    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    ...timestamps(),
  },
  (t) => [
    // "Today's follow-ups" and "My pending tasks" on the dashboard (§2).
    index('tasks_assignee_due_idx')
      .on(t.assignedToUserId, t.dueDate)
      .where(sql`${t.status} = 'pending'`),
    index('tasks_due_idx')
      .on(t.dueDate)
      .where(sql`${t.status} = 'pending'`),
    index('tasks_applicant_idx').on(t.applicantId),
    index('tasks_record_idx').on(t.recordId),
    index('tasks_reminder_idx')
      .on(t.remindAt)
      .where(sql`${t.status} = 'pending' and ${t.remindAt} is not null`),
  ],
);

/** §7, §8 message templates. Bodies are Admin-editable; codes are not. */
export const templates = pgTable(
  'templates',
  {
    id: primaryId(),
    code: varchar('code', { length: 40 }).notNull(),
    channel: varchar('channel', { length: 20 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    subject: varchar('subject', { length: 250 }),
    body: text('body').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    updatedByUserId: uuid('updated_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    ...timestamps(),
  },
  (t) => [uniqueIndex('templates_code_channel_uq').on(t.code, t.channel)],
);

/**
 * §22 Communication history — emails, WhatsApp messages, call notes, all linked
 * to the applicant. The *rendered* body is stored, not just the template id, so
 * the log still shows exactly what was sent after a template is reworded.
 */
export const communications = pgTable(
  'communications',
  {
    id: primaryId(),
    applicantId: uuid('applicant_id')
      .notNull()
      .references(() => applicants.id, { onDelete: 'restrict' }),
    recordId: uuid('record_id').references(() => records.id, { onDelete: 'restrict' }),

    channel: varchar('channel', { length: 20 }).notNull(),
    direction: varchar('direction', { length: 10 }).notNull().default('outbound'),
    templateId: uuid('template_id').references(() => templates.id, { onDelete: 'set null' }),
    templateCode: varchar('template_code', { length: 40 }),

    toAddress: varchar('to_address', { length: 255 }),
    ccAddresses: jsonb('cc_addresses').$type<string[]>(),
    subject: varchar('subject', { length: 250 }),
    body: text('body').notNull(),
    attachmentKeys: jsonb('attachment_keys').$type<string[]>().notNull().default(sql`'[]'::jsonb`),

    status: varchar('status', { length: 20 }).notNull().default('queued'),
    queuedAt: timestamp('queued_at', { withTimezone: true, mode: 'date' }),
    sentAt: timestamp('sent_at', { withTimezone: true, mode: 'date' }),
    failedAt: timestamp('failed_at', { withTimezone: true, mode: 'date' }),
    failureReason: text('failure_reason'),
    attemptCount: integer('attempt_count').notNull().default(0),
    /** Provider message id, for tracing a delivery complaint later. */
    providerMessageId: varchar('provider_message_id', { length: 255 }),

    /** Call notes only (§22 "Call Notes"). */
    callDurationMinutes: integer('call_duration_minutes'),
    callOutcome: varchar('call_outcome', { length: 200 }),

    sentByUserId: uuid('sent_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    sentByName: varchar('sent_by_name', { length: 150 }),
    createdAt: createdAt(),
  },
  (t) => [
    index('communications_applicant_idx').on(t.applicantId, t.createdAt),
    index('communications_record_idx').on(t.recordId, t.createdAt),
    index('communications_channel_idx').on(t.channel, t.createdAt),
    index('communications_pending_idx')
      .on(t.createdAt)
      .where(sql`${t.status} = 'queued'`),
  ],
);

/** Smart notifications (§11). Generated by scheduled jobs and domain events. */
export const notifications = pgTable(
  'notifications',
  {
    id: primaryId(),
    /** Null = broadcast to every user holding the relevant permission. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 60 }).notNull(),
    title: varchar('title', { length: 250 }).notNull(),
    body: text('body'),
    severity: varchar('severity', { length: 20 }).notNull().default('info'),

    applicantId: uuid('applicant_id').references(() => applicants.id, { onDelete: 'cascade' }),
    recordId: uuid('record_id').references(() => records.id, { onDelete: 'cascade' }),
    /** Deep link into the app, e.g. `/applicants/<id>?tab=payment`. */
    link: varchar('link', { length: 500 }),

    /** Stops the nightly generators re-raising the same alert every run. */
    dedupeKey: varchar('dedupe_key', { length: 200 }),

    readAt: timestamp('read_at', { withTimezone: true, mode: 'date' }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('notifications_user_unread_idx')
      .on(t.userId, t.createdAt)
      .where(sql`${t.readAt} is null`),
    uniqueIndex('notifications_dedupe_uq')
      .on(t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null and ${t.dismissedAt} is null`),
    index('notifications_record_idx').on(t.recordId),
  ],
);

export const notesRelations = relations(notes, ({ one, many }) => ({
  applicant: one(applicants, { fields: [notes.applicantId], references: [applicants.id] }),
  record: one(records, { fields: [notes.recordId], references: [records.id] }),
  createdBy: one(users, { fields: [notes.createdByUserId], references: [users.id] }),
  revisions: many(noteRevisions),
}));

export const noteRevisionsRelations = relations(noteRevisions, ({ one }) => ({
  note: one(notes, { fields: [noteRevisions.noteId], references: [notes.id] }),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  applicant: one(applicants, { fields: [tasks.applicantId], references: [applicants.id] }),
  record: one(records, { fields: [tasks.recordId], references: [records.id] }),
  assignedTo: one(users, { fields: [tasks.assignedToUserId], references: [users.id] }),
}));

export const communicationsRelations = relations(communications, ({ one }) => ({
  applicant: one(applicants, {
    fields: [communications.applicantId],
    references: [applicants.id],
  }),
  record: one(records, { fields: [communications.recordId], references: [records.id] }),
  template: one(templates, { fields: [communications.templateId], references: [templates.id] }),
}));
