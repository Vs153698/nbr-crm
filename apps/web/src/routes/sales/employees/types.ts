export interface EmployeeRow {
  id: string;
  employeeCode: string;
  fullName: string;
  workEmail: string | null;
  mobile: string;
  department: string | null;
  designation: string | null;
  employmentType: string;
  status: string;
  joinedOn: string | null;
  workLocation: string | null;
  photoKey: string | null;
  userId: string | null;
  reportsToEmployeeId: string | null;
  probationEndsOn: string | null;
  /** Resolved by a self-join, so the table needs no per-row lookup. */
  reportsToName: string | null;
  reportsToDesignation: string | null;
}

export interface EmployeeDetail extends EmployeeRow {
  personalEmail: string | null;
  alternatePhone: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;
  emergencyContactAddress: string | null;
  monthlySalary: string | null;
  ctc: string | null;
  panNumber: string | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  exitedOn: string | null;
  notes: string | null;
  reports: Array<{ id: string; fullName: string; designation: string | null }>;
  documentCount: number;
}

export interface EmployeeDocument {
  id: string;
  kind: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  /** What the file weighed before the browser re-encoded it, when it did. */
  originalSizeBytes: number | null;
  description: string | null;
  isSensitive: boolean;
  uploadedByName: string | null;
  createdAt: string;
}

/** Headline counts for the directory's summary cards. */
export interface EmployeeStats {
  total: number;
  active: number;
  activePercent: number;
  onLeave: number;
  onLeavePercent: number;
  newJoiners: number;
  departments: number;
}

export interface AttendanceSummary {
  calendarDays: number;
  workingDays: number;
  payableDays: number;
  lopDays: number;
  present: number;
  workFromHome: number;
  halfDays: number;
  absent: number;
  onLeave: number;
  leaveWithoutPay: number;
  weekOff: number;
  holiday: number;
  unmarked: number;
}

export interface AttendanceDay {
  id: string;
  onDate: string;
  status: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  workedMinutes: number | null;
  remarks: string | null;
  markedByName: string | null;
}

export interface AttendanceMonth {
  month: number;
  year: number;
  days: AttendanceDay[];
  summary: AttendanceSummary;
}

export interface LeaveRequest {
  id: string;
  leaveType: string;
  fromDate: string;
  toDate: string;
  days: string;
  reason: string;
  status: string;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  appliedByName: string | null;
  createdAt: string;
}

export interface LeaveSummary {
  year: number;
  takenTotal: number;
  takenByType: Record<string, number>;
  pending: number;
}

export interface LeaveList {
  requests: LeaveRequest[];
  summary: LeaveSummary;
}

export interface Payslip {
  id: string;
  payslipNumber: string;
  periodMonth: number;
  periodYear: number;
  periodLabel: string;
  grossPay: string;
  totalDeductions: string;
  netPay: string;
  payableDays: string;
  workingDays: string;
  status: string;
  generatedByName: string | null;
  createdAt: string;
}

export interface EmployeeActivity {
  id: string;
  action: string;
  label: string | null;
  actorName: string;
  meta: Record<string, unknown> | null;
  at: string;
}

/** Everything the Overview tab needs, in one call. */
export interface EmployeeOverview {
  attendanceThisMonth: AttendanceSummary;
  leaveSummary: LeaveSummary;
  pendingLeave: LeaveRequest[];
  latestPayslip: Payslip | null;
  payslipCount: number;
  activity: EmployeeActivity[];
  onProbation: boolean;
}

export const employeeKeys = {
  list: (search: string, department: string, status: string, employmentType: string) =>
    ['employees', search, department, status, employmentType] as const,
  stats: () => ['employees', 'stats'] as const,
  detail: (employeeId: string) => ['employee', employeeId] as const,
  documents: (employeeId: string) => ['employee', employeeId, 'documents'] as const,
  overview: (employeeId: string) => ['employee', employeeId, 'overview'] as const,
  activity: (employeeId: string) => ['employee', employeeId, 'activity'] as const,
  attendance: (employeeId: string, month: number, year: number) =>
    ['employee', employeeId, 'attendance', month, year] as const,
  leave: (employeeId: string) => ['employee', employeeId, 'leave'] as const,
  payslips: (employeeId: string) => ['employee', employeeId, 'payslips'] as const,
};
