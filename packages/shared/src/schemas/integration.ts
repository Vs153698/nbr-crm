import { z } from 'zod';
import { RECORD_TYPE } from '../constants/catalog';
import { CONSENT_ARTEFACT, PROCESSING_PURPOSE } from '../constants/dpdp';
import { RECORD_STATUS, type RecordStatus } from '../constants/statuses';
import { emailSchema, optionalTrimmedString, phoneSchema, trimmedString } from './common';

/**
 * How far through its own lifecycle the legacy system has taken an application.
 *
 * Deliberately a short, stable vocabulary rather than the legacy status column
 * verbatim: that column stays at `paid` for the whole of fulfilment and so
 * cannot say whether a certificate has been issued or a parcel has shipped.
 */
export const LEGACY_STAGE = {
  APPROVED: 'approved',
  PAYMENT_RECEIVED: 'payment_received',
  CERTIFICATE_ISSUED: 'certificate_issued',
  DISPATCH_PENDING: 'dispatch_pending',
  DISPATCHED: 'dispatched',
  DELIVERED: 'delivered',
} as const;

export type LegacyStage = (typeof LEGACY_STAGE)[keyof typeof LEGACY_STAGE];

/**
 * Where each legacy stage lands in the CRM's own workflow.
 *
 * `approved` maps to Selected rather than Payment Pending because Payment
 * Pending presupposes a payment plan, and the legacy system raises its own
 * invoice without telling us a package. Selected is the honest equivalent of
 * "approved, awaiting money".
 */
export const LEGACY_STAGE_TO_STATUS: Readonly<Record<LegacyStage, RecordStatus>> = {
  [LEGACY_STAGE.APPROVED]: RECORD_STATUS.SELECTED,
  [LEGACY_STAGE.PAYMENT_RECEIVED]: RECORD_STATUS.PAYMENT_RECEIVED,
  [LEGACY_STAGE.CERTIFICATE_ISSUED]: RECORD_STATUS.CERTIFICATE_UPLOADED,
  [LEGACY_STAGE.DISPATCH_PENDING]: RECORD_STATUS.DISPATCH_PENDING,
  [LEGACY_STAGE.DISPATCHED]: RECORD_STATUS.DISPATCHED,
  [LEGACY_STAGE.DELIVERED]: RECORD_STATUS.DELIVERED,
};

/**
 * Rank used to decide whether an incoming snapshot moves a record forward.
 *
 * A snapshot that describes an *earlier* stage than the CRM already holds is
 * a late or replayed delivery; its lifecycle blocks are still merged, but the
 * record's status is left where it is rather than being dragged backwards.
 */
export const LEGACY_STAGE_RANK: Readonly<Record<LegacyStage, number>> = {
  [LEGACY_STAGE.APPROVED]: 0,
  [LEGACY_STAGE.PAYMENT_RECEIVED]: 1,
  [LEGACY_STAGE.CERTIFICATE_ISSUED]: 2,
  [LEGACY_STAGE.DISPATCH_PENDING]: 3,
  [LEGACY_STAGE.DISPATCHED]: 4,
  [LEGACY_STAGE.DELIVERED]: 5,
};

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
    recordTitle: trimmedString(1000),
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

  /**
   * ── Lifecycle mirror ───────────────────────────────────────────────────────
   *
   * The legacy system sends a *full snapshot* on every event rather than a
   * delta, so the four blocks below describe where the application actually
   * stands right now. Two consequences worth stating:
   *
   *  • A push that gets lost costs nothing — the next one carries the same
   *    state plus whatever changed since.
   *  • Replaying an old event cannot roll the CRM backwards, because the
   *    importer compares the snapshot to what it already holds.
   *
   * All optional: an installation that only ever sends approvals keeps working
   * exactly as it did before these fields existed.
   */
  stage: z.nativeEnum(LEGACY_STAGE).optional(),

  payment: z
    .object({
      externalId: optionalTrimmedString(120),
      plan: optionalTrimmedString(60),
      /** Rupees as a decimal string — the CRM never holds money as a float. */
      amount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
      amountPaise: z.coerce.number().int().nonnegative().optional(),
      currency: optionalTrimmedString(3),
      status: optionalTrimmedString(20),
      method: optionalTrimmedString(40).nullable().optional(),
      referenceNumber: optionalTrimmedString(120).nullable().optional(),
      invoiceUrl: z.string().url().max(1000).nullable().optional(),
      notes: optionalTrimmedString(2000).nullable().optional(),
      paidAt: z.coerce.date().nullable().optional(),
      deadline: z.coerce.date().nullable().optional(),
    })
    .nullable()
    .optional(),

  certificate: z
    .object({
      certificateId: trimmedString(80),
      holderName: optionalTrimmedString(150),
      recordTitle: optionalTrimmedString(1000),
      category: optionalTrimmedString(120),
      issuedAt: z.coerce.date().optional(),
      revoked: z.boolean().default(false),
      revokeReason: optionalTrimmedString(500).nullable().optional(),
      /** Public verification page on the customer site. The CRM links to it
       *  rather than hosting a second copy of the certificate. */
      verificationUrl: z.string().url().max(1000).optional(),
    })
    .nullable()
    .optional(),

  dispatch: z
    .object({
      externalId: optionalTrimmedString(120),
      status: optionalTrimmedString(30),
      courierName: optionalTrimmedString(150).nullable().optional(),
      trackingNumber: optionalTrimmedString(150).nullable().optional(),
      trackingUrl: z.string().url().max(1000).nullable().optional(),
      address: z.record(z.unknown()).nullable().optional(),
      notes: optionalTrimmedString(2000).nullable().optional(),
      dispatchedAt: z.coerce.date().nullable().optional(),
      deliveredAt: z.coerce.date().nullable().optional(),
    })
    .nullable()
    .optional(),

  /**
   * Awardee page on the customer site. Read-only in the CRM: those pages are
   * created and published on the public site, and this is the link across.
   */
  awardee: z
    .object({
      slug: trimmedString(200),
      isPublished: z.boolean().default(false),
      coverImageUrl: z.string().url().max(1000).nullable().optional(),
      publicUrl: z.string().url().max(1000).nullable().optional(),
    })
    .nullable()
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
