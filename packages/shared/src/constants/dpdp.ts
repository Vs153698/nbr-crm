/**
 * ── Digital Personal Data Protection Act, 2023 (India) ───────────────────────
 *
 * NBR is the Data Fiduciary; applicants are Data Principals. This file encodes
 * the compliance vocabulary the rest of the system enforces:
 *
 *  §4/§6  lawful basis + free, specific, informed, unconditional consent
 *  §5     itemised notice, in English or any Eighth Schedule language
 *  §8(4)  reasonable security safeguards (see crypto + RBAC layers)
 *  §8(5)  personal data breach notification to the Board and affected principals
 *  §8(7)  erase personal data once the purpose is no longer served
 *  §9     verifiable consent of a parent/guardian for children under 18
 *  §11    right to access information about processing
 *  §12    right to correction, completion, updating and erasure
 *  §13    right of grievance redressal (Grievance Officer)
 *  §14    right to nominate
 *
 * None of this is advice — it is the implementation contract agreed with the
 * client. Legal review before go-live is listed in the launch checklist.
 */

/** Why a given piece of personal data is being processed (purpose limitation). */
export const PROCESSING_PURPOSE = {
  RECORD_APPLICATION: 'record_application',
  IDENTITY_VERIFICATION: 'identity_verification',
  ACHIEVEMENT_VERIFICATION: 'achievement_verification',
  PAYMENT_AND_INVOICING: 'payment_and_invoicing',
  CERTIFICATE_ISSUANCE: 'certificate_issuance',
  PUBLICATION_AND_MEDIA: 'publication_and_media',
  DISPATCH_AND_LOGISTICS: 'dispatch_and_logistics',
  SERVICE_COMMUNICATION: 'service_communication',
  LEGAL_COMPLIANCE: 'legal_compliance',
} as const;

export type ProcessingPurpose =
  (typeof PROCESSING_PURPOSE)[keyof typeof PROCESSING_PURPOSE];

export interface PurposeMeta {
  readonly code: ProcessingPurpose;
  readonly label: string;
  /** Plain-language description shown in the §5 notice. */
  readonly notice: string;
  /** Consent (§6) vs. a legitimate use under §7 that needs no consent. */
  readonly basis: 'consent' | 'legitimate_use';
  /** Withdrawing consent for a required purpose stops the application. */
  readonly essential: boolean;
}

export const PURPOSE_META: Readonly<Record<ProcessingPurpose, PurposeMeta>> = {
  [PROCESSING_PURPOSE.RECORD_APPLICATION]: {
    code: PROCESSING_PURPOSE.RECORD_APPLICATION,
    label: 'Record application processing',
    notice:
      'To register and process your record application, maintain your permanent applicant profile, and communicate decisions.',
    basis: 'consent',
    essential: true,
  },
  [PROCESSING_PURPOSE.IDENTITY_VERIFICATION]: {
    code: PROCESSING_PURPOSE.IDENTITY_VERIFICATION,
    label: 'Identity verification',
    notice:
      'To verify that you are the person claiming the record, using the identity document you provide (Aadhaar, passport or equivalent).',
    basis: 'consent',
    essential: true,
  },
  [PROCESSING_PURPOSE.ACHIEVEMENT_VERIFICATION]: {
    code: PROCESSING_PURPOSE.ACHIEVEMENT_VERIFICATION,
    label: 'Achievement verification',
    notice:
      'To assess the evidence (photos, videos, documents, witness statements) submitted in support of your record attempt.',
    basis: 'consent',
    essential: true,
  },
  [PROCESSING_PURPOSE.PAYMENT_AND_INVOICING]: {
    code: PROCESSING_PURPOSE.PAYMENT_AND_INVOICING,
    label: 'Payment and invoicing',
    notice:
      'To raise invoices, record payments and meet tax and accounting obligations.',
    basis: 'legitimate_use',
    essential: true,
  },
  [PROCESSING_PURPOSE.CERTIFICATE_ISSUANCE]: {
    code: PROCESSING_PURPOSE.CERTIFICATE_ISSUANCE,
    label: 'Certificate issuance',
    notice: 'To prepare, issue and re-issue your record certificate.',
    basis: 'consent',
    essential: true,
  },
  [PROCESSING_PURPOSE.PUBLICATION_AND_MEDIA]: {
    code: PROCESSING_PURPOSE.PUBLICATION_AND_MEDIA,
    label: 'Publication and media',
    notice:
      'To publish your name, photograph and record details in the National Book of Records magazine, e-news, website and social media.',
    basis: 'consent',
    // Optional: an applicant can hold a record without agreeing to publicity.
    essential: false,
  },
  [PROCESSING_PURPOSE.DISPATCH_AND_LOGISTICS]: {
    code: PROCESSING_PURPOSE.DISPATCH_AND_LOGISTICS,
    label: 'Dispatch and logistics',
    notice:
      'To share your name, address and phone number with courier partners so your certificate and memento can be delivered.',
    basis: 'consent',
    essential: false,
  },
  [PROCESSING_PURPOSE.SERVICE_COMMUNICATION]: {
    code: PROCESSING_PURPOSE.SERVICE_COMMUNICATION,
    label: 'Service communication',
    notice:
      'To contact you by email, WhatsApp or phone about your application, payment and dispatch.',
    basis: 'consent',
    essential: true,
  },
  [PROCESSING_PURPOSE.LEGAL_COMPLIANCE]: {
    code: PROCESSING_PURPOSE.LEGAL_COMPLIANCE,
    label: 'Legal and regulatory compliance',
    notice:
      'To retain records required by law, respond to legal process, and defend legal claims.',
    basis: 'legitimate_use',
    essential: true,
  },
};

