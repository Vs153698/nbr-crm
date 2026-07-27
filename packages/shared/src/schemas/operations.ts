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
import { TEMPLATE_CHANNEL, TEMPLATE_CODE } from '../constants/templates';
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

export const sendEmailSchema = z.object({
  recordId: uuidSchema,
  templateCode: z.nativeEnum(TEMPLATE_CODE).optional(),
  to: z.string().email(),
  cc: z.array(z.string().email()).max(5).optional(),
  subject: trimmedString(250),
  body: trimmedString(20000),
  attachmentKeys: z.array(trimmedString(500)).max(5).optional(),
});

export const whatsappLinkSchema = z.object({
  recordId: uuidSchema,
  templateCode: z.nativeEnum(TEMPLATE_CODE),
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

export const upsertTemplateSchema = z.object({
  code: z.nativeEnum(TEMPLATE_CODE),
  channel: z.nativeEnum(TEMPLATE_CHANNEL),
  name: trimmedString(120),
  subject: optionalTrimmedString(250),
  body: trimmedString(20000),
  isActive: z.boolean().default(true),
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
