import { z } from 'zod';
import {
  ATTACHMENT_KIND,
  COMMUNICATION_CHANNEL,
  DELIVERY_STATUS,
  EVIDENCE_KIND,
  NOTE_CATEGORY,
  PAYMENT_MODE,
  PUBLICATION_KIND,
  TASK_PRIORITY,
  TASK_STATUS,
} from '../constants/catalog';
import { BLACKLIST_KIND, BLACKLIST_REASON, FLAG } from '../constants/flags';
import { RECORD_STATUS } from '../constants/statuses';
import { TEMPLATE_CHANNEL, TEMPLATE_CODE, TEMPLATE_CODE_PATTERN } from '../constants/templates';
import {
  moneySchema,
  optionalTrimmedString,
  trimmedString,
  uuidSchema,
} from './common';

// ── Status changes (§6, M-01) ────────────────────────────────────────────────

export const changeStatusSchema = z.object({
  toStatus: z.nativeEnum(RECORD_STATUS),
  remark: optionalTrimmedString(2000),
  /** Admin override for a locked/terminal transition or a blocked guard. */
  override: z.boolean().default(false),
  overrideReason: optionalTrimmedString(500),
  /** Optimistic lock so two staff cannot double-transition the same record. */
  expectedUpdatedAt: z.coerce.date().optional(),
});

export const assignRecordSchema = z.object({
  assignedToUserId: uuidSchema.nullable(),
  remark: optionalTrimmedString(500),
});

// ── Evidence & attachments (§7, §16, M-05) ───────────────────────────────────

export const presignUploadSchema = z.object({
  fileName: trimmedString(255),
  contentType: trimmedString(120),
  sizeBytes: z.coerce.number().int().positive(),
  scope: z.enum([
    'evidence',
    'attachment',
    'certificate',
    'receipt',
    'invoice',
    'pod',
    'publication',
    'blacklist_document',
    'consent',
    'applicant_photo',
    'employee_document',
  ]),
  recordId: uuidSchema.optional(),
  applicantId: uuidSchema.optional(),
});

export const confirmEvidenceSchema = z.object({
  recordId: uuidSchema,
  kind: z.nativeEnum(EVIDENCE_KIND),
  storageKey: trimmedString(500),
  fileName: trimmedString(255),
  contentType: trimmedString(120),
  sizeBytes: z.coerce.number().int().positive(),
  /** SHA-256 of the uploaded bytes; makes re-uploads idempotent and detects
   *  silent corruption in the vault. */
  checksumSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/i, 'Expected a SHA-256 hex digest')
    .optional(),
  description: optionalTrimmedString(1000),
});

export const confirmAttachmentSchema = confirmEvidenceSchema
  .omit({ kind: true, recordId: true })
  .extend({
    kind: z.nativeEnum(ATTACHMENT_KIND),
    recordId: uuidSchema.optional(),
    applicantId: uuidSchema.optional(),
  })
  .refine((v) => Boolean(v.recordId || v.applicantId), {
    message: 'Attach to either a record or an applicant',
  });

/**
 * §16 — withdrawing a general attachment.
 *
 * The reason is required and has no default. Removing a document from a file
 * that may be looked at years later is a decision, and "why is it gone?" is the
 * only question anyone will have about it — a blank field there is a dead end.
 */
export const deleteAttachmentSchema = z.object({
  reason: trimmedString(500),
});

// ── Payments (§9, M-03) ──────────────────────────────────────────────────────

export const createPaymentPlanSchema = z.object({
  recordId: uuidSchema,
  packageId: uuidSchema.optional(),
  packageName: trimmedString(120),
  amount: moneySchema,
  gstPercent: moneySchema.default('18.00'),
  discount: moneySchema.default('0.00'),
  dueDate: z.coerce.date().optional(),
  notes: optionalTrimmedString(1000),
});

export const recordTransactionSchema = z.object({
  paymentId: uuidSchema,
  amount: moneySchema.refine((v) => Number(v) > 0, 'Amount must be greater than zero'),
  paidOn: z.coerce.date().default(() => new Date()),
  mode: z.nativeEnum(PAYMENT_MODE),
  transactionRef: optionalTrimmedString(120),
  receiptKey: optionalTrimmedString(500),
  remarks: optionalTrimmedString(1000),
  /** Client-supplied key so a double-submitted form records one payment. */
  idempotencyKey: trimmedString(120).optional(),
});

// ── Certificates (§10, M-04) ─────────────────────────────────────────────────

