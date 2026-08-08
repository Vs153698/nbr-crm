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
  // Before any decision. An application is mirrored from the moment it is
  // filed, so the evaluation itself can be run from the CRM.
  SUBMITTED: 'submitted',
  UNDER_REVIEW: 'under_review',
  VALIDATED: 'validated',
  // Decided, and everything after.
  APPROVED: 'approved',
  PAYMENT_RECEIVED: 'payment_received',
  CERTIFICATE_ISSUED: 'certificate_issued',
  DISPATCH_PENDING: 'dispatch_pending',
  DISPATCHED: 'dispatched',
  DELIVERED: 'delivered',
  // Terminal decisions, reachable from anywhere on the ladder.
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
} as const;

export type LegacyStage = (typeof LEGACY_STAGE)[keyof typeof LEGACY_STAGE];

/**
 * Stages that are a *decision* rather than a step along the ladder.
 *
 * These bypass the "only advance" rule below: rejecting an application that had
 * already been approved is a real thing the website can do, and a rank
 * comparison would silently discard it.
 */
export const LEGACY_DECISION_STAGES: readonly LegacyStage[] = [
  LEGACY_STAGE.REJECTED,
  LEGACY_STAGE.CANCELLED,
];

export function isLegacyDecisionStage(stage: LegacyStage): boolean {
  return LEGACY_DECISION_STAGES.includes(stage);
}

/**
 * ── Review actions on a mirrored application ─────────────────────────────────
 *
 * The six decisions the website's admin panel can take on an application, now
 * reachable from here for any record that came from there.
 *
 * The decision is applied *on the website*, not locally. It owns the applicant
 * relationship — their portal login, the address they applied with, the WhatsApp
 * thread, the invoice templates — so routing the decision through it is what
 * makes an approval taken here indistinguishable, to the applicant, from one
 * taken there. The mirrored snapshot then comes back and moves the record.
 */
export const LEGACY_APPLICATION_ACTION = {
  APPROVE: 'approve',
  REJECT: 'reject',
  REQUEST_INFO: 'request_info',
  VALIDATE: 'validate',
  CANCEL: 'cancel',
  REOPEN: 'reopen',
} as const;

export type LegacyApplicationAction =
  (typeof LEGACY_APPLICATION_ACTION)[keyof typeof LEGACY_APPLICATION_ACTION];

export const LEGACY_APPLICATION_ACTION_META: Readonly<
  Record<
    LegacyApplicationAction,
    {
      label: string;
      /** What the applicant is told, so the operator knows before clicking. */
      effect: string;
      /** Which free-text field the action requires, if any. */
      field: 'note' | 'message' | 'reason' | null;
      required: boolean;
      tone: 'primary' | 'danger' | 'warning' | 'secondary';
    }
  >
> = {
  [LEGACY_APPLICATION_ACTION.APPROVE]: {
    label: 'Approve',
    effect: 'Emails and WhatsApps the applicant that they are approved, with the payment deadline.',
    field: 'note',
    required: false,
    tone: 'primary',
  },
  [LEGACY_APPLICATION_ACTION.REJECT]: {
    label: 'Reject',
    effect: 'Emails and WhatsApps the applicant that the application was not accepted, quoting your reason.',
    field: 'note',
    required: true,
    tone: 'danger',
  },
  [LEGACY_APPLICATION_ACTION.REQUEST_INFO]: {
    label: 'Request information',
    effect: 'Emails the applicant asking for what you type below, and moves the application to Under Review.',
    field: 'message',
    required: true,
    tone: 'warning',
  },
  [LEGACY_APPLICATION_ACTION.VALIDATE]: {
    label: 'Mark verified',
    effect: 'Emails the applicant that their documents passed checks and the panel is deciding.',
    field: 'note',
    required: false,
    tone: 'secondary',
  },
  [LEGACY_APPLICATION_ACTION.CANCEL]: {
    label: 'Cancel',
    effect: 'Emails the applicant with your reason, and unpublishes their awardee page and record.',
    field: 'reason',
    required: true,
    tone: 'danger',
  },
  [LEGACY_APPLICATION_ACTION.REOPEN]: {
    label: 'Reopen',
    effect: 'Puts a cancelled or rejected application back into the workflow where it left off.',
    field: 'note',
    required: true,
    tone: 'secondary',
  },
};

