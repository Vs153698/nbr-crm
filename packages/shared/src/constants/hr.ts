/**
 * Staff directory.
 *
 * Separate from `users`, which governs *login accounts*. Not every employee
 * needs one — field staff, drivers and contractors appear in the directory and
 * never sign in — and an account can outlive the person's employment while the
 * directory record is what HR keeps. The two are linked when both exist so a
 * name is corrected in one place.
 */

export const EMPLOYMENT_TYPE = {
  FULL_TIME: 'full_time',
  PART_TIME: 'part_time',
  CONTRACT: 'contract',
  INTERN: 'intern',
  CONSULTANT: 'consultant',
} as const;

export type EmploymentType = (typeof EMPLOYMENT_TYPE)[keyof typeof EMPLOYMENT_TYPE];

export const EMPLOYMENT_TYPE_LABELS: Readonly<Record<EmploymentType, string>> = {
  [EMPLOYMENT_TYPE.FULL_TIME]: 'Full time',
  [EMPLOYMENT_TYPE.PART_TIME]: 'Part time',
  [EMPLOYMENT_TYPE.CONTRACT]: 'Contract',
  [EMPLOYMENT_TYPE.INTERN]: 'Intern',
  [EMPLOYMENT_TYPE.CONSULTANT]: 'Consultant',
};

export const EMPLOYEE_STATUS = {
  ACTIVE: 'active',
  ON_LEAVE: 'on_leave',
  NOTICE_PERIOD: 'notice_period',
  /** Kept, never deleted — payroll, audit and record history all reference them. */
  EXITED: 'exited',
} as const;

export type EmployeeStatus = (typeof EMPLOYEE_STATUS)[keyof typeof EMPLOYEE_STATUS];

export const EMPLOYEE_STATUS_META: Readonly<
  Record<EmployeeStatus, { label: string; tone: 'green' | 'orange' | 'red' | 'slate' }>
> = {
  [EMPLOYEE_STATUS.ACTIVE]: { label: 'Active', tone: 'green' },
  [EMPLOYEE_STATUS.ON_LEAVE]: { label: 'On leave', tone: 'orange' },
  [EMPLOYEE_STATUS.NOTICE_PERIOD]: { label: 'Notice period', tone: 'orange' },
  [EMPLOYEE_STATUS.EXITED]: { label: 'Exited', tone: 'slate' },
};

/**
 * ── Onboarding documents ─────────────────────────────────────────────────────
 *
 * The joining file: what HR collects on day one and refers back to for years.
 * A closed list rather than free text, because "PAN" / "Pan card" / "pancard"
 * typed by three people is a folder nobody can search.
 */
export const EMPLOYEE_DOCUMENT_KIND = {
  OFFER_LETTER: 'offer_letter',
  APPOINTMENT_LETTER: 'appointment_letter',
  ID_PROOF: 'id_proof',
  ADDRESS_PROOF: 'address_proof',
  PAN_CARD: 'pan_card',
  EDUCATION: 'education',
  EXPERIENCE: 'experience',
  BANK_DETAILS: 'bank_details',
  PHOTOGRAPH: 'photograph',
  CONTRACT: 'contract',
  POLICY_ACKNOWLEDGEMENT: 'policy_acknowledgement',
  OTHER: 'other',
} as const;

export type EmployeeDocumentKind =
  (typeof EMPLOYEE_DOCUMENT_KIND)[keyof typeof EMPLOYEE_DOCUMENT_KIND];

export const EMPLOYEE_DOCUMENT_KIND_LABELS: Readonly<Record<EmployeeDocumentKind, string>> = {
  [EMPLOYEE_DOCUMENT_KIND.OFFER_LETTER]: 'Offer letter',
  [EMPLOYEE_DOCUMENT_KIND.APPOINTMENT_LETTER]: 'Appointment letter',
  [EMPLOYEE_DOCUMENT_KIND.ID_PROOF]: 'ID proof',
  [EMPLOYEE_DOCUMENT_KIND.ADDRESS_PROOF]: 'Address proof',
  [EMPLOYEE_DOCUMENT_KIND.PAN_CARD]: 'PAN card',
  [EMPLOYEE_DOCUMENT_KIND.EDUCATION]: 'Education certificate',
  [EMPLOYEE_DOCUMENT_KIND.EXPERIENCE]: 'Experience letter',
  [EMPLOYEE_DOCUMENT_KIND.BANK_DETAILS]: 'Bank details',
  [EMPLOYEE_DOCUMENT_KIND.PHOTOGRAPH]: 'Photograph',
  [EMPLOYEE_DOCUMENT_KIND.CONTRACT]: 'Contract',
  [EMPLOYEE_DOCUMENT_KIND.POLICY_ACKNOWLEDGEMENT]: 'Policy acknowledgement',
  [EMPLOYEE_DOCUMENT_KIND.OTHER]: 'Other',
};

/**
 * Kinds carrying a government identifier. Flagged on upload so the file is
 * badged in the directory and every download of one is written to the audit
 * log — the same treatment an applicant's ID proof gets under DPDP §8(4).
 */
export const SENSITIVE_EMPLOYEE_DOCUMENT_KINDS: readonly EmployeeDocumentKind[] = [
  EMPLOYEE_DOCUMENT_KIND.ID_PROOF,
  EMPLOYEE_DOCUMENT_KIND.ADDRESS_PROOF,
  EMPLOYEE_DOCUMENT_KIND.PAN_CARD,
  EMPLOYEE_DOCUMENT_KIND.BANK_DETAILS,
];

export function isSensitiveEmployeeDocument(kind: string): boolean {
  return SENSITIVE_EMPLOYEE_DOCUMENT_KINDS.includes(kind as EmployeeDocumentKind);
}

/** Editable from Settings later; seeded so the form has something to offer. */
export const DEFAULT_DEPARTMENTS: readonly string[] = [
  'Sales',
  'Verification',
  'Operations',
  'Accounts',
  'Marketing',
  'Customer Support',
  'Technology',
  'Administration',
  'Management',
];