/**
 * Where a certificate stands in the employee-controlled flow.
 *
 * `AWAITING_UPLOAD` is the state of a record in Certificate Verification with
 * no file yet. Uploading moves it to `PENDING_VERIFICATION` — a file exists but
 * nobody has said it is right — and only an employee's sign-off makes it
 * `VERIFIED`, which is the point at which it becomes the official certificate
 * and the record moves on to Dispatch.
 *
 * Uploading a corrected version returns it to `PENDING_VERIFICATION`: the new
 * file inherits nothing from the approval given to the one it replaced.
 */
export const CERTIFICATE_VERIFICATION = {
  AWAITING_UPLOAD: 'awaiting_upload',
  PENDING_VERIFICATION: 'pending_verification',
  VERIFIED: 'verified',
} as const;

export type CertificateVerification =
  (typeof CERTIFICATE_VERIFICATION)[keyof typeof CERTIFICATE_VERIFICATION];

export const CERTIFICATE_VERIFICATION_LABELS: Readonly<
  Record<CertificateVerification, string>
> = {
  [CERTIFICATE_VERIFICATION.AWAITING_UPLOAD]: 'Awaiting upload',
  [CERTIFICATE_VERIFICATION.PENDING_VERIFICATION]: 'Uploaded — awaiting verification',
  [CERTIFICATE_VERIFICATION.VERIFIED]: 'Verified & completed',
};

export const uploadCertificateSchema = z.object({
  recordId: uuidSchema,
  certificateNumber: optionalTrimmedString(80),
  recordNumber: optionalTrimmedString(80),
  issueDate: z.coerce.date(),
  pdfKey: trimmedString(500),
  editableFileKey: optionalTrimmedString(500),
  /** Why a new version exists — shown in the immutable version history. */
  versionReason: optionalTrimmedString(300),
});

/**
 * M-04b Mark Certificate Verified / Complete the certificate stage.
 *
 * Separate from the upload on purpose. Uploading is a file transfer; this is a
 * decision, taken by a named person, that the certificate is correct and may
 * go out — and it is what releases the record to Dispatch.
 */
export const verifyCertificateSchema = z.object({
  recordId: uuidSchema,
  /** What was checked. Lands on the timeline beside who checked it. */
  notes: optionalTrimmedString(1000),
});

// ── Publications (§11) ───────────────────────────────────────────────────────

export const createPublicationSchema = z
  .object({
    recordId: uuidSchema,
    kind: z.nativeEnum(PUBLICATION_KIND),
    title: trimmedString(250),
    publishedOn: z.coerce.date().optional(),
    magazineName: optionalTrimmedString(200),
    pageNumber: optionalTrimmedString(20),
    url: z.string().url('Enter a valid URL').max(1000).optional(),
    fileKey: optionalTrimmedString(500),
    notes: optionalTrimmedString(1000),
  })
  .refine((v) => Boolean(v.url || v.fileKey), {
    message: 'Provide a link or upload the published file',
    path: ['url'],
  });

// ── Dispatch (§12, M-06) ─────────────────────────────────────────────────────

export const upsertDispatchSchema = z.object({
  recordId: uuidSchema,
  courierPartner: trimmedString(120),
  trackingNumber: optionalTrimmedString(120),
  trackingUrl: z.string().url().max(1000).optional(),
  dispatchedOn: z.coerce.date().optional(),
  deliveryStatus: z.nativeEnum(DELIVERY_STATUS).default(DELIVERY_STATUS.DISPATCHED),
  deliveredOn: z.coerce.date().optional(),
  podKey: optionalTrimmedString(500),
  contents: optionalTrimmedString(500),
  remarks: optionalTrimmedString(1000),
  /** Sends the dispatch email + WhatsApp on save (M-06 "Save & Notify"). */
  notifyApplicant: z.boolean().default(false),
});

// ── Notes & tasks (§14, §15, M-02, M-10) ─────────────────────────────────────

export const createNoteSchema = z.object({
  applicantId: uuidSchema,
  recordId: uuidSchema.optional(),
  body: trimmedString(5000),
  category: z.nativeEnum(NOTE_CATEGORY).default(NOTE_CATEGORY.GENERAL),
  priority: z.nativeEnum(TASK_PRIORITY).default(TASK_PRIORITY.NORMAL),
  followUpDate: z.coerce.date().optional(),
  /** Notes are never deleted; editing writes a new revision (§14 edit history). */
  visibleToRoleIds: z.array(uuidSchema).optional(),
});

export const updateNoteSchema = z.object({
  body: trimmedString(5000),
  editReason: optionalTrimmedString(300),
});

export const createTaskSchema = z.object({
  applicantId: uuidSchema.optional(),
  recordId: uuidSchema.optional(),
  title: trimmedString(250),
  description: optionalTrimmedString(2000),
  assignedToUserId: uuidSchema,
  dueDate: z.coerce.date(),
  priority: z.nativeEnum(TASK_PRIORITY).default(TASK_PRIORITY.NORMAL),
  remindAt: z.coerce.date().optional(),
});

