import { z } from 'zod';
import {
  BREACH_SEVERITY,
  BREACH_STATUS,
  CONSENT_ARTEFACT,
  CONSENT_CHANNEL,
  DSR_STATUS,
  DSR_TYPE,
  PROCESSING_PURPOSE,
} from '../constants/dpdp';
import {
  emailSchema,
  optionalTrimmedString,
  phoneSchema,
  trimmedString,
  uuidSchema,
} from './common';

/** Record or update consent for an applicant (DPDP §6). */
export const recordConsentSchema = z.object({
  applicantId: uuidSchema,
  recordId: uuidSchema.optional(),
  purposes: z.array(z.nativeEnum(PROCESSING_PURPOSE)).min(1),
  artefacts: z.array(z.nativeEnum(CONSENT_ARTEFACT)).default([]),
  channel: z.nativeEnum(CONSENT_CHANNEL),
  noticeVersion: trimmedString(20),
  guardianName: optionalTrimmedString(150),
  guardianRelationship: optionalTrimmedString(60),
  guardianContact: phoneSchema.optional(),
  evidenceKey: optionalTrimmedString(500),
  /** Free-text record of what was said, for verbal consent on a call. */
  capturedNotes: optionalTrimmedString(2000),
});

/**
 * Withdrawal is per-purpose (§6(4)) and never deletes the consent history —
 * it appends a withdrawal row so the ledger stays a complete, provable record.
 */
export const withdrawConsentSchema = z.object({
  applicantId: uuidSchema,
  purposes: z.array(z.nativeEnum(PROCESSING_PURPOSE)).min(1),
  reason: optionalTrimmedString(1000),
  /** Withdrawal received from the applicant vs. actioned by staff on request. */
  channel: z.nativeEnum(CONSENT_CHANNEL),
});

/** Data-principal request intake (§11–§14). */
export const createDsrSchema = z.object({
  applicantId: uuidSchema.optional(),
  type: z.nativeEnum(DSR_TYPE),
  /** Contact details as supplied by the requester, before identity is verified. */
  requesterName: trimmedString(150),
  requesterEmail: emailSchema.optional(),
  requesterPhone: phoneSchema.optional(),
  details: trimmedString(5000),
  receivedVia: z.nativeEnum(CONSENT_CHANNEL),
  attachmentKeys: z.array(trimmedString(500)).max(10).default([]),
});

export const updateDsrSchema = z.object({
  status: z.nativeEnum(DSR_STATUS),
  assignedToUserId: uuidSchema.optional(),
  /** Mandatory when rejecting or partially fulfilling — the applicant is owed
   *  a reason, and the Board may ask for it later. */
  resolutionNotes: optionalTrimmedString(5000),
  identityVerifiedAt: z.coerce.date().optional(),
  identityVerificationMethod: optionalTrimmedString(200),
});

/**
 * Execute an erasure request. Anonymises rather than hard-deletes: financial
 * and certificate history must survive for statutory retention (§8(7) permits
 * retention where required by law), but every direct identifier is destroyed
 * and the row is tombstoned.
 */
export const executeErasureSchema = z.object({
  applicantId: uuidSchema,
  dsrId: uuidSchema.optional(),
  /** Typed confirmation string, matching the applicant code. */
  confirmation: trimmedString(40),
  reason: trimmedString(1000),
  /** Keep the financial + certificate trail (default) or purge everything the
   *  law allows to go. */
  retainFinancialRecords: z.boolean().default(true),
});

/** Personal data breach register (§8(5)). */
export const createBreachSchema = z.object({
  title: trimmedString(250),
  detectedAt: z.coerce.date(),
  severity: z.nativeEnum(BREACH_SEVERITY),
  description: trimmedString(5000),
  affectedApplicantCount: z.coerce.number().int().min(0).default(0),
  dataCategories: z.array(trimmedString(60)).default([]),
  containmentActions: optionalTrimmedString(5000),
});

export const updateBreachSchema = z.object({
  status: z.nativeEnum(BREACH_STATUS).optional(),
  severity: z.nativeEnum(BREACH_SEVERITY).optional(),
  boardNotifiedAt: z.coerce.date().optional(),
  principalsNotifiedAt: z.coerce.date().optional(),
  containmentActions: optionalTrimmedString(5000),
  rootCause: optionalTrimmedString(5000),
  remediation: optionalTrimmedString(5000),
  closedAt: z.coerce.date().optional(),
});

/** Reveal a decrypted government identifier. Always audited (§8(4)). */
export const revealIdentifierSchema = z.object({
  applicantId: uuidSchema,
  field: z.enum(['aadhaarNumber', 'passportNumber', 'panNumber']),
  /** Why the reveal is necessary — written verbatim into the PII access log. */
  reason: trimmedString(300),
});

/** Consent notice (§5) served to the applicant-facing form and the intake UI. */
export interface ConsentNotice {
  readonly version: string;
  readonly fiduciaryName: string;
  readonly grievanceOfficer: {
    readonly name: string;
    readonly email: string;
    readonly phone: string | null;
  };
  readonly purposes: ReadonlyArray<{
    readonly code: string;
    readonly label: string;
    readonly notice: string;
    readonly basis: string;
    readonly essential: boolean;
  }>;
  readonly rights: readonly string[];
  readonly retentionSummary: string;
  readonly updatedAt: string;
}
