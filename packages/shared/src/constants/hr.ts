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

/**
 * ── Probation ───────────────────────────────────────────────────────────────
 *
 * A period, not a status. `EMPLOYEE_STATUS` says whether someone is working,
 * on leave or gone; probation is orthogonal to all three and is decided by a
 * date — which is why it lives as `probationEndsOn` on the employee rather than
 * as a fifth status that would have to be manually cleared and never would be.
 *
 * The badge on the profile is derived: a date in the future means "on
 * probation", a date in the past or none at all means confirmed.
 */
export function isOnProbation(probationEndsOn: string | null, now = new Date()): boolean {
  if (!probationEndsOn) return false;
  return new Date(probationEndsOn).getTime() > now.getTime();
}

/**
 * ── Attendance (§HR) ────────────────────────────────────────────────────────
 *
 * One row per person per day. `WEEK_OFF` and `HOLIDAY` are recorded rather than
 * left blank on purpose: a missing row is ambiguous — nobody marked it, or
 * nobody was expected in? — and payroll has to be able to tell those apart.
 */
export const ATTENDANCE_STATUS = {
  PRESENT: 'present',
  ABSENT: 'absent',
  HALF_DAY: 'half_day',
  ON_LEAVE: 'on_leave',
  WEEK_OFF: 'week_off',
  HOLIDAY: 'holiday',
  WORK_FROM_HOME: 'work_from_home',
} as const;

export type AttendanceStatus = (typeof ATTENDANCE_STATUS)[keyof typeof ATTENDANCE_STATUS];

export const ATTENDANCE_STATUS_META: Readonly<
  Record<
    AttendanceStatus,
    {
      label: string;
      tone: 'green' | 'orange' | 'red' | 'slate' | 'blue';
      /** How much of a working day this counts for, when payroll totals it. */
      dayValue: number;
    }
  >
> = {
  [ATTENDANCE_STATUS.PRESENT]: { label: 'Present', tone: 'green', dayValue: 1 },
  [ATTENDANCE_STATUS.WORK_FROM_HOME]: { label: 'Work from home', tone: 'blue', dayValue: 1 },
  [ATTENDANCE_STATUS.HALF_DAY]: { label: 'Half day', tone: 'orange', dayValue: 0.5 },
  [ATTENDANCE_STATUS.ON_LEAVE]: { label: 'On leave', tone: 'orange', dayValue: 0 },
  [ATTENDANCE_STATUS.ABSENT]: { label: 'Absent', tone: 'red', dayValue: 0 },
  // Not worked and not owed — these are days nobody was expected in, so they
  // count as neither attendance nor absence.
  [ATTENDANCE_STATUS.WEEK_OFF]: { label: 'Week off', tone: 'slate', dayValue: 0 },
  [ATTENDANCE_STATUS.HOLIDAY]: { label: 'Holiday', tone: 'slate', dayValue: 0 },
};

/** Days that were never expected to be worked. Excluded from payable totals. */
export const NON_WORKING_ATTENDANCE: readonly AttendanceStatus[] = [
  ATTENDANCE_STATUS.WEEK_OFF,
  ATTENDANCE_STATUS.HOLIDAY,
];

/**
 * ── Leave (§HR) ─────────────────────────────────────────────────────────────
 */
export const LEAVE_TYPE = {
  CASUAL: 'casual',
  SICK: 'sick',
  EARNED: 'earned',
  UNPAID: 'unpaid',
  MATERNITY: 'maternity',
  PATERNITY: 'paternity',
  COMPENSATORY: 'compensatory',
} as const;

export type LeaveType = (typeof LEAVE_TYPE)[keyof typeof LEAVE_TYPE];

export const LEAVE_TYPE_LABELS: Readonly<Record<LeaveType, string>> = {
  [LEAVE_TYPE.CASUAL]: 'Casual leave',
  [LEAVE_TYPE.SICK]: 'Sick leave',
  [LEAVE_TYPE.EARNED]: 'Earned leave',
  [LEAVE_TYPE.UNPAID]: 'Unpaid leave',
  [LEAVE_TYPE.MATERNITY]: 'Maternity leave',
  [LEAVE_TYPE.PATERNITY]: 'Paternity leave',
  [LEAVE_TYPE.COMPENSATORY]: 'Compensatory off',
};

/** Leave that is not paid, so payroll deducts it. */
export const UNPAID_LEAVE_TYPES: readonly LeaveType[] = [LEAVE_TYPE.UNPAID];

export const LEAVE_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  /** Withdrawn by the employee before a decision was taken. */
  CANCELLED: 'cancelled',
} as const;

export type LeaveStatus = (typeof LEAVE_STATUS)[keyof typeof LEAVE_STATUS];

export const LEAVE_STATUS_META: Readonly<
  Record<LeaveStatus, { label: string; tone: 'green' | 'orange' | 'red' | 'slate' }>
> = {
  [LEAVE_STATUS.PENDING]: { label: 'Pending', tone: 'orange' },
  [LEAVE_STATUS.APPROVED]: { label: 'Approved', tone: 'green' },
  [LEAVE_STATUS.REJECTED]: { label: 'Rejected', tone: 'red' },
  [LEAVE_STATUS.CANCELLED]: { label: 'Cancelled', tone: 'slate' },
};

/**
 * ── Payroll (§HR) ───────────────────────────────────────────────────────────
 *
 * A payslip is generated from the salary on the employee *and* the attendance
 * for the month, then frozen. The figures are copied onto the payslip row
 * rather than recomputed on read, because a salary revision six months later
 * must not silently rewrite what somebody was actually paid in March.
 */
export const PAYSLIP_STATUS = {
  DRAFT: 'draft',
  ISSUED: 'issued',
  CANCELLED: 'cancelled',
} as const;

export type PayslipStatus = (typeof PAYSLIP_STATUS)[keyof typeof PAYSLIP_STATUS];

export const PAYSLIP_STATUS_META: Readonly<
  Record<PayslipStatus, { label: string; tone: 'green' | 'orange' | 'slate' }>
> = {
  [PAYSLIP_STATUS.DRAFT]: { label: 'Draft', tone: 'orange' },
  [PAYSLIP_STATUS.ISSUED]: { label: 'Issued', tone: 'green' },
  [PAYSLIP_STATUS.CANCELLED]: { label: 'Cancelled', tone: 'slate' },
};

export const MONTH_LABELS: readonly string[] = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "March 2026" — used on the payslip, its filename and the payroll list. */
export function payslipPeriodLabel(month: number, year: number): string {
  return `${MONTH_LABELS[month - 1] ?? String(month)} ${year}`;
}

/**
 * How long someone has been here, in the phrasing the profile card uses.
 *
 * Whole years and months, never a decimal: "1 year, 7 months" is what an HR
 * screen says, and "1.58 years" is what nobody says.
 */
export function tenureLabel(joinedOn: string | null, now = new Date()): string | null {
  if (!joinedOn) return null;

  const start = new Date(joinedOn);
  if (Number.isNaN(start.getTime()) || start.getTime() > now.getTime()) return null;

  let months =
    (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) months -= 1;

  const years = Math.floor(months / 12);
  const rest = months % 12;

  const parts: string[] = [];
  if (years > 0) parts.push(`${years} year${years === 1 ? '' : 's'}`);
  if (rest > 0) parts.push(`${rest} month${rest === 1 ? '' : 's'}`);

  return parts.length > 0 ? parts.join(', ') : 'Less than a month';
}