export const updateTaskSchema = z.object({
  status: z.nativeEnum(TASK_STATUS).optional(),
  title: optionalTrimmedString(250),
  description: optionalTrimmedString(2000),
  assignedToUserId: uuidSchema.optional(),
  dueDate: z.coerce.date().optional(),
  priority: z.nativeEnum(TASK_PRIORITY).optional(),
  completionRemark: optionalTrimmedString(1000),
});

// ── Communication (§7, §8, §22, M-07, M-08) ──────────────────────────────────

/**
 * A template code as referenced when sending.
 *
 * Not `nativeEnum(TEMPLATE_CODE)`: the whole point of custom templates is that
 * they can be sent, and the enum would have accepted only the seven built-ins.
 * The code is resolved against the templates table at render time, so an
 * unknown one fails there with a message naming it.
 */
const templateCodeRef = z.string().trim().toLowerCase().regex(TEMPLATE_CODE_PATTERN);

export const sendEmailSchema = z.object({
  recordId: uuidSchema,
  templateCode: templateCodeRef.optional(),
  to: z.string().email(),
  cc: z.array(z.string().email()).max(5).optional(),
  subject: trimmedString(250),
  body: trimmedString(20000),
  /**
   * Whether the employee rewrote the message before sending.
   *
   * Decides which layout goes out. Untouched, the template's own areas are
   * re-rendered server-side, keeping its highlighted values and tables. Edited,
   * their words are what gets sent — silently replacing them with the template
   * would discard the very change they opened the box to make.
   */
  bodyEdited: z.boolean().default(false),
  attachmentKeys: z.array(trimmedString(500)).max(5).optional(),
});

export const whatsappLinkSchema = z.object({
  recordId: uuidSchema,
  templateCode: templateCodeRef,
  /** Staff may tweak the rendered text before clicking through. */
  bodyOverride: optionalTrimmedString(4000),
});

export const markWhatsappSentSchema = z.object({
  communicationId: uuidSchema,
});

export const logCallSchema = z.object({
  recordId: uuidSchema.optional(),
  applicantId: uuidSchema,
  summary: trimmedString(4000),
  durationMinutes: z.coerce.number().int().min(0).max(600).optional(),
  outcome: optionalTrimmedString(200),
  followUpDate: z.coerce.date().optional(),
});

/**
 * One editable area of an email.
 *
 * The set is closed on purpose: an Admin writes the words inside a block and
 * never the markup around them, which is what keeps every message on-brand and
 * lets the editor stay free of raw HTML.
 */
export const emailBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('paragraph'), text: trimmedString(4000) }),
  z.object({
    type: z.literal('highlight'),
    label: trimmedString(120),
    value: trimmedString(200),
    caption: optionalTrimmedString(200),
  }),
  z.object({
    type: z.literal('details'),
    title: optionalTrimmedString(120),
    rows: z
      .array(z.object({ label: trimmedString(80), value: trimmedString(300) }))
      .min(1)
      .max(12),
  }),
  z.object({
    type: z.literal('steps'),
    title: trimmedString(120),
    items: z
      .array(z.object({ title: trimmedString(120), text: trimmedString(400) }))
      .min(1)
      .max(6),
  }),
  z.object({
    type: z.literal('button'),
    label: trimmedString(60),
    /**
     * Rejected at save time rather than escaped at render time, so an Admin
     * finds out while they are looking at the field. The renderer drops
     * anything that is not http(s) as a second line of defence.
     */
    url: z
      .string()
      .trim()
      .max(600)
      .regex(/^(https?:\/\/|\{\{)/i, 'Links must start with http:// or https://'),
  }),
  z.object({ type: z.literal('note'), text: trimmedString(2000) }),
]);

/** The full editable content of one email template. */
export const emailDocumentSchema = z.object({
  heading: trimmedString(120),
  subheading: optionalTrimmedString(160),
  blocks: z.array(emailBlockSchema).min(1).max(20),
  signoff: optionalTrimmedString(200),
});

