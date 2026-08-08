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
  userId: string | null;
  reportsToEmployeeId: string | null;
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
  exitedOn: string | null;
  notes: string | null;
  reportsToName: string | null;
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

export const employeeKeys = {
  list: (search: string, department: string, status: string) =>
    ['employees', search, department, status] as const,
  detail: (employeeId: string) => ['employee', employeeId] as const,
  documents: (employeeId: string) => ['employee', employeeId, 'documents'] as const,
};
