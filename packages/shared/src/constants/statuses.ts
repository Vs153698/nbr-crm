/**
 * Record lifecycle statuses.
 *
 * Source of truth is the `statuses` table in Postgres (so Admins can rename
 * labels and reorder without a deploy), but the *codes* below are compiled in
 * because the workflow state machine, permission checks and UI colour mapping
 * all key off them. Adding a stage = add a code here + a seed row + transitions.
 *
 * Union of §6 (Phase 1 & 2 doc) and §5 (V1.0 reference doc) so future phases
 * need zero schema change.
 */
export const RECORD_STATUS = {
  NEW_LEAD: 'new_lead',
  APPLICATION_SUBMITTED: 'application_submitted',
  UNDER_REVIEW: 'under_review',
  VERIFICATION_PENDING: 'verification_pending',
  ON_HOLD: 'on_hold',
  SELECTED: 'selected',
  REJECTED: 'rejected',
  PAYMENT_PENDING: 'payment_pending',
  PAYMENT_RECEIVED: 'payment_received',
  CERTIFICATE_PENDING: 'certificate_pending',
  CERTIFICATE_UPLOADED: 'certificate_uploaded',
  PUBLICATION: 'publication',
  DISPATCH_PENDING: 'dispatch_pending',
  DISPATCHED: 'dispatched',
  DELIVERED: 'delivered',
  COMPLETED: 'completed',
  CLOSED: 'closed',
} as const;

export type RecordStatus = (typeof RECORD_STATUS)[keyof typeof RECORD_STATUS];

export const RECORD_STATUS_VALUES = Object.values(RECORD_STATUS) as RecordStatus[];

/**
 * Semantic colour families. Same colour = same meaning on every screen
 * (§C-03): blue → intake & logistics, orange → waiting on someone,
 * green → good, red → blocked, purple → comms, teal → certificate.
 */
export type StatusTone =
  | 'blue'
  | 'orange'
  | 'green'
  | 'red'
  | 'purple'
  | 'teal'
  | 'indigo'
  | 'slate';

export interface StatusMeta {
  readonly code: RecordStatus;
  readonly label: string;
  readonly tone: StatusTone;
  /** Display order in pickers, dashboards and the workflow strip. */
  readonly order: number;
  /** Which lifecycle stage group this status belongs to (drives status cards). */
  readonly stage: 'intake' | 'verification' | 'decision' | 'payment' | 'fulfilment' | 'closed';
  /** Terminal statuses lock the workflow — no further transitions except reopen. */
  readonly terminal: boolean;
  /** Statuses that count as "the applicant is waiting on us". */
  readonly slaWatched: boolean;
}

