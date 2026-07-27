/**
 * Restriction flags (§20) — orthogonal to workflow status. Flags sit next to the
 * applicant's name on every screen and can block specific actions.
 */
export const FLAG = {
  BLACKLISTED: 'blacklisted',
  LEGAL_HOLD: 'legal_hold',
  PAYMENT_DISPUTE: 'payment_dispute',
  VERIFICATION_FAILED: 'verification_failed',
  VIP: 'vip',
  DUPLICATE: 'duplicate',
  DO_NOT_CONTACT: 'do_not_contact',
  INTERNATIONAL: 'international',
} as const;

export type FlagCode = (typeof FLAG)[keyof typeof FLAG];

export interface FlagMeta {
  readonly code: FlagCode;
  readonly label: string;
  readonly icon: string;
  readonly tone: 'red' | 'orange' | 'amber' | 'gold' | 'slate' | 'blue';
  /** Blocks new applications for this applicant unless an Admin overrides. */
  readonly blocksNewRecords: boolean;
  /** Hides every outbound email / WhatsApp / call action. */
  readonly blocksOutreach: boolean;
  /** Blocks erasure under DPDP §8(7) — data must be retained for a legal reason. */
  readonly blocksErasure: boolean;
}

export const FLAG_META: Readonly<Record<FlagCode, FlagMeta>> = {
  [FLAG.BLACKLISTED]: {
    code: FLAG.BLACKLISTED,
    label: 'Blacklisted',
    icon: 'Ban',
    tone: 'red',
    blocksNewRecords: true,
    blocksOutreach: false,
    blocksErasure: true,
  },
  [FLAG.LEGAL_HOLD]: {
    code: FLAG.LEGAL_HOLD,
    label: 'Legal Hold',
    icon: 'Scale',
    tone: 'red',
    blocksNewRecords: true,
    blocksOutreach: false,
    // A live legal proceeding is a lawful ground to retain data despite an
    // erasure request (DPDP §12(3) read with §8(7)(a)).
    blocksErasure: true,
  },
  [FLAG.PAYMENT_DISPUTE]: {
    code: FLAG.PAYMENT_DISPUTE,
    label: 'Payment Dispute',
    icon: 'CreditCard',
    tone: 'orange',
    blocksNewRecords: false,
    blocksOutreach: false,
    blocksErasure: true,
  },
  [FLAG.VERIFICATION_FAILED]: {
    code: FLAG.VERIFICATION_FAILED,
    label: 'Verification Failed',
    icon: 'ShieldX',
    tone: 'red',
    blocksNewRecords: false,
    blocksOutreach: false,
    blocksErasure: false,
  },
  [FLAG.VIP]: {
    code: FLAG.VIP,
    label: 'VIP',
    icon: 'Star',
    tone: 'gold',
    blocksNewRecords: false,
    blocksOutreach: false,
    blocksErasure: false,
  },
  [FLAG.DUPLICATE]: {
    code: FLAG.DUPLICATE,
    label: 'Duplicate',
    icon: 'Copy',
    tone: 'amber',
    blocksNewRecords: true,
    blocksOutreach: false,
    blocksErasure: false,
  },
  [FLAG.DO_NOT_CONTACT]: {
    code: FLAG.DO_NOT_CONTACT,
    label: 'Do Not Contact',
    icon: 'BellOff',
    tone: 'slate',
    blocksNewRecords: false,
    blocksOutreach: true,
    blocksErasure: false,
  },
  [FLAG.INTERNATIONAL]: {
    code: FLAG.INTERNATIONAL,
    label: 'International',
    icon: 'Globe',
    tone: 'blue',
    blocksNewRecords: false,
    blocksOutreach: false,
    blocksErasure: false,
  },
};

/** Blacklist reasons (§19). */
export const BLACKLIST_REASON = {
  FAKE_DOCUMENTS: 'fake_documents',
  FRAUD: 'fraud',
  DUPLICATE_RECORDS: 'duplicate_records',
  MISCONDUCT: 'misconduct',
  POLICY_VIOLATION: 'policy_violation',
  LEGAL_ISSUE: 'legal_issue',
  OTHER: 'other',
} as const;

export type BlacklistReason = (typeof BLACKLIST_REASON)[keyof typeof BLACKLIST_REASON];

export const BLACKLIST_REASON_LABELS: Readonly<Record<BlacklistReason, string>> = {
  [BLACKLIST_REASON.FAKE_DOCUMENTS]: 'Fake documents',
  [BLACKLIST_REASON.FRAUD]: 'Fraud',
  [BLACKLIST_REASON.DUPLICATE_RECORDS]: 'Duplicate records',
  [BLACKLIST_REASON.MISCONDUCT]: 'Misconduct',
  [BLACKLIST_REASON.POLICY_VIOLATION]: 'Policy violation',
  [BLACKLIST_REASON.LEGAL_ISSUE]: 'Legal issue',
  [BLACKLIST_REASON.OTHER]: 'Other',
};

export const BLACKLIST_KIND = {
  TEMPORARY: 'temporary',
  PERMANENT: 'permanent',
} as const;

export type BlacklistKind = (typeof BLACKLIST_KIND)[keyof typeof BLACKLIST_KIND];
