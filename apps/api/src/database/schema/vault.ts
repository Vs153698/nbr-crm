import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
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
 * ── Evidence vault (§7) ──────────────────────────────────────────────────────
 *
 * "Files should remain attached permanently. No overwriting. Multiple uploads
 * should be allowed."
 *
 * There is deliberately no delete path and no `deletedAt`. Files land in R2
 * under a version-safe key (`evidence/<recordId>/<uuid>-<slug>.<ext>`), so
 * re-uploading a file with the same name creates a second object rather than
 * replacing the first. `supersededById` records that a newer file replaces this
 * one for review purposes, without either file ever leaving the vault.
 */
export const evidenceFiles = pgTable(
  'evidence_files',
  {
    id: primaryId(),
    recordId: uuid('record_id')
      .notNull()
      .references(() => records.id, { onDelete: 'restrict' }),
    applicantId: uuid('applicant_id')
      .notNull()
      .references(() => applicants.id, { onDelete: 'restrict' }),

    kind: varchar('kind', { length: 40 }).notNull(),
    storageKey: varchar('storage_key', { length: 500 }).notNull(),
    fileName: varchar('file_name', { length: 255 }).notNull(),
    contentType: varchar('content_type', { length: 120 }).notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    /** SHA-256 of the bytes. Detects silent corruption and makes a repeated
     *  upload of the identical file a no-op instead of a duplicate row. */
    checksumSha256: varchar('checksum_sha256', { length: 64 }),

    description: text('description'),
    /** Generated asynchronously by a BullMQ job; null until then. */
    thumbnailKey: varchar('thumbnail_key', { length: 500 }),
    /** Set by the upload scanner job: pending | clean | infected | error. */
    scanStatus: varchar('scan_status', { length: 20 }).notNull().default('pending'),

    supersededById: uuid('superseded_by_id'),

    /**
     * DPDP: ID proofs and consent forms are the most sensitive objects in the
     * vault. Flagged here so downloads are gated on `pii:reveal` and logged.
     */
    isSensitive: boolean('is_sensitive').notNull().default(false),

    uploadedByUserId: uuid('uploaded_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
  },
  (t) => [
    index('evidence_record_idx').on(t.recordId, t.createdAt),
    index('evidence_applicant_idx').on(t.applicantId),
    uniqueIndex('evidence_storage_key_uq').on(t.storageKey),
    // Re-uploading identical bytes to the same record is idempotent.
    uniqueIndex('evidence_record_checksum_uq')
      .on(t.recordId, t.checksumSha256)
      .where(sql`${t.checksumSha256} is not null`),
    index('evidence_scan_pending_idx')
      .on(t.createdAt)
      .where(sql`${t.scanStatus} = 'pending'`),
  ],
);

/** §16 general attachments — OCR copies, legal notices, correction letters. */
export const attachments = pgTable(
  'attachments',
  {
    id: primaryId(),
    applicantId: uuid('applicant_id')
      .notNull()
      .references(() => applicants.id, { onDelete: 'restrict' }),
    recordId: uuid('record_id').references(() => records.id, { onDelete: 'restrict' }),

    kind: varchar('kind', { length: 40 }).notNull(),
    storageKey: varchar('storage_key', { length: 500 }).notNull(),
    fileName: varchar('file_name', { length: 255 }).notNull(),
    contentType: varchar('content_type', { length: 120 }).notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    checksumSha256: varchar('checksum_sha256', { length: 64 }),
    description: text('description'),
    isSensitive: boolean('is_sensitive').notNull().default(false),
    scanStatus: varchar('scan_status', { length: 20 }).notNull().default('pending'),

    uploadedByUserId: uuid('uploaded_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    /**
     * Withdrawn, not destroyed.
     *
     * A miscellaneous attachment can legitimately need removing — a superseded
     * correction letter, a file put on the wrong profile — but the fact that it
     * was here, and who took it away, is exactly what somebody asks about
     * later. The row and the stored object both survive; the file stops being
     * listed and stops being downloadable.
     *
     * Evidence files have no equivalent. They are permanent by database
     * trigger and no permission reaches them.
     */
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
    deletedByUserId: uuid('deleted_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    deleteReason: text('delete_reason'),

    createdAt: createdAt(),
  },
  (t) => [
    index('attachments_applicant_idx').on(t.applicantId, t.createdAt),
    index('attachments_record_idx').on(t.recordId),
    uniqueIndex('attachments_storage_key_uq').on(t.storageKey),
  ],
);

/**
 * Presigned-upload intents. Created when the browser asks for an upload URL and
 * closed out when it confirms. Lets a nightly job find orphaned R2 objects that
 * were uploaded but never confirmed, and caps how much an authenticated user
 * can push into the bucket before any row exists.
 */
export const uploadIntents = pgTable(
  'upload_intents',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    scope: varchar('scope', { length: 40 }).notNull(),
    storageKey: varchar('storage_key', { length: 500 }).notNull(),
    fileName: varchar('file_name', { length: 255 }).notNull(),
    contentType: varchar('content_type', { length: 120 }).notNull(),
    declaredSizeBytes: bigint('declared_size_bytes', { mode: 'number' }).notNull(),
    recordId: uuid('record_id').references(() => records.id, { onDelete: 'cascade' }),
    applicantId: uuid('applicant_id').references(() => applicants.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('upload_intents_key_uq').on(t.storageKey),
    index('upload_intents_orphan_idx')
      .on(t.expiresAt)
      .where(sql`${t.confirmedAt} is null`),
  ],
);

/**
 * ── Certificates (§10) ───────────────────────────────────────────────────────
 *
 * "Old certificates should never be deleted. Version history must remain
 * available." One `certificates` row per record holds the current pointer;
 * every upload appends an immutable `certificate_versions` row.
 */
export const certificates = pgTable(
  'certificates',
  {
    id: primaryId(),
    recordId: uuid('record_id')
      .notNull()
      .references(() => records.id, { onDelete: 'restrict' }),
    applicantId: uuid('applicant_id')
      .notNull()
      .references(() => applicants.id, { onDelete: 'restrict' }),

    certificateNumber: varchar('certificate_number', { length: 80 }),
    recordNumber: varchar('record_number', { length: 80 }),
    currentVersion: integer('current_version').notNull().default(1),
    issueDate: timestamp('issue_date', { withTimezone: true, mode: 'date' }),

    /**
     * Employee sign-off (§10) — `awaiting_upload | pending_verification | verified`.
     *
     * The certificate stage is completely operator-controlled: a file being
     * present is not the milestone, a person saying it is correct is. Nothing
     * automatic may set this to `verified` — not the website's own certificate
     * push, not a payment settling — which is the whole reason it exists as a
     * column rather than being inferred from "a version row exists".
     *
     * A new version resets it to `pending_verification`: approval belongs to
     * the file that was approved, never to the one that replaced it.
     */
    verificationStatus: varchar('verification_status', { length: 30 })
      .notNull()
      .default('awaiting_upload'),
    verifiedAt: timestamp('verified_at', { withTimezone: true, mode: 'date' }),
    verifiedByUserId: uuid('verified_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** Which version the sign-off applies to, so a later upload cannot inherit it. */
    verifiedVersion: integer('verified_version'),
    verificationNotes: text('verification_notes'),

    ...timestamps(),
  },
  (t) => [
    uniqueIndex('certificates_record_uq').on(t.recordId),
    uniqueIndex('certificates_number_uq')
      .on(t.certificateNumber)
      .where(sql`${t.certificateNumber} is not null`),
    index('certificates_applicant_idx').on(t.applicantId),
  ],
);

export const certificateVersions = pgTable(
  'certificate_versions',
  {
    id: primaryId(),
    certificateId: uuid('certificate_id')
      .notNull()
      .references(() => certificates.id, { onDelete: 'restrict' }),
    version: integer('version').notNull(),
    pdfKey: varchar('pdf_key', { length: 500 }).notNull(),
    /** The designer's source file (AI/PSD/DOCX), kept alongside the PDF. */
    editableFileKey: varchar('editable_file_key', { length: 500 }),
    certificateNumber: varchar('certificate_number', { length: 80 }),
    issueDate: timestamp('issue_date', { withTimezone: true, mode: 'date' }),
    /** Why this version exists: "Correction — name spelling" (M-04). */
    versionReason: varchar('version_reason', { length: 300 }),
    checksumSha256: varchar('checksum_sha256', { length: 64 }),
    uploadedByUserId: uuid('uploaded_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('certificate_versions_uq').on(t.certificateId, t.version),
    index('certificate_versions_cert_idx').on(t.certificateId, t.version),
  ],
);

/** §11 Publications Module. */
export const publications = pgTable(
  'publications',
  {
    id: primaryId(),
    recordId: uuid('record_id')
      .notNull()
      .references(() => records.id, { onDelete: 'restrict' }),
    applicantId: uuid('applicant_id')
      .notNull()
      .references(() => applicants.id, { onDelete: 'restrict' }),
    kind: varchar('kind', { length: 40 }).notNull(),
    title: varchar('title', { length: 250 }).notNull(),
    publishedOn: timestamp('published_on', { withTimezone: true, mode: 'date' }),
    magazineName: varchar('magazine_name', { length: 200 }),
    pageNumber: varchar('page_number', { length: 20 }),
    url: varchar('url', { length: 1000 }),
    fileKey: varchar('file_key', { length: 500 }),
    notes: text('notes'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    ...timestamps(),
  },
  (t) => [
    index('publications_record_idx').on(t.recordId),
    index('publications_applicant_idx').on(t.applicantId),
    index('publications_kind_idx').on(t.kind, t.publishedOn),
  ],
);

/**
 * Client-progress stages recorded by hand.
 *
 * The eleven-stage badge is derived from real events — a settled invoice, a
 * sent email, a courier delivery date — and holds nothing of its own. This is
 * the exception: an event that genuinely happened where the CRM was not the
 * one to witness it, such as a photo sent over WhatsApp or a delivery confirmed
 * on the phone.
 *
 * Stored as its own dated fact rather than by ticking the stage, so the badge
 * can keep saying *how* it knows. A derived fact always wins; these only ever
 * fill a gap.
 */
export const recordProgressMarks = pgTable(
  'record_progress_marks',
  {
    id: primaryId(),
    recordId: uuid('record_id')
      .notNull()
      .references(() => records.id, { onDelete: 'cascade' }),
    stage: varchar('stage', { length: 40 }).notNull(),
    /** When the thing actually happened, per whoever marked it. */
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
    note: text('note'),
    markedByUserId: uuid('marked_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    markedByName: varchar('marked_by_name', { length: 150 }),
    ...timestamps(),
  },
  (t) => [
    // One answer per stage. Re-marking corrects rather than appending, the same
    // rule the attendance register follows.
    uniqueIndex('record_progress_marks_stage_uq').on(t.recordId, t.stage),
  ],
);

/** §12 Dispatch Module. One live dispatch per record; re-dispatch appends. */
export const dispatches = pgTable(
  'dispatches',
  {
    id: primaryId(),
    recordId: uuid('record_id')
      .notNull()
      .references(() => records.id, { onDelete: 'restrict' }),
    applicantId: uuid('applicant_id')
      .notNull()
      .references(() => applicants.id, { onDelete: 'restrict' }),

    courierPartner: varchar('courier_partner', { length: 120 }).notNull(),
    trackingNumber: varchar('tracking_number', { length: 120 }),
    trackingUrl: varchar('tracking_url', { length: 1000 }),
    dispatchedOn: timestamp('dispatched_on', { withTimezone: true, mode: 'date' }),
    deliveryStatus: varchar('delivery_status', { length: 30 })
      .notNull()
      .default('not_dispatched'),
    deliveredOn: timestamp('delivered_on', { withTimezone: true, mode: 'date' }),
    /** Proof of delivery scan (§12). */
    podKey: varchar('pod_key', { length: 500 }),
    contents: varchar('contents', { length: 500 }),
    remarks: text('remarks'),
    /** Superseded when a parcel is returned and re-sent. */
    isCurrent: boolean('is_current').notNull().default(true),

    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    ...timestamps(),
  },
  (t) => [
    index('dispatches_record_idx').on(t.recordId),
    index('dispatches_status_idx').on(t.deliveryStatus, t.dispatchedOn),
    index('dispatches_tracking_idx')
      .on(t.trackingNumber)
      .where(sql`${t.trackingNumber} is not null`),
    uniqueIndex('dispatches_current_uq')
      .on(t.recordId)
      .where(sql`${t.isCurrent} = true`),
  ],
);

export const evidenceFilesRelations = relations(evidenceFiles, ({ one }) => ({
  record: one(records, { fields: [evidenceFiles.recordId], references: [records.id] }),
  uploadedBy: one(users, { fields: [evidenceFiles.uploadedByUserId], references: [users.id] }),
}));

export const certificatesRelations = relations(certificates, ({ one, many }) => ({
  record: one(records, { fields: [certificates.recordId], references: [records.id] }),
  versions: many(certificateVersions),
}));

export const certificateVersionsRelations = relations(certificateVersions, ({ one }) => ({
  certificate: one(certificates, {
    fields: [certificateVersions.certificateId],
    references: [certificates.id],
  }),
}));

export const dispatchesRelations = relations(dispatches, ({ one }) => ({
  record: one(records, { fields: [dispatches.recordId], references: [records.id] }),
}));

export const publicationsRelations = relations(publications, ({ one }) => ({
  record: one(records, { fields: [publications.recordId], references: [records.id] }),
}));
