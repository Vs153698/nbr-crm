import { z } from 'zod';
import { RECORD_TYPE } from '../constants/catalog';
import { CONSENT_ARTEFACT, PROCESSING_PURPOSE } from '../constants/dpdp';
import { emailSchema, optionalTrimmedString, phoneSchema, trimmedString } from './common';

/**
 * Inbound webhook from the existing NBR website admin panel (P2-14).
 *
 * When an application is approved over there, it POSTs here and the CRM
 * creates or merges the master applicant and opens a new record with source
 * "Website" — zero re-typing. The payload is deliberately loose about optional
 * fields (the legacy system may not have all of them) but strict about the
 * identifiers we need for the merge decision.
 *
 * Transport security: HMAC-SHA256 over the raw body with a shared secret,
 * sent as `X-NBR-Signature: t=<unix>,v1=<hex>`. The timestamp is inside the
 * signed payload so a captured request can't be replayed later, and
 * `externalId` makes retries idempotent.
 */
export const nbrWebhookApplicationSchema = z.object({
  /** The legacy system's own primary key. Idempotency key for this import. */
  externalId: trimmedString(120),
  externalUrl: z.string().url().max(1000).optional(),
  approvedAt: z.coerce.date().optional(),

  applicant: z.object({
    fullName: trimmedString(150),
    fatherName: optionalTrimmedString(150),
    motherName: optionalTrimmedString(150),
    dateOfBirth: z.coerce.date().optional(),
    gender: optionalTrimmedString(20),
    mobile: trimmedString(20),
    whatsapp: phoneSchema.optional(),
    email: emailSchema,
    addressLine: optionalTrimmedString(300),
    city: optionalTrimmedString(100),
    state: optionalTrimmedString(100),
    country: optionalTrimmedString(100),
    pincode: optionalTrimmedString(12),
    nationality: optionalTrimmedString(100),
  }),

  achievement: z.object({
    recordTitle: trimmedString(250),
    /** Free text from the legacy system; mapped to a category by name, falling
     *  back to "Other" and flagging the record for review. */
    category: optionalTrimmedString(150),
    recordType: z.nativeEnum(RECORD_TYPE).default(RECORD_TYPE.INDIVIDUAL),
    description: optionalTrimmedString(5000),
    achievementDate: z.coerce.date().optional(),
    location: optionalTrimmedString(250),
    participantCount: z.coerce.number().int().min(1).default(1),
  }),

  /**
   * Files already collected by the website. The importer copies each one into
   * the vault rather than hot-linking, so the evidence survives the legacy
   * system being retired.
   */
  evidence: z
    .array(
      z.object({
        url: z.string().url().max(2000),
        fileName: optionalTrimmedString(255),
        kind: optionalTrimmedString(40),
        contentType: optionalTrimmedString(120),
      }),
    )
    .max(50)
    .default([]),

  /**
   * Consent the applicant gave on the website. Carried across so the DPDP
   * ledger reflects the real acceptance timestamp, not the import time.
   */
  consent: z
    .object({
      acceptedAt: z.coerce.date(),
      noticeVersion: optionalTrimmedString(20),
      purposes: z.array(z.nativeEnum(PROCESSING_PURPOSE)).default([]),
      artefacts: z.array(z.nativeEnum(CONSENT_ARTEFACT)).default([]),
      ipAddress: optionalTrimmedString(45),
      userAgent: optionalTrimmedString(500),
    })
    .optional(),

  /** Anything the legacy system wants to hand over verbatim. Stored as JSONB. */
  extra: z.record(z.unknown()).optional(),
});

export type NbrWebhookApplication = z.infer<typeof nbrWebhookApplicationSchema>;

export const INTEGRATION_IMPORT_STATUS = {
  RECEIVED: 'received',
  PROCESSING: 'processing',
  IMPORTED: 'imported',
  MERGED: 'merged',
  DUPLICATE_SKIPPED: 'duplicate_skipped',
  BLOCKED_BLACKLIST: 'blocked_blacklist',
  FAILED: 'failed',
} as const;

export type IntegrationImportStatus =
  (typeof INTEGRATION_IMPORT_STATUS)[keyof typeof INTEGRATION_IMPORT_STATUS];

export interface IntegrationSyncStatus {
  readonly lastWebhookAt: string | null;
  readonly lastPollAt: string | null;
  readonly pending: number;
  readonly importedToday: number;
  readonly failedToday: number;
  readonly pollingEnabled: boolean;
  readonly recentFailures: ReadonlyArray<{
    readonly externalId: string;
    readonly error: string;
    readonly at: string;
  }>;
}

/** Header carrying the HMAC signature on inbound webhook requests. */
export const WEBHOOK_SIGNATURE_HEADER = 'x-nbr-signature';
export const WEBHOOK_IDEMPOTENCY_HEADER = 'x-nbr-idempotency-key';