export const legacyApplicationActionSchema = z.object({
  action: z.nativeEnum(LEGACY_APPLICATION_ACTION),
  note: optionalTrimmedString(2000),
  message: optionalTrimmedString(2000),
  reason: optionalTrimmedString(2000),
  deadlineHours: z.coerce.number().int().min(1).max(720).optional(),
});

export type LegacyApplicationActionInput = z.infer<typeof legacyApplicationActionSchema>;

/**
 * ── The website's own pipeline, verbatim ─────────────────────────────────────
 *
 * The stage names and step labels the NBR website's admin panel shows, so an
 * operator moving between the two systems reads the same words for the same
 * thing. The CRM keeps its own richer status vocabulary underneath — it drives
 * queues, reports and permissions — but where an application sits *in the
 * website's terms* is what the two systems actually agree on, and that is what
 * this describes.
 *
 * Deliberately a display concern only. Nothing here decides what is allowed;
 * `legacyActionsFor` on the server is the authority, and it mirrors the
 * website's own route guards.
 */
export const LEGACY_PIPELINE_STAGE = {
  SUBMITTED: 'submitted',
  UNDER_REVIEW: 'under_review',
  APPROVED: 'approved',
  PAYMENT_RECEIVED: 'payment_received',
  DISPATCHED: 'dispatched',
} as const;

export type LegacyPipelineStage =
  (typeof LEGACY_PIPELINE_STAGE)[keyof typeof LEGACY_PIPELINE_STAGE];

/** The five steps the website's status rail shows, in order. */
export const LEGACY_PIPELINE: ReadonlyArray<{
  stage: LegacyPipelineStage;
  label: string;
  /** CRM statuses that mean the application has reached this step. */
  statuses: readonly RecordStatus[];
}> = [
  {
    stage: LEGACY_PIPELINE_STAGE.SUBMITTED,
    label: 'Submitted',
    statuses: [RECORD_STATUS.APPLICATION_SUBMITTED],
  },
  {
    stage: LEGACY_PIPELINE_STAGE.UNDER_REVIEW,
    label: 'Under Review',
    statuses: [RECORD_STATUS.UNDER_REVIEW, RECORD_STATUS.VERIFICATION_PENDING],
  },
  {
    stage: LEGACY_PIPELINE_STAGE.APPROVED,
    label: 'Approved',
    statuses: [RECORD_STATUS.SELECTED, RECORD_STATUS.PAYMENT_PENDING],
  },
  {
    stage: LEGACY_PIPELINE_STAGE.PAYMENT_RECEIVED,
    label: 'Payment Received',
    statuses: [
      RECORD_STATUS.PAYMENT_RECEIVED,
      RECORD_STATUS.CERTIFICATE_PENDING,
      RECORD_STATUS.CERTIFICATE_UPLOADED,
      RECORD_STATUS.PUBLICATION,
      RECORD_STATUS.DISPATCH_PENDING,
    ],
  },
  {
    stage: LEGACY_PIPELINE_STAGE.DISPATCHED,
    label: 'Package Dispatched',
    statuses: [
      RECORD_STATUS.DISPATCHED,
      RECORD_STATUS.DELIVERED,
      RECORD_STATUS.COMPLETED,
    ],
  },
];

/** How far along the website's rail a CRM status sits. -1 when off it entirely. */
export function legacyPipelineIndex(status: RecordStatus): number {
  return LEGACY_PIPELINE.findIndex((step) => step.statuses.includes(status));
}

/**
 * Where each legacy stage lands in the CRM's own workflow.
 *
 * `approved` maps to Selected rather than Payment Pending because Payment
 * Pending presupposes a payment plan, and the legacy system raises its own
 * invoice without telling us a package. Selected is the honest equivalent of
 * "approved, awaiting money".
 */