/** Consent artefacts captured per applicant (§21 of the V1.0 doc). */
export const CONSENT_ARTEFACT = {
  TERMS_AND_CONDITIONS: 'terms_and_conditions',
  PRIVACY_NOTICE: 'privacy_notice',
  DECLARATION: 'declaration',
  PARENT_GUARDIAN_CONSENT: 'parent_guardian_consent',
  COPYRIGHT_CONSENT: 'copyright_consent',
  MEDIA_CONSENT: 'media_consent',
} as const;

export type ConsentArtefact = (typeof CONSENT_ARTEFACT)[keyof typeof CONSENT_ARTEFACT];

export const CONSENT_CHANNEL = {
  WEBSITE_FORM: 'website_form',
  PAPER_FORM: 'paper_form',
  EMAIL: 'email',
  WHATSAPP: 'whatsapp',
  VERBAL_ON_CALL: 'verbal_on_call',
  STAFF_ENTERED: 'staff_entered',
} as const;

export type ConsentChannel = (typeof CONSENT_CHANNEL)[keyof typeof CONSENT_CHANNEL];

/** Data-principal request types (§11–§14). */
export const DSR_TYPE = {
  ACCESS: 'access',
  CORRECTION: 'correction',
  ERASURE: 'erasure',
  NOMINATION: 'nomination',
  GRIEVANCE: 'grievance',
  CONSENT_WITHDRAWAL: 'consent_withdrawal',
} as const;

export type DsrType = (typeof DSR_TYPE)[keyof typeof DSR_TYPE];

export const DSR_TYPE_LABELS: Readonly<Record<DsrType, string>> = {
  [DSR_TYPE.ACCESS]: 'Access — summary of personal data & processing (§11)',
  [DSR_TYPE.CORRECTION]: 'Correction / completion / updating (§12)',
  [DSR_TYPE.ERASURE]: 'Erasure of personal data (§12)',
  [DSR_TYPE.NOMINATION]: 'Nomination of another individual (§14)',
  [DSR_TYPE.GRIEVANCE]: 'Grievance to the Grievance Officer (§13)',
  [DSR_TYPE.CONSENT_WITHDRAWAL]: 'Withdrawal of consent (§6(4))',
};

export const DSR_STATUS = {
  RECEIVED: 'received',
  IDENTITY_PENDING: 'identity_pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  REJECTED: 'rejected',
  PARTIALLY_FULFILLED: 'partially_fulfilled',
} as const;

export type DsrStatus = (typeof DSR_STATUS)[keyof typeof DSR_STATUS];

/**
 * Sensitivity classification. Drives encryption at rest, masking in the UI,
 * whether a read is written to the PII access log, and the retention job.
 */
export const DATA_CLASS = {
  /** Business data, no personal identifiers. */
  INTERNAL: 'internal',
  /** Ordinary personal data — name, city, record title. */
  PERSONAL: 'personal',
  /** Direct contact identifiers — mobile, email, full address. */
  CONTACT: 'contact',
  /** Government identifiers — Aadhaar, passport, PAN. Encrypted + masked. */
  IDENTIFIER: 'identifier',
  /** Data about an applicant under 18 — §9 verifiable parental consent. */
  CHILD: 'child',
  /** Financial — transaction ids, bank references. */
  FINANCIAL: 'financial',
} as const;

export type DataClass = (typeof DATA_CLASS)[keyof typeof DATA_CLASS];

/** Personal data breach severity, for the §8(5) notification workflow. */
export const BREACH_SEVERITY = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
} as const;

export type BreachSeverity = (typeof BREACH_SEVERITY)[keyof typeof BREACH_SEVERITY];

export const BREACH_STATUS = {
  DETECTED: 'detected',
  UNDER_ASSESSMENT: 'under_assessment',
  BOARD_NOTIFIED: 'board_notified',
  PRINCIPALS_NOTIFIED: 'principals_notified',
  CONTAINED: 'contained',
  CLOSED: 'closed',
} as const;

export type BreachStatus = (typeof BREACH_STATUS)[keyof typeof BREACH_STATUS];

/** Age below which §9 verifiable parental consent is mandatory. */
export const CHILD_AGE_THRESHOLD_YEARS = 18;

/** Current version of the consent notice. Bump on any wording change — old
 *  acceptances keep pointing at the version they actually agreed to. */
export const CONSENT_NOTICE_VERSION = '1.0';
