/**
 * Outbound sales (§ leads).
 *
 * A lead is someone the sales team is calling who has *not* applied — usually a
 * record-holder-to-be being told they can have their achievement certified.
 * They are deliberately not applicants: the applicant list, duplicate engine and
 * DPDP consent ledger all assume a person who applied, and filling them with
 * cold prospects would both distort every report and record consent that was
 * never given.
 *
 * A lead becomes an applicant exactly once, at conversion.
 */

export const LEAD_STATUS = {
  NEW: 'new',
  CONTACTED: 'contacted',
  INTERESTED: 'interested',
  /** Asked to be called back; the follow-up date is the commitment. */
  CALLBACK: 'callback',
  NOT_INTERESTED: 'not_interested',
  /** Wrong number, unreachable after repeated attempts, duplicate. */
  UNQUALIFIED: 'unqualified',
  /** Became an applicant. Terminal — the record lives on the profile now. */
  CONVERTED: 'converted',
  LOST: 'lost',
} as const;

export type LeadStatus = (typeof LEAD_STATUS)[keyof typeof LEAD_STATUS];

export interface LeadStatusMeta {
  readonly code: LeadStatus;
  readonly label: string;
  readonly tone: 'blue' | 'orange' | 'green' | 'red' | 'purple' | 'teal' | 'slate';
  /** No further calling expected. */
  readonly isClosed: boolean;
}

export const LEAD_STATUS_META: Readonly<Record<LeadStatus, LeadStatusMeta>> = {
  [LEAD_STATUS.NEW]: { code: LEAD_STATUS.NEW, label: 'New', tone: 'slate', isClosed: false },
  [LEAD_STATUS.CONTACTED]: {
    code: LEAD_STATUS.CONTACTED,
    label: 'Contacted',
    tone: 'blue',
    isClosed: false,
  },
  [LEAD_STATUS.INTERESTED]: {
    code: LEAD_STATUS.INTERESTED,
    label: 'Interested',
    tone: 'teal',
    isClosed: false,
  },
  [LEAD_STATUS.CALLBACK]: {
    code: LEAD_STATUS.CALLBACK,
    label: 'Callback due',
    tone: 'orange',
    isClosed: false,
  },
  [LEAD_STATUS.NOT_INTERESTED]: {
    code: LEAD_STATUS.NOT_INTERESTED,
    label: 'Not interested',
    tone: 'red',
    isClosed: true,
  },
  [LEAD_STATUS.UNQUALIFIED]: {
    code: LEAD_STATUS.UNQUALIFIED,
    label: 'Unqualified',
    tone: 'slate',
    isClosed: true,
  },
  [LEAD_STATUS.CONVERTED]: {
    code: LEAD_STATUS.CONVERTED,
    label: 'Converted',
    tone: 'green',
    isClosed: true,
  },
  [LEAD_STATUS.LOST]: { code: LEAD_STATUS.LOST, label: 'Lost', tone: 'red', isClosed: true },
};

export const LEAD_STATUS_VALUES = Object.values(LEAD_STATUS) as LeadStatus[];

export const ORDERED_LEAD_STATUSES: readonly LeadStatusMeta[] = LEAD_STATUS_VALUES.map(
  (code) => LEAD_STATUS_META[code],
);

/** How the lead reached us. Drives the source-effectiveness cut of the report. */
export const LEAD_SOURCE = {
  IMPORT: 'import',
  WEBSITE: 'website',
  REFERRAL: 'referral',
  SOCIAL_MEDIA: 'social_media',
  EVENT: 'event',
  COLD_CALL: 'cold_call',
  WALK_IN: 'walk_in',
  PARTNER: 'partner',
  OTHER: 'other',
} as const;

export type LeadSource = (typeof LEAD_SOURCE)[keyof typeof LEAD_SOURCE];

export const LEAD_SOURCE_LABELS: Readonly<Record<LeadSource, string>> = {
  [LEAD_SOURCE.IMPORT]: 'Imported list',
  [LEAD_SOURCE.WEBSITE]: 'Website',
  [LEAD_SOURCE.REFERRAL]: 'Referral',
  [LEAD_SOURCE.SOCIAL_MEDIA]: 'Social media',
  [LEAD_SOURCE.EVENT]: 'Event',
  [LEAD_SOURCE.COLD_CALL]: 'Cold call',
  [LEAD_SOURCE.WALK_IN]: 'Walk-in',
  [LEAD_SOURCE.PARTNER]: 'Partner',
  [LEAD_SOURCE.OTHER]: 'Other',
};

/**
 * What happened on the call.
 *
 * Deliberately separate from lead status: "no answer" is an outcome that leaves
 * the lead exactly where it was, and collapsing the two would lose the
 * difference between a lead nobody has reached and one that was reached and
 * said no — which is the difference between a dialling problem and a pitch
 * problem.
 */
export const CALL_OUTCOME = {
  CONNECTED: 'connected',
  NO_ANSWER: 'no_answer',
  BUSY: 'busy',
  WRONG_NUMBER: 'wrong_number',
  SWITCHED_OFF: 'switched_off',
  CALLBACK_REQUESTED: 'callback_requested',
  NOT_INTERESTED: 'not_interested',
  INTERESTED: 'interested',
} as const;

export type CallOutcome = (typeof CALL_OUTCOME)[keyof typeof CALL_OUTCOME];

export const CALL_OUTCOME_LABELS: Readonly<Record<CallOutcome, string>> = {
  [CALL_OUTCOME.CONNECTED]: 'Connected',
  [CALL_OUTCOME.NO_ANSWER]: 'No answer',
  [CALL_OUTCOME.BUSY]: 'Busy',
  [CALL_OUTCOME.WRONG_NUMBER]: 'Wrong number',
  [CALL_OUTCOME.SWITCHED_OFF]: 'Switched off',
  [CALL_OUTCOME.CALLBACK_REQUESTED]: 'Callback requested',
  [CALL_OUTCOME.NOT_INTERESTED]: 'Not interested',
  [CALL_OUTCOME.INTERESTED]: 'Interested',
};

/** Outcomes that mean a human actually spoke to the lead. */
export const CONNECTED_OUTCOMES: readonly CallOutcome[] = [
  CALL_OUTCOME.CONNECTED,
  CALL_OUTCOME.CALLBACK_REQUESTED,
  CALL_OUTCOME.NOT_INTERESTED,
  CALL_OUTCOME.INTERESTED,
];

export function isConnectedOutcome(outcome: string): boolean {
  return (CONNECTED_OUTCOMES as readonly string[]).includes(outcome);
}

/** Settings keys for the end-of-day sales report. */
export const SALES_REPORT_SETTING_KEYS = {
  enabled: 'sales.daily_report_enabled',
  /** 24-hour local time, "HH:MM". */
  sendAt: 'sales.daily_report_time',
  /** Comma-separated addresses. */
  recipients: 'sales.daily_report_recipients',
} as const;
