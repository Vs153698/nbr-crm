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