export const LEGACY_STAGE_TO_STATUS: Readonly<Record<LegacyStage, RecordStatus>> = {
  [LEGACY_STAGE.SUBMITTED]: RECORD_STATUS.APPLICATION_SUBMITTED,
  [LEGACY_STAGE.UNDER_REVIEW]: RECORD_STATUS.UNDER_REVIEW,
  // The website's `validated` means the back-office team has checked the
  // application and it is waiting on the approve/reject decision. Verification
  // Pending is the status that occupies that same slot here — after review,
  // before Selected — even though its label reads from the other direction.
  [LEGACY_STAGE.VALIDATED]: RECORD_STATUS.VERIFICATION_PENDING,
  [LEGACY_STAGE.APPROVED]: RECORD_STATUS.SELECTED,
  [LEGACY_STAGE.PAYMENT_RECEIVED]: RECORD_STATUS.PAYMENT_RECEIVED,
  [LEGACY_STAGE.CERTIFICATE_ISSUED]: RECORD_STATUS.CERTIFICATE_UPLOADED,
  [LEGACY_STAGE.DISPATCH_PENDING]: RECORD_STATUS.DISPATCH_PENDING,
  [LEGACY_STAGE.DISPATCHED]: RECORD_STATUS.DISPATCHED,
  [LEGACY_STAGE.DELIVERED]: RECORD_STATUS.DELIVERED,
  [LEGACY_STAGE.REJECTED]: RECORD_STATUS.REJECTED,
  // The website cancels an application that was approved or paid and then
  // abandoned. Closed is this system's terminal-without-completion status.
  [LEGACY_STAGE.CANCELLED]: RECORD_STATUS.CLOSED,
};

/**
 * Rank used to decide whether an incoming snapshot moves a record forward.
 *
 * A snapshot that describes an *earlier* stage than the CRM already holds is
 * a late or replayed delivery; its lifecycle blocks are still merged, but the
 * record's status is left where it is rather than being dragged backwards.
 */
export const LEGACY_STAGE_RANK: Readonly<Record<LegacyStage, number>> = {
  [LEGACY_STAGE.SUBMITTED]: 0,
  [LEGACY_STAGE.UNDER_REVIEW]: 1,
  [LEGACY_STAGE.VALIDATED]: 2,
  [LEGACY_STAGE.APPROVED]: 3,
  [LEGACY_STAGE.PAYMENT_RECEIVED]: 4,
  [LEGACY_STAGE.CERTIFICATE_ISSUED]: 5,
  [LEGACY_STAGE.DISPATCH_PENDING]: 6,
  [LEGACY_STAGE.DISPATCHED]: 7,
  [LEGACY_STAGE.DELIVERED]: 8,
  // Off the ladder. Never compared — `isLegacyDecisionStage` short-circuits the
  // guard first — but every stage needs a rank for the lookup to stay total.
  [LEGACY_STAGE.REJECTED]: -1,
  [LEGACY_STAGE.CANCELLED]: -1,
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
  /**
   * When the application last changed on the website.
   *
   * Folded into the event key the CRM deduplicates on. Without it a state the
   * application *returns* to cannot be told apart from a retry of the first
   * time it held that state — reopening a cancelled application back to
   * `approved` sends a snapshot byte-identical to the original approval, and it
   * was silently dropped as a duplicate.
   */
  sourceUpdatedAt: z.coerce.date().optional(),

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
    /**
     * No length cap, deliberately.
     *
     * A cap here rejects the whole snapshot over the tail of a display string,
     * and the truncation that used to compensate silently altered a title that
     * gets printed on a certificate. The column behind it is unbounded.
     */
    recordTitle: z.string().trim().min(1),
    /** Free text from the legacy system; mapped to a category by name, falling
     *  back to "Other" and flagging the record for review. */
    category: optionalTrimmedString(150),
    recordType: z.nativeEnum(RECORD_TYPE).default(RECORD_TYPE.INDIVIDUAL),
    description: z.string().trim().optional(),
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
      recordTitle: z.string().trim().optional(),
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

  /**
   * The award being applied for — "Bharat Vibhushan" and the like.
   *
   * A first-class block rather than a line in `extra` because the record view
   * badges it, and because `extra` is excluded from the snapshot hash: a
   * correction to the award would otherwise not register as a real change.
   */
  award: z
    .object({
      title: trimmedString(200),
      slug: optionalTrimmedString(250),
      category: optionalTrimmedString(150),
    })
    .nullish(),

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