export const upsertTemplateSchema = z
  .object({
    /**
     * Any slug, not just the system codes.
     *
     * Restricting this to the seven built-ins meant an Admin could reword the
     * shipped templates but never add one of their own — so a message the
     * workflow does not model had to be retyped from scratch every time.
     */
    code: z
      .string()
      .trim()
      .toLowerCase()
      .regex(
        TEMPLATE_CODE_PATTERN,
        'Use 2–40 characters: lowercase letters, numbers and underscores, starting with a letter.',
      ),
    channel: z.nativeEnum(TEMPLATE_CHANNEL),
    name: trimmedString(120),
    subject: optionalTrimmedString(250),
    /**
     * WhatsApp is plain text and always will be — the transport has no HTML.
     * Email carries `document` instead, and its `body` is the generated text
     * alternative rather than something anyone types.
     */
    body: optionalTrimmedString(20000),
    document: emailDocumentSchema.optional(),
    isActive: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    if (value.channel === TEMPLATE_CHANNEL.EMAIL && !value.document) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['document'],
        message: 'An email template needs its content areas.',
      });
    }

    if (value.channel === TEMPLATE_CHANNEL.WHATSAPP && !value.body) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['body'],
        message: 'A WhatsApp template needs a message.',
      });
    }
  });

export const communicationListQuerySchema = z.object({
  channel: z.nativeEnum(COMMUNICATION_CHANNEL).optional(),
  recordId: uuidSchema.optional(),
  applicantId: uuidSchema.optional(),
});

// ── Blacklist & flags (§19, §20, M-09) ───────────────────────────────────────

export const createBlacklistSchema = z.object({
  applicantId: uuidSchema,
  kind: z.nativeEnum(BLACKLIST_KIND),
  reason: z.nativeEnum(BLACKLIST_REASON),
  reasonDetail: trimmedString(2000),
  /** Required for a temporary blacklist. */
  effectiveUntil: z.coerce.date().optional(),
  documentKeys: z.array(trimmedString(500)).max(10).default([]),
  remarks: optionalTrimmedString(2000),
});

export const liftBlacklistSchema = z.object({
  reason: trimmedString(1000),
});

export const setFlagSchema = z.object({
  applicantId: uuidSchema,
  flag: z.nativeEnum(FLAG),
  reason: optionalTrimmedString(1000),
  expiresAt: z.coerce.date().optional(),
});

// ── Reports (§24, M-13) ──────────────────────────────────────────────────────

export const REPORT_TYPE = {
  APPLICATIONS: 'applications',
  REVENUE: 'revenue',
  PENDING_PAYMENTS: 'pending_payments',
  PENDING_CERTIFICATES: 'pending_certificates',
  PENDING_DISPATCH: 'pending_dispatch',
  EMPLOYEE_PERFORMANCE: 'employee_performance',
  CATEGORY_WISE: 'category_wise',
  COUNTRY_WISE: 'country_wise',
} as const;

export type ReportType = (typeof REPORT_TYPE)[keyof typeof REPORT_TYPE];

export const EXPORT_FORMAT = {
  XLSX: 'xlsx',
  PDF: 'pdf',
  CSV: 'csv',
} as const;

export type ExportFormat = (typeof EXPORT_FORMAT)[keyof typeof EXPORT_FORMAT];

export const reportQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  employeeId: uuidSchema.optional(),
  categoryId: uuidSchema.optional(),
  status: z.array(z.nativeEnum(RECORD_STATUS)).optional(),
  country: optionalTrimmedString(100),
  groupBy: z.enum(['day', 'week', 'month', 'quarter', 'year']).default('month'),
});

export const exportRequestSchema = reportQuerySchema.extend({
  format: z.nativeEnum(EXPORT_FORMAT),
  columns: z.array(trimmedString(60)).min(1).optional(),
});

/**
 * ── Reference-data catalogue (§26) ───────────────────────────────────────────
 * Categories, packages and couriers are Admin-editable rather than compiled in,
 * so onboarding a new courier or price point needs no deployment. They live in
 * the shared package because both the settings screen and the API validate
 * against exactly these shapes.
 */
export const categorySchema = z.object({
  id: uuidSchema.optional(),
  name: trimmedString(150),
  description: optionalTrimmedString(500),
  isActive: z.boolean().default(true),
});

export const packageSchema = z.object({
  id: uuidSchema.optional(),
  name: trimmedString(120),
  description: optionalTrimmedString(500),
  amount: moneySchema,
  gstPercent: moneySchema.default('18.00'),
  isActive: z.boolean().default(true),
});

export const courierSchema = z.object({
  id: uuidSchema.optional(),
  name: trimmedString(120),
  /** `{trackingNumber}` is substituted when building a tracking link. */
  trackingUrlTemplate: optionalTrimmedString(500),
  isActive: z.boolean().default(true),
});

/**
 * Record a client-progress stage by hand.
 *
 * `occurredAt` is when the thing actually happened, not when it was typed —
 * a photo that arrived last Tuesday is marked as last Tuesday, so the badge
 * reports the event's own date.
 */
export const markProgressSchema = z.object({
  occurredAt: z.coerce.date(),
  note: optionalTrimmedString(500),
});

export type MarkProgressInput = z.infer<typeof markProgressSchema>;
