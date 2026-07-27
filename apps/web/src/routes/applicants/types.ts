/** Shapes returned by the applicant-facing endpoints. */

export interface Lookups {
  categories: Array<{ id: string; name: string }>;
  packages: Array<{ id: string; name: string; amount: string; gstPercent: string }>;
  couriers: Array<{ id: string; name: string; trackingUrlTemplate: string | null }>;
  staff: Array<{ id: string; fullName: string; roleName: string }>;
}

export interface MaskedIdentifiers {
  aadhaar: string | null;
  passport: string | null;
  pan: string | null;
  hasAadhaar: boolean;
  hasPassport: boolean;
  hasPan: boolean;
}

export interface ApplicantRecord {
  id: string;
  recordCode: string;
  status: string;
  source: string;
  applicationDate: string;
  assignedToUserId: string | null;
  paymentStatus: string;
  deliveryStatus: string;
  hasCertificate: boolean;
  hasPublication: boolean;
  evidenceCount: number;
  lockedAt: string | null;
  updatedAt: string;
  recordTitle: string | null;
  categoryId: string | null;
  recordType: string | null;
  achievementDate: string | null;
  location: string | null;
  participantCount: number | null;
}

export interface ApplicantProfile {
  applicant: {
    id: string;
    applicantCode: string;
    fullName: string;
    fatherName: string | null;
    motherName: string | null;
    dateOfBirth: string | null;
    gender: string | null;
    mobile: string;
    whatsapp: string | null;
    email: string;
    addressLine: string | null;
    city: string | null;
    state: string | null;
    country: string;
    pincode: string | null;
    nationality: string | null;
    photoKey: string | null;
    recordCount: number;
    isBlacklisted: boolean;
    isMinorAtIntake: boolean;
    erasedAt: string | null;
    createdAt: string;
    updatedAt: string;
    identifiers: MaskedIdentifiers;
  };
  records: ApplicantRecord[];
  flags: Array<{ id: string; flag: string; reason: string | null; expiresAt: string | null }>;
  blacklists: Array<{
    id: string;
    kind: string;
    reason: string;
    reasonDetail: string;
    remarks: string | null;
    effectiveFrom: string;
    effectiveUntil: string | null;
  }>;
}

export interface StageAction {
  id: string;
  label: string;
  icon: string;
  kind: string;
  target: string;
  variant?: string;
}

export interface AvailableTransition {
  to: string;
  label: string;
  requiresRemark: boolean;
  requiresOverride: boolean;
  available: boolean;
  blockedReason?: string;
}

export interface SmartActionPanel {
  status: string;
  statusLabel: string;
  locked: boolean;
  actions: StageAction[];
  transitions: AvailableTransition[];
  paymentContext?: {
    dueDate: string | null;
    daysRemaining: number | null;
    balanceDue: string;
    reminderCount: number;
    overdue: boolean;
  };
}

export interface TimelineEntry {
  id: string;
  eventType: string;
  summary: string;
  meta: Record<string, unknown> | null;
  actorName: string | null;
  actorKind: string;
  occurredAt: string;
}

export interface EvidenceItem {
  id: string;
  kind: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  description: string | null;
  isSensitive: boolean;
  scanStatus: string;
  uploadedByName: string | null;
  createdAt: string;
}

export interface NoteItem {
  id: string;
  body: string;
  category: string;
  priority: string;
  followUpDate: string | null;
  revisionCount: number;
  lastEditedAt: string | null;
  createdByName: string | null;
  createdAt: string;
  canEdit: boolean;
}

export interface AttachmentItem {
  id: string;
  kind: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  description: string | null;
  recordId: string | null;
  uploadedByName: string | null;
  createdAt: string;
}
