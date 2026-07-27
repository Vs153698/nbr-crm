/**
 * Smaller domain enumerations. Anything an Admin can extend from Settings (§26)
 * is stored in a table and seeded from here; anything the code branches on is
 * a compiled union.
 */

/** Where the application came from (§5 Application Source). */
export const APPLICATION_SOURCE = {
  WEBSITE: 'website',
  WALK_IN: 'walk_in',
  PHONE: 'phone',
  EMAIL: 'email',
  WHATSAPP: 'whatsapp',
  REFERRAL: 'referral',
  SOCIAL_MEDIA: 'social_media',
  EVENT: 'event',
  /** Created by the inbound NBR-website webhook rather than typed by staff. */
  NBR_WEBSITE_SYNC: 'nbr_website_sync',
  OTHER: 'other',
} as const;

export type ApplicationSource = (typeof APPLICATION_SOURCE)[keyof typeof APPLICATION_SOURCE];

export const APPLICATION_SOURCE_LABELS: Readonly<Record<ApplicationSource, string>> = {
  [APPLICATION_SOURCE.WEBSITE]: 'Website',
  [APPLICATION_SOURCE.WALK_IN]: 'Walk-in',
  [APPLICATION_SOURCE.PHONE]: 'Phone',
  [APPLICATION_SOURCE.EMAIL]: 'Email',
  [APPLICATION_SOURCE.WHATSAPP]: 'WhatsApp',
  [APPLICATION_SOURCE.REFERRAL]: 'Referral',
  [APPLICATION_SOURCE.SOCIAL_MEDIA]: 'Social media',
  [APPLICATION_SOURCE.EVENT]: 'Event',
  [APPLICATION_SOURCE.NBR_WEBSITE_SYNC]: 'NBR website (auto-sync)',
  [APPLICATION_SOURCE.OTHER]: 'Other',
};

/** §6 Achievement — individual vs group attempt. */
export const RECORD_TYPE = {
  INDIVIDUAL: 'individual',
  GROUP: 'group',
} as const;

export type RecordType = (typeof RECORD_TYPE)[keyof typeof RECORD_TYPE];

/** §7 Evidence Vault file kinds. */
export const EVIDENCE_KIND = {
  PHOTO: 'photo',
  VIDEO: 'video',
  DOCUMENT: 'document',
  ID_PROOF: 'id_proof',
  CONSENT_FORM: 'consent_form',
  WITNESS_STATEMENT: 'witness_statement',
  MEASUREMENT_RECORD: 'measurement_record',
  OTHER: 'other',
} as const;

export type EvidenceKind = (typeof EVIDENCE_KIND)[keyof typeof EVIDENCE_KIND];

export const EVIDENCE_KIND_LABELS: Readonly<Record<EvidenceKind, string>> = {
  [EVIDENCE_KIND.PHOTO]: 'Photo',
  [EVIDENCE_KIND.VIDEO]: 'Video',
  [EVIDENCE_KIND.DOCUMENT]: 'Document',
  [EVIDENCE_KIND.ID_PROOF]: 'ID proof',
  [EVIDENCE_KIND.CONSENT_FORM]: 'Consent form',
  [EVIDENCE_KIND.WITNESS_STATEMENT]: 'Witness statement',
  [EVIDENCE_KIND.MEASUREMENT_RECORD]: 'Measurement record',
  [EVIDENCE_KIND.OTHER]: 'Other',
};

/** General attachment kinds (§16). */
export const ATTACHMENT_KIND = {
  OCR_COPY: 'ocr_copy',
  UPDATED_CERTIFICATE: 'updated_certificate',
  LEGAL_NOTICE: 'legal_notice',
  CORRECTION_LETTER: 'correction_letter',
  ADDITIONAL_PHOTO: 'additional_photo',
  INVOICE: 'invoice',
  RECEIPT: 'receipt',
  POD: 'proof_of_delivery',
  MISC: 'misc',
} as const;

export type AttachmentKind = (typeof ATTACHMENT_KIND)[keyof typeof ATTACHMENT_KIND];

/** §9 Payment Module. */
export const PAYMENT_STATUS = {
  NOT_RAISED: 'not_raised',
  PENDING: 'pending',
  PARTIAL: 'partial',
  PAID: 'paid',
  REFUNDED: 'refunded',
  WAIVED: 'waived',
} as const;

export type PaymentStatus = (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS];

export const PAYMENT_MODE = {
  UPI: 'upi',
  BANK_TRANSFER: 'bank_transfer',
  CASH: 'cash',
  CARD: 'card',
  CHEQUE: 'cheque',
  RAZORPAY: 'razorpay',
  OTHER: 'other',
} as const;

export type PaymentMode = (typeof PAYMENT_MODE)[keyof typeof PAYMENT_MODE];

export const PAYMENT_MODE_LABELS: Readonly<Record<PaymentMode, string>> = {
  [PAYMENT_MODE.UPI]: 'UPI',
  [PAYMENT_MODE.BANK_TRANSFER]: 'Bank transfer',
  [PAYMENT_MODE.CASH]: 'Cash',
  [PAYMENT_MODE.CARD]: 'Card',
  [PAYMENT_MODE.CHEQUE]: 'Cheque',
  [PAYMENT_MODE.RAZORPAY]: 'Razorpay',
  [PAYMENT_MODE.OTHER]: 'Other',
};

