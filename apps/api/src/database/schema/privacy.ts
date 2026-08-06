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
import { createdAt, primaryId, timestamps } from './_shared';
import { applicants } from './applicants';
import { users } from './identity';
import { records } from './records';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Digital Personal Data Protection Act, 2023 — compliance tables
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * These tables exist so NBR can *prove* compliance, not merely claim it. Every
 * one of them is append-only: consent history, data-principal requests, PII
 * reads and breach records are exactly the artefacts the Data Protection Board
 * would ask for, and a system that can quietly rewrite them is worth nothing
 * as evidence.
 */

/**
 * §5 notice. Every version of the notice ever shown is retained, so a consent
 * given in 2026 can always be traced back to the exact wording the applicant
 * actually read — even after the notice is rewritten in 2029.
 */
export const consentNotices = pgTable(
  'consent_notices',
  {
    id: primaryId(),
    version: varchar('version', { length: 20 }).notNull(),
    /** Eighth Schedule language code — 'en', 'hi', 'mr'… (§5(3)). */
    language: varchar('language', { length: 10 }).notNull().default('en'),
    title: varchar('title', { length: 250 }).notNull(),
    body: text('body').notNull(),
    /** Purpose codes covered by this notice version. */
    purposes: jsonb('purposes').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    effectiveFrom: timestamp('effective_from', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    supersededAt: timestamp('superseded_at', { withTimezone: true, mode: 'date' }),
    publishedByUserId: uuid('published_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('consent_notices_version_lang_uq').on(t.version, t.language)],
);

/**
 * §6 consent ledger. Append-only: granting, re-granting and withdrawing all
 * insert rows. The *current* state for a purpose is the latest row for that
 * (applicant, purpose) pair — never an in-place update, so the full history of
 * what was agreed and when survives forever (§21 of the V1.0 doc:
 * "Never overwrite previous versions").
 */
export const consentRecords = pgTable(
  'consent_records',
  {
    id: primaryId(),
    applicantId: uuid('applicant_id')
      .notNull()
      .references(() => applicants.id, { onDelete: 'restrict' }),
    recordId: uuid('record_id').references(() => records.id, { onDelete: 'restrict' }),

    purpose: varchar('purpose', { length: 60 }).notNull(),
    /** 'granted' | 'withdrawn' | 'expired' */
    state: varchar('state', { length: 20 }).notNull(),
    /** 'consent' | 'legitimate_use' — §6 vs §7. */
    lawfulBasis: varchar('lawful_basis', { length: 30 }).notNull().default('consent'),

    noticeVersion: varchar('notice_version', { length: 20 }).notNull(),
    noticeId: uuid('notice_id').references(() => consentNotices.id, { onDelete: 'set null' }),
    channel: varchar('channel', { length: 30 }).notNull(),
    /** Signed form / screenshot / recording backing this entry. */
    evidenceKey: varchar('evidence_key', { length: 500 }),
    capturedNotes: text('captured_notes'),

    /** §9 — verifiable consent of a parent or guardian for a child. */
    guardianName: varchar('guardian_name', { length: 150 }),
    guardianRelationship: varchar('guardian_relationship', { length: 60 }),
    guardianContact: varchar('guardian_contact', { length: 20 }),
    isChildConsent: boolean('is_child_consent').notNull().default(false),

    /** Proof of *when* and *from where* — matters if consent is ever disputed. */
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    ipAddress: inet('ip_address'),
    userAgent: text('user_agent'),

    withdrawalReason: text('withdrawal_reason'),

    recordedByUserId: uuid('recorded_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
  },
  (t) => [
    index('consent_applicant_purpose_idx').on(t.applicantId, t.purpose, t.occurredAt),
    index('consent_state_idx').on(t.state, t.occurredAt),
    index('consent_child_idx')
      .on(t.applicantId)
      .where(sql`${t.isChildConsent} = true`),
  ],
);

/**
 * §11–§14 data-principal requests: access, correction, erasure, nomination,
 * grievance, consent withdrawal. Every request is tracked to a resolution with
 * a due date, because "we responded" is not a defence without a record of when.
 */
export const dataPrincipalRequests = pgTable(
  'data_principal_requests',
  {
    id: primaryId(),
    /** Human reference quoted back to the applicant: DSR-2026-00042. */
    referenceCode: varchar('reference_code', { length: 30 }).notNull(),
    applicantId: uuid('applicant_id').references(() => applicants.id, { onDelete: 'set null' }),

    type: varchar('type', { length: 30 }).notNull(),
    status: varchar('status', { length: 30 }).notNull().default('received'),

    requesterName: varchar('requester_name', { length: 150 }).notNull(),
    requesterEmail: varchar('requester_email', { length: 255 }),
    requesterPhone: varchar('requester_phone', { length: 20 }),
    details: text('details').notNull(),
    receivedVia: varchar('received_via', { length: 30 }).notNull(),
    attachmentKeys: jsonb('attachment_keys').$type<string[]>().notNull().default(sql`'[]'::jsonb`),

    /** A request must not be actioned before the requester is proven to be the
     *  data principal — otherwise the rights workflow becomes an attack. */
    identityVerifiedAt: timestamp('identity_verified_at', { withTimezone: true, mode: 'date' }),
    identityVerificationMethod: varchar('identity_verification_method', { length: 200 }),

    receivedAt: timestamp('received_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    /** receivedAt + DPDP_DSR_RESPONSE_DAYS. Drives the overdue notification. */
    dueAt: timestamp('due_at', { withTimezone: true, mode: 'date' }).notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'date' }),
    resolutionNotes: text('resolution_notes'),

    assignedToUserId: uuid('assigned_to_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('dsr_reference_uq').on(t.referenceCode),
    index('dsr_applicant_idx').on(t.applicantId),
    index('dsr_status_due_idx').on(t.status, t.dueAt),
    index('dsr_overdue_idx')
      .on(t.dueAt)
      .where(sql`${t.resolvedAt} is null`),
  ],
);

/**
 * §8(5) personal data breach register. The 72-hour clock in
 * DPDP_BREACH_NOTIFY_HOURS is measured from `detectedAt`, and the record can
 * never be closed without both notification timestamps or an explicit,
 * written justification for why notification was not required.
 */
export const breachRegister = pgTable(
  'breach_register',
  {
    id: primaryId(),
    referenceCode: varchar('reference_code', { length: 30 }).notNull(),
    title: varchar('title', { length: 250 }).notNull(),
    description: text('description').notNull(),
    severity: varchar('severity', { length: 20 }).notNull(),
    status: varchar('status', { length: 30 }).notNull().default('detected'),

    detectedAt: timestamp('detected_at', { withTimezone: true, mode: 'date' }).notNull(),
    /** detectedAt + 72h. Surfaced as a critical dashboard notification. */
    notifyDueAt: timestamp('notify_due_at', { withTimezone: true, mode: 'date' }).notNull(),
    boardNotifiedAt: timestamp('board_notified_at', { withTimezone: true, mode: 'date' }),
    principalsNotifiedAt: timestamp('principals_notified_at', {
      withTimezone: true,
      mode: 'date',
    }),

    affectedApplicantCount: integer('affected_applicant_count').notNull().default(0),
    dataCategories: jsonb('data_categories').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    containmentActions: text('containment_actions'),
    rootCause: text('root_cause'),
    remediation: text('remediation'),

    closedAt: timestamp('closed_at', { withTimezone: true, mode: 'date' }),
    reportedByUserId: uuid('reported_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('breach_reference_uq').on(t.referenceCode),
    index('breach_status_idx').on(t.status, t.detectedAt),
    index('breach_open_idx')
      .on(t.notifyDueAt)
      .where(sql`${t.closedAt} is null`),
  ],
);

/**
 * Every decryption of a government identifier, and every download of a file
 * marked sensitive. Append-only. This is what turns "PII access is restricted"
 * from a claim into something auditable (§8(4), §23).
 */
export const piiAccessLog = pgTable(
  'pii_access_log',
  {
    id: primaryId(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    userName: varchar('user_name', { length: 150 }),
    userRole: varchar('user_role', { length: 40 }),
    applicantId: uuid('applicant_id').references(() => applicants.id, { onDelete: 'set null' }),
    /** 'aadhaar' | 'passport' | 'pan' | 'evidence_file' | 'consent_form' */
    field: varchar('field', { length: 60 }).notNull(),
    /** 'reveal' | 'download' | 'export' */
    accessType: varchar('access_type', { length: 20 }).notNull(),
    /** The justification the user typed. Required — no silent reveals. */
    reason: varchar('reason', { length: 300 }),
    ipAddress: inet('ip_address'),
    userAgent: text('user_agent'),
    requestId: varchar('request_id', { length: 40 }),
    createdAt: createdAt(),
  },
  (t) => [
    index('pii_access_user_idx').on(t.userId, t.createdAt),
    index('pii_access_applicant_idx').on(t.applicantId, t.createdAt),
    index('pii_access_created_idx').on(t.createdAt),
  ],
);

/**
 * §8(7) retention. Personal data must be erased once the purpose is no longer
 * served. This table declares, per data category, how long "still served" lasts
 * — configurable by the Admin because the right answer is a legal decision, not
 * an engineering one. The nightly job reads it, never a hard-coded constant.
 */
export const retentionPolicies = pgTable(
  'retention_policies',
  {
    id: primaryId(),
    dataCategory: varchar('data_category', { length: 40 }).notNull(),
    description: text('description').notNull(),
    /** Months after the trigger event before erasure becomes due. */
    retainMonths: integer('retain_months').notNull(),
    /** 'record_completed' | 'record_closed' | 'last_activity' | 'consent_withdrawn' */
    triggerEvent: varchar('trigger_event', { length: 40 }).notNull(),
    /** Statutory basis for keeping it this long, if any. */
    legalBasis: text('legal_basis'),
    /** Erase automatically, or raise a task for a human to approve. */
    autoErase: boolean('auto_erase').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps(),
  },
  (t) => [uniqueIndex('retention_policies_category_uq').on(t.dataCategory)],
);

/**
 * Record of erasures actually performed. The applicant row survives (financial
 * and certificate history must, and §8(7) permits retention where the law
 * requires it) but the identifiers are destroyed — so this log is the only
 * remaining proof of what was removed and why.
 */
export const erasureLog = pgTable(
  'erasure_log',
  {
    id: primaryId(),
    applicantId: uuid('applicant_id').references(() => applicants.id, { onDelete: 'set null' }),
    /** Kept after the applicant's identifiers are gone, for traceability. */
    applicantCode: varchar('applicant_code', { length: 20 }).notNull(),
    dsrId: uuid('dsr_id').references(() => dataPrincipalRequests.id, { onDelete: 'set null' }),
    /** 'dsr_request' | 'retention_policy' | 'manual_admin' */
    trigger: varchar('trigger', { length: 30 }).notNull(),
    reason: text('reason').notNull(),
    /** Which fields/tables were anonymised. */
    scope: jsonb('scope').$type<Record<string, unknown>>().notNull(),
    retainedFinancialRecords: boolean('retained_financial_records').notNull().default(true),
    executedByUserId: uuid('executed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    executedByName: varchar('executed_by_name', { length: 150 }),
    createdAt: createdAt(),
  },
  (t) => [
    index('erasure_log_applicant_idx').on(t.applicantId),
    index('erasure_log_created_idx').on(t.createdAt),
  ],
);

export const consentRecordsRelations = relations(consentRecords, ({ one }) => ({
  applicant: one(applicants, {
    fields: [consentRecords.applicantId],
    references: [applicants.id],
  }),
  notice: one(consentNotices, {
    fields: [consentRecords.noticeId],
    references: [consentNotices.id],
  }),
}));

export const dataPrincipalRequestsRelations = relations(dataPrincipalRequests, ({ one }) => ({
  applicant: one(applicants, {
    fields: [dataPrincipalRequests.applicantId],
    references: [applicants.id],
  }),
  assignedTo: one(users, {
    fields: [dataPrincipalRequests.assignedToUserId],
    references: [users.id],
  }),
}));
