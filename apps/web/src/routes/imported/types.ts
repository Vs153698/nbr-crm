/**
 * The shape the API returns for offline certificates mirrored from the website.
 *
 * Deliberately its own module rather than a branch of the applicant types:
 * these records have no application, no payment and no pipeline status, and
 * sharing a type would invite screens to reach for fields that are never there.
 */
export interface ImportedRecord {
  id: string;
  certificateNumber: string;
  holderName: string;
  recordTitle: string;
  category: string | null;
  issuedAt: string;
  email: string | null;
  phone: string | null;
  location: string | null;
  bio: string | null;
  achievementDate: string | null;
  coverImageUrl: string | null;
  extraData: Record<string, unknown>;
  awardeeSlug: string | null;
  verifyUrl: string | null;
  awardeeUrl: string | null;
  isPublished: boolean;
  revoked: boolean;
  revokeReason: string | null;
  syncedAt: string;
  createdAt: string;
  updatedAt: string;
}

/** The four actions permitted on an imported record, and nothing else. */
export type ActivityKind = 'email' | 'whatsapp' | 'note' | 'task';

export interface ImportedActivity {
  id: string;
  importedRecordId: string;
  kind: ActivityKind;
  subject: string | null;
  body: string;
  dueAt: string | null;
  completedAt: string | null;
  /** `sent` | `failed` for email, `logged` for WhatsApp, null for notes and tasks. */
  status: string | null;
  error: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ImportedRecordDetail extends ImportedRecord {
  activity: ImportedActivity[];
}

export interface ImportedRecordList {
  rows: ImportedRecord[];
  total: number;
  limit: number;
  offset: number;
}

export interface ImportedSyncResult {
  imported: number;
  updated: number;
  total: number;
}

export interface ActivityResult {
  id: string;
  status: string | null;
  /** Present for WhatsApp only — the click-to-chat link the operator sends from. */
  whatsappUrl?: string;
}
