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
import { users } from './identity';

/**
 * ── Master applicant profile (§4) ────────────────────────────────────────────
 *
 * The central rule of both requirement documents, enforced here at the schema
 * level: one person = one row, forever. A repeat applicant gets another row in
 * `records`, never another row here.
 */
export const applicants = pgTable(
  'applicants',
  {
    id: primaryId(),
    /** Human-facing ID: NBRAP00001. Generated from a Postgres sequence. */
    applicantCode: varchar('applicant_code', { length: 20 }).notNull(),

    fullName: varchar('full_name', { length: 150 }).notNull(),
    fatherName: varchar('father_name', { length: 150 }),
    motherName: varchar('mother_name', { length: 150 }),
    dateOfBirth: date('date_of_birth', { mode: 'string' }),
    gender: varchar('gender', { length: 20 }),

    mobile: varchar('mobile', { length: 20 }).notNull(),
    /** Last 10 digits, punctuation stripped — the duplicate-detection key. */
    mobileNormalised: varchar('mobile_normalised', { length: 15 }),
    whatsapp: varchar('whatsapp', { length: 20 }),
    email: varchar('email', { length: 255 }).notNull(),
    emailNormalised: varchar('email_normalised', { length: 255 }),

    addressLine: varchar('address_line', { length: 300 }),
    city: varchar('city', { length: 100 }),
    state: varchar('state', { length: 100 }),
    country: varchar('country', { length: 100 }).notNull().default('India'),
    pincode: varchar('pincode', { length: 12 }),
    nationality: varchar('nationality', { length: 100 }),
    photoKey: varchar('photo_key', { length: 500 }),

    /** Lowercased, punctuation-free name — feeds the trigram index. */
    nameNormalised: varchar('name_normalised', { length: 200 }),

    /** Denormalised counters so the list view needs no correlated subquery. */
    recordCount: integer('record_count').notNull().default(0),

    /** True while any blacklist row is in force — kept in sync by the service
     *  layer so list queries and the red banner need no join. */
    isBlacklisted: boolean('is_blacklisted').notNull().default(false),

    /** DPDP §9: applicant was a minor at intake, so parental consent applies. */
    isMinorAtIntake: boolean('is_minor_at_intake').notNull().default(false),

    /** Set when a DPDP §12 erasure request has been executed. The row survives
     *  (financial and certificate history must), but every direct identifier
     *  above has been overwritten. */
    erasedAt: timestamp('erased_at', { withTimezone: true, mode: 'date' }),

    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    ...timestamps(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('applicants_code_uq').on(t.applicantCode),
    // Duplicate detection (§18): a mobile number identifies a person. Enforced
    // as a partial unique index so the admin-override path can soft-delete and
    // re-create, and so erased rows (mobile nulled) don't collide.
    uniqueIndex('applicants_mobile_uq')
      .on(t.mobileNormalised)
      .where(sql`${t.deletedAt} is null and ${t.mobileNormalised} is not null`),
    index('applicants_email_idx')
      .on(t.emailNormalised)
      .where(sql`${t.deletedAt} is null`),
    index('applicants_updated_idx').on(t.updatedAt),
    index('applicants_blacklist_idx')
      .on(t.isBlacklisted)
      .where(sql`${t.isBlacklisted} = true`),
    index('applicants_city_state_idx').on(t.country, t.state, t.city),
    // Fuzzy name+DOB matching for the §18 "Possible Existing Applicant Found"
    // warning. GIN trigram index — `name_normalised % 'rahul verma'` in <10ms
    // at 100k rows. Created in raw SQL because drizzle-kit can't express
    // gin_trgm_ops; see migrations/0002_search_indexes.sql.
    index('applicants_dob_idx')
      .on(t.dateOfBirth)
      .where(sql`${t.dateOfBirth} is not null`),
  ],
);

/**
 * Government identifiers, split out of `applicants` on purpose.
 *
 * DPDP §8(4) reasonable security safeguards: these values are encrypted with
 * AES-256-GCM before they ever reach Postgres, and every decryption is written
 * to `pii_access_log`. Keeping them in their own table means an accidental
 * `SELECT * FROM applicants` in a report or export can never leak an Aadhaar.
 */
export const applicantIdentifiers = pgTable(
  'applicant_identifiers',
  {
    id: primaryId(),
    applicantId: uuid('applicant_id')
      .notNull()
      .references(() => applicants.id, { onDelete: 'cascade' }),

    /** `v1:<iv>:<authTag>:<ciphertext>`, all base64. Never a plaintext value. */
    aadhaarEncrypted: text('aadhaar_encrypted'),
    /** HMAC-SHA256 of the normalised value under a server-side key. Lets us
     *  detect "same Aadhaar" without ever decrypting or storing plaintext. */
    aadhaarFingerprint: varchar('aadhaar_fingerprint', { length: 64 }),
    /** Last 4 digits, so the UI can show XXXX XXXX 1234 without a decrypt. */
    aadhaarLast4: varchar('aadhaar_last4', { length: 4 }),

    passportEncrypted: text('passport_encrypted'),
    passportFingerprint: varchar('passport_fingerprint', { length: 64 }),
    passportLast4: varchar('passport_last4', { length: 4 }),

    panEncrypted: text('pan_encrypted'),
    panFingerprint: varchar('pan_fingerprint', { length: 64 }),
    panLast4: varchar('pan_last4', { length: 4 }),

    /** Which key version encrypted these values — supports key rotation. */
    keyVersion: integer('key_version').notNull().default(1),

    ...timestamps(),
  },
  (t) => [
    uniqueIndex('applicant_identifiers_applicant_uq').on(t.applicantId),
    index('applicant_identifiers_aadhaar_fp_idx')
      .on(t.aadhaarFingerprint)
      .where(sql`${t.aadhaarFingerprint} is not null`),
    index('applicant_identifiers_passport_fp_idx')
      .on(t.passportFingerprint)
      .where(sql`${t.passportFingerprint} is not null`),
  ],
);

/**
 * ── Blacklist (§19) ──────────────────────────────────────────────────────────
 * Temporary or permanent, with supporting documents. Never deleted — lifting a
 * blacklist sets `liftedAt` so the history of why someone was blocked survives.
 */
export const blacklists = pgTable(
  'blacklists',
  {
    id: primaryId(),
    applicantId: uuid('applicant_id')
      .notNull()
      .references(() => applicants.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 20 }).notNull(),
    reason: varchar('reason', { length: 40 }).notNull(),
    reasonDetail: text('reason_detail').notNull(),
    remarks: text('remarks'),
    /** Storage keys of supporting documents (§19). */
    documentKeys: jsonb('document_keys').$type<string[]>().notNull().default(sql`'[]'::jsonb`),

    effectiveFrom: timestamp('effective_from', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    /** Null for a permanent ban. */
    effectiveUntil: timestamp('effective_until', { withTimezone: true, mode: 'date' }),

    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    liftedAt: timestamp('lifted_at', { withTimezone: true, mode: 'date' }),
    liftedByUserId: uuid('lifted_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    liftReason: text('lift_reason'),

    ...timestamps(),
  },
  (t) => [
    index('blacklists_applicant_idx').on(t.applicantId),
    // Hot path: "is this applicant blocked right now?"
    index('blacklists_active_idx')
      .on(t.applicantId, t.effectiveUntil)
      .where(sql`${t.liftedAt} is null`),
  ],
);

/**
 * ── Restriction flags (§20) ──────────────────────────────────────────────────
 * Orthogonal to blacklist and to workflow status. Flags render next to the
 * applicant's name everywhere and can block specific actions.
 */
export const applicantFlags = pgTable(
  'applicant_flags',
  {
    id: primaryId(),
    applicantId: uuid('applicant_id')
      .notNull()
      .references(() => applicants.id, { onDelete: 'cascade' }),
    flag: varchar('flag', { length: 40 }).notNull(),
    reason: text('reason'),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    setByUserId: uuid('set_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    removedAt: timestamp('removed_at', { withTimezone: true, mode: 'date' }),
    removedByUserId: uuid('removed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
  },
  (t) => [
    // One live instance of a given flag per applicant.
    uniqueIndex('applicant_flags_active_uq')
      .on(t.applicantId, t.flag)
      .where(sql`${t.removedAt} is null`),
    index('applicant_flags_applicant_idx').on(t.applicantId),
  ],
);

export const applicantsRelations = relations(applicants, ({ one, many }) => ({
  identifiers: one(applicantIdentifiers, {
    fields: [applicants.id],
    references: [applicantIdentifiers.applicantId],
  }),
  createdBy: one(users, { fields: [applicants.createdByUserId], references: [users.id] }),
  blacklists: many(blacklists),
  flags: many(applicantFlags),
}));

export const blacklistsRelations = relations(blacklists, ({ one }) => ({
  applicant: one(applicants, { fields: [blacklists.applicantId], references: [applicants.id] }),
  createdBy: one(users, { fields: [blacklists.createdByUserId], references: [users.id] }),
}));

export const applicantFlagsRelations = relations(applicantFlags, ({ one }) => ({
  applicant: one(applicants, {
    fields: [applicantFlags.applicantId],
    references: [applicants.id],
  }),
}));