export const STATUS_META: Readonly<Record<RecordStatus, StatusMeta>> = {
  [RECORD_STATUS.NEW_LEAD]: {
    code: RECORD_STATUS.NEW_LEAD,
    label: 'New Lead',
    tone: 'blue',
    order: 10,
    stage: 'intake',
    terminal: false,
    slaWatched: true,
  },
  [RECORD_STATUS.APPLICATION_SUBMITTED]: {
    code: RECORD_STATUS.APPLICATION_SUBMITTED,
    label: 'Application Submitted',
    tone: 'blue',
    order: 20,
    stage: 'intake',
    terminal: false,
    slaWatched: true,
  },
  [RECORD_STATUS.UNDER_REVIEW]: {
    code: RECORD_STATUS.UNDER_REVIEW,
    label: 'Under Review',
    tone: 'orange',
    order: 30,
    stage: 'verification',
    terminal: false,
    slaWatched: true,
  },
  [RECORD_STATUS.VERIFICATION_PENDING]: {
    code: RECORD_STATUS.VERIFICATION_PENDING,
    label: 'Verification Pending',
    tone: 'orange',
    order: 40,
    stage: 'verification',
    terminal: false,
    slaWatched: true,
  },
  [RECORD_STATUS.ON_HOLD]: {
    code: RECORD_STATUS.ON_HOLD,
    label: 'On Hold',
    tone: 'slate',
    order: 50,
    stage: 'verification',
    terminal: false,
    slaWatched: false,
  },
  [RECORD_STATUS.SELECTED]: {
    code: RECORD_STATUS.SELECTED,
    label: 'Selected',
    tone: 'green',
    order: 60,
    stage: 'decision',
    terminal: false,
    slaWatched: true,
  },
  [RECORD_STATUS.REJECTED]: {
    code: RECORD_STATUS.REJECTED,
    label: 'Rejected',
    tone: 'red',
    order: 70,
    stage: 'decision',
    terminal: true,
    slaWatched: false,
  },
  [RECORD_STATUS.PAYMENT_PENDING]: {
    code: RECORD_STATUS.PAYMENT_PENDING,
    label: 'Payment Pending',
    tone: 'orange',
    order: 80,
    stage: 'payment',
    terminal: false,
    slaWatched: false,
  },
  [RECORD_STATUS.PAYMENT_RECEIVED]: {
    code: RECORD_STATUS.PAYMENT_RECEIVED,
    label: 'Payment Received',
    tone: 'green',
    order: 90,
    stage: 'payment',
    terminal: false,
    slaWatched: true,
  },
  [RECORD_STATUS.CERTIFICATE_PENDING]: {
    code: RECORD_STATUS.CERTIFICATE_PENDING,
    label: 'Certificate Pending',
    tone: 'orange',
    order: 100,
    stage: 'fulfilment',
    terminal: false,
    slaWatched: true,
  },
  [RECORD_STATUS.CERTIFICATE_UPLOADED]: {
    code: RECORD_STATUS.CERTIFICATE_UPLOADED,
    label: 'Certificate Uploaded',
    tone: 'teal',
    order: 110,
    stage: 'fulfilment',
    terminal: false,
    slaWatched: true,
  },
  [RECORD_STATUS.PUBLICATION]: {
    code: RECORD_STATUS.PUBLICATION,
    label: 'Publication',
    tone: 'purple',
    order: 120,
    stage: 'fulfilment',
    terminal: false,
    slaWatched: true,
  },
  [RECORD_STATUS.DISPATCH_PENDING]: {
    code: RECORD_STATUS.DISPATCH_PENDING,
    label: 'Dispatch Pending',
    tone: 'orange',
    order: 130,
    stage: 'fulfilment',
    terminal: false,
    slaWatched: true,
  },
  [RECORD_STATUS.DISPATCHED]: {
    code: RECORD_STATUS.DISPATCHED,
    label: 'Dispatched',
    tone: 'blue',
    order: 140,
    stage: 'fulfilment',
    terminal: false,
    slaWatched: false,
  },
  [RECORD_STATUS.DELIVERED]: {
    code: RECORD_STATUS.DELIVERED,
    label: 'Delivered',
    tone: 'green',
    order: 150,
    stage: 'fulfilment',
    terminal: false,
    slaWatched: false,
  },
  [RECORD_STATUS.COMPLETED]: {
    code: RECORD_STATUS.COMPLETED,
    label: 'Completed',
    tone: 'green',
    order: 160,
    stage: 'closed',
    terminal: true,
    slaWatched: false,
  },
  [RECORD_STATUS.CLOSED]: {
    code: RECORD_STATUS.CLOSED,
    label: 'Closed',
    tone: 'slate',
    order: 170,
    stage: 'closed',
    terminal: true,
    slaWatched: false,
  },
};

export const ORDERED_STATUSES: readonly StatusMeta[] = RECORD_STATUS_VALUES.map(
  (code) => STATUS_META[code],
).sort((a, b) => a.order - b.order);

export function isTerminalStatus(status: RecordStatus): boolean {
  return STATUS_META[status].terminal;
}