/** §12 Dispatch Module. */
export const DELIVERY_STATUS = {
  NOT_DISPATCHED: 'not_dispatched',
  PACKED: 'packed',
  DISPATCHED: 'dispatched',
  IN_TRANSIT: 'in_transit',
  OUT_FOR_DELIVERY: 'out_for_delivery',
  DELIVERED: 'delivered',
  RETURNED: 'returned',
  LOST: 'lost',
} as const;

export type DeliveryStatus = (typeof DELIVERY_STATUS)[keyof typeof DELIVERY_STATUS];

/** §11 Publications Module. */
export const PUBLICATION_KIND = {
  ARTICLE: 'article',
  MAGAZINE: 'magazine',
  ENEWS: 'enews',
  WEBSITE: 'website',
  SOCIAL_MEDIA: 'social_media',
  PRESS_COVERAGE: 'press_coverage',
} as const;

export type PublicationKind = (typeof PUBLICATION_KIND)[keyof typeof PUBLICATION_KIND];

/** §15 Task Management. */
export const TASK_STATUS = {
  PENDING: 'pending',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
} as const;

export type TaskStatus = (typeof TASK_STATUS)[keyof typeof TASK_STATUS];

export const TASK_PRIORITY = {
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
  URGENT: 'urgent',
} as const;

export type TaskPriority = (typeof TASK_PRIORITY)[keyof typeof TASK_PRIORITY];

/** §14 Internal Notes. */
export const NOTE_CATEGORY = {
  GENERAL: 'general',
  CALL_SUMMARY: 'call_summary',
  VERIFICATION_REMARK: 'verification_remark',
  PAYMENT_REMARK: 'payment_remark',
  COMPLAINT: 'complaint',
  ESCALATION: 'escalation',
} as const;

export type NoteCategory = (typeof NOTE_CATEGORY)[keyof typeof NOTE_CATEGORY];

/** §22 Communication History channels. */
export const COMMUNICATION_CHANNEL = {
  EMAIL: 'email',
  WHATSAPP: 'whatsapp',
  CALL: 'call',
  SMS: 'sms',
} as const;

export type CommunicationChannel =
  (typeof COMMUNICATION_CHANNEL)[keyof typeof COMMUNICATION_CHANNEL];

export const COMMUNICATION_STATUS = {
  QUEUED: 'queued',
  SENT: 'sent',
  DELIVERED: 'delivered',
  FAILED: 'failed',
  /** WhatsApp click-to-chat: staff confirmed they actually sent it. */
  MARKED_SENT: 'marked_sent',
} as const;

export type CommunicationStatus =
  (typeof COMMUNICATION_STATUS)[keyof typeof COMMUNICATION_STATUS];

export const USER_STATUS = {
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  DEACTIVATED: 'deactivated',
} as const;

export type UserStatus = (typeof USER_STATUS)[keyof typeof USER_STATUS];

export const GENDER = {
  MALE: 'male',
  FEMALE: 'female',
  OTHER: 'other',
  UNDISCLOSED: 'undisclosed',
} as const;

export type Gender = (typeof GENDER)[keyof typeof GENDER];

/** Seed categories (§6). Extendable from Settings. */
export const DEFAULT_CATEGORIES: readonly string[] = [
  'Physical Fitness',
  'Arts & Craft',
  'Academics & Education',
  'Music & Dance',
  'Sports & Adventure',
  'Social Service',
  'Business & Entrepreneurship',
  'Science & Innovation',
  'Culinary',
  'Literature & Writing',
  'Mass Participation',
  'Other',
];

/** Seed packages (§9). Amounts are the client's to confirm before go-live. */
export interface PackageSeed {
  readonly name: string;
  readonly amount: string;
  readonly gstPercent: string;
  readonly description: string;
}

export const DEFAULT_PACKAGES: readonly PackageSeed[] = [
  {
    name: 'Basic',
    amount: '2500.00',
    gstPercent: '18.00',
    description: 'Digital certificate + website listing.',
  },
  {
    name: 'Standard',
    amount: '5000.00',
    gstPercent: '18.00',
    description: 'Digital + printed certificate, dispatch included.',
  },
  {
    name: 'Premium',
    amount: '10000.00',
    gstPercent: '18.00',
    description: 'Printed certificate, medal, magazine feature and dispatch.',
  },
  {
    name: 'International',
    amount: '15000.00',
    gstPercent: '18.00',
    description: 'Premium inclusions with international dispatch.',
  },
];

/** Courier partners seeded for the Dispatch module dropdown. */
export const DEFAULT_COURIERS: readonly string[] = [
  'Delhivery',
  'Blue Dart',
  'DTDC',
  'India Post (Speed Post)',
  'Ekart',
  'Xpressbees',
  'FedEx',
  'DHL',
  'Other',
];
