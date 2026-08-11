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
  /** Pipeline stage 1 — every newly submitted application lands here. */
  [RECORD_STATUS.APPLICATION_SUBMITTED]: {
    code: RECORD_STATUS.APPLICATION_SUBMITTED,
    label: 'New Application',
    tone: 'blue',
    order: 20,
    stage: 'intake',
    terminal: false,
    slaWatched: true,
  },
  /** Pipeline stage 2 — documents and evidence are checked here. */
  [RECORD_STATUS.UNDER_REVIEW]: {
    code: RECORD_STATUS.UNDER_REVIEW,
    label: 'Verification',
    tone: 'orange',
    order: 30,
    stage: 'verification',
    terminal: false,
    slaWatched: true,
  },
  /**
   * Pipeline stage 3 — verified, waiting on the approve/reject decision.
   *
   * The code still reads `verification_pending` because it is written on every
   * record ever created and changing it would mean rewriting history for a
   * word. What it *means* has been made precise: it used to be "we have asked
   * the applicant for more evidence", which is not a stage at all — that is
   * still Verification, with a task against it — and it now marks the queue an
   * approver works from. The website's own `validated` stage has always meant
   * exactly this and has always mapped here, so the two systems agree.
   */
  [RECORD_STATUS.VERIFICATION_PENDING]: {
    code: RECORD_STATUS.VERIFICATION_PENDING,
    label: 'Approval Pending',
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
  /**
   * Pipeline stage 4 — approved, and the selection letter has gone out.
   *
   * The decision and the letter are one stage rather than two because they are
   * one act: approving an applicant nobody tells is not a state worth having,
   * and a record that reached here with no letter sent is a mistake the stage
   * should surface rather than accommodate. Whether the letter actually landed
   * is answered by the communication history, which the Selection Sent panel
   * reads and shows on the record.
   */
  [RECORD_STATUS.SELECTED]: {
    code: RECORD_STATUS.SELECTED,
    label: 'Selection Sent',
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
  /** Pipeline stage 5 — the fee has settled in full. */
  [RECORD_STATUS.PAYMENT_RECEIVED]: {
    code: RECORD_STATUS.PAYMENT_RECEIVED,
    label: 'Fees Received',
    tone: 'green',
    order: 90,
    stage: 'payment',
    terminal: false,
    slaWatched: true,
  },
  // Named for what the stage *is*: an employee checking and preparing the
  // certificate. "Pending" read as a queue nobody owned, which is how records
  // came to sit here while the website quietly issued something of its own.
  [RECORD_STATUS.CERTIFICATE_PENDING]: {
    code: RECORD_STATUS.CERTIFICATE_PENDING,
    label: 'Certificate Verification',
    tone: 'orange',
    order: 100,
    stage: 'fulfilment',
    terminal: false,
    slaWatched: true,
  },
  // "Uploaded" described a file arriving, which is not the milestone — a file
  // can be uploaded and still be wrong. This status means an employee has
  // checked it and signed it off, and the record moves straight to Dispatch.
  [RECORD_STATUS.CERTIFICATE_UPLOADED]: {
    code: RECORD_STATUS.CERTIFICATE_UPLOADED,
    label: 'Certificate Completed',
    tone: 'teal',
    order: 110,
    stage: 'fulfilment',
    terminal: false,
    slaWatched: true,
  },
  /** Pipeline stage 7 — the parcel. Three steps: pending, sent, delivered. */
  [RECORD_STATUS.DISPATCH_PENDING]: {
    code: RECORD_STATUS.DISPATCH_PENDING,
    label: 'Dispatch Pending',
    tone: 'orange',
    order: 120,
    stage: 'fulfilment',
    terminal: false,
    slaWatched: true,
  },
  [RECORD_STATUS.DISPATCHED]: {
    code: RECORD_STATUS.DISPATCHED,
    label: 'Dispatched',
    tone: 'blue',
    order: 130,
    stage: 'fulfilment',
    terminal: false,
    slaWatched: false,
  },
  [RECORD_STATUS.DELIVERED]: {
    code: RECORD_STATUS.DELIVERED,
    label: 'Delivered',
    tone: 'green',
    order: 140,
    stage: 'fulfilment',
    terminal: false,
    slaWatched: false,
  },
  /**
   * Pipeline stage 8 — the last working stage, and deliberately optional.
   *
   * It used to sit *before* dispatch, which had the magazine and the website
   * entry produced while the certificate was still in the office and the
   * applicant had nothing in their hands. It now follows delivery, which is
   * both the order asked for and the order that makes sense: the record is
   * published once it has actually been awarded.
   *
   * Optional because most records are never published. A mandatory Publication
   * stage would leave every unpublished record parked in a queue nobody will
   * ever action, which is how a queue stops being read at all — so Delivered
   * also leads straight to Completed.
   */
  [RECORD_STATUS.PUBLICATION]: {
    code: RECORD_STATUS.PUBLICATION,
    label: 'Publication',
    tone: 'purple',
    order: 150,
    stage: 'fulfilment',
    terminal: false,
    slaWatched: true,
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

/**
 * The order records are listed on an applicant's profile.
 *
 * Deliberately not `STATUS_META.order`, which is pipeline order — first stage
 * to last. A profile is read to answer "what needs doing about this person?",
 * and that is a different question: the record waiting on a payment is the one
 * to act on, so it leads, and a rejected record is the one nobody will act on
 * again, so it sinks to the bottom no matter how recent it is.
 *
 * The sequence is the client's: payment pending → approved → new or under
 * review → certificate → dispatch → publication → rejected. Statuses they did
 * not name sit with the group whose work they belong to — Fees Received leads
 * the certificate group because certificate verification is what happens next.
 */
const APPLICANT_RECORD_RANK: Readonly<Record<RecordStatus, number>> = {
  // 1 — waiting on money. The only group where an operator can act today.
  [RECORD_STATUS.PAYMENT_PENDING]: 10,

  // 2 — approved, told, and not yet paid.
  [RECORD_STATUS.SELECTED]: 20,

  // 3 — still being decided.
  [RECORD_STATUS.APPLICATION_SUBMITTED]: 30,
  [RECORD_STATUS.UNDER_REVIEW]: 31,
  [RECORD_STATUS.VERIFICATION_PENDING]: 32,
  [RECORD_STATUS.NEW_LEAD]: 33,
  [RECORD_STATUS.ON_HOLD]: 34,

  // 4 — paid, and now in the certificate stage.
  [RECORD_STATUS.PAYMENT_RECEIVED]: 40,
  [RECORD_STATUS.CERTIFICATE_PENDING]: 41,
  [RECORD_STATUS.CERTIFICATE_UPLOADED]: 42,

  // 5 — on its way.
  [RECORD_STATUS.DISPATCH_PENDING]: 50,
  [RECORD_STATUS.DISPATCHED]: 51,
  [RECORD_STATUS.DELIVERED]: 52,

  // 6 — published, then finished with.
  [RECORD_STATUS.PUBLICATION]: 60,
  [RECORD_STATUS.COMPLETED]: 61,
  [RECORD_STATUS.CLOSED]: 62,

  // 7 — last, always.
  [RECORD_STATUS.REJECTED]: 90,
};

/**
 * Where a record sits in the profile listing. Unknown statuses sort just above
 * rejected rather than first, so a status this build has never heard of cannot
 * push a payment-pending record down the list.
 */
export function applicantRecordRank(status: string): number {
  return APPLICANT_RECORD_RANK[status as RecordStatus] ?? 80;
}
