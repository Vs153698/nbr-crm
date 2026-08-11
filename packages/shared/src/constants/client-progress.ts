/**
 * ── The client-facing progress badge ─────────────────────────────────────────
 *
 * Eleven milestones NBR reports on, in the client's own words. This is a
 * *reporting* view and nothing else: it does not drive the workflow, it is not
 * the stepper on the record, and no transition anywhere reads it. The internal
 * pipeline (see `statuses.ts` and `workflow.ts`) stays exactly as it is.
 *
 * The rule that shapes every line below is the client's own: **a stage is
 * reached only when something actually happened.** So each one names the
 * evidence that proves it — a settled payment, a sent email in the
 * communication log, a delivery date on the courier row — rather than being
 * inferred from where the record happens to sit. Two consequences worth
 * stating, because both are deliberate:
 *
 *  • A stage that requires an employee to do something stays incomplete until
 *    they do it. The certificate is the clearest case: a file existing is not
 *    the milestone, an employee's sign-off is.
 *  • Progress is *not* assumed to be contiguous. A record can have its fee
 *    received with no reminder ever sent, because it was paid before anyone
 *    chased it. Reporting the reminder as done would be a lie told to make the
 *    bar look tidy, so the badge reports the furthest milestone genuinely
 *    reached and marks the skipped one as never happening.
 */

export const CLIENT_PROGRESS_STAGE = {
  SUBMITTED: 'submitted',
  UNDER_REVIEW: 'under_review',
  EVALUATION_COMPLETED: 'evaluation_completed',
  APPROVED: 'approved',
  REMINDER_MAIL_SENT: 'reminder_mail_sent',
  FEES_RECEIVED: 'fees_received',
  CERTIFICATE_VERIFICATION: 'certificate_verification',
  KIT_DISPATCHED: 'kit_dispatched',
  KIT_DELIVERED: 'kit_delivered',
  PHOTO_RECEIVED: 'photo_received',
  PHOTO_UPLOADED: 'photo_uploaded',
} as const;

export type ClientProgressStage =
  (typeof CLIENT_PROGRESS_STAGE)[keyof typeof CLIENT_PROGRESS_STAGE];

export interface ClientProgressStageMeta {
  readonly code: ClientProgressStage;
  readonly label: string;
  /** 1-based position, so the badge can say "6 of 11". */
  readonly step: number;
  /**
   * What has to have happened for this to count as reached — shown to the
   * operator so a stage that is *not* ticked explains itself rather than
   * looking like a bug.
   */
  readonly evidence: string;
  /** True when only an employee can complete it; never satisfied passively. */
  readonly needsEmployeeAction: boolean;
}

export const CLIENT_PROGRESS_STAGES: readonly ClientProgressStageMeta[] = [
  {
    code: CLIENT_PROGRESS_STAGE.SUBMITTED,
    label: 'Submitted',
    step: 1,
    evidence: 'The application was filed.',
    needsEmployeeAction: false,
  },
  {
    code: CLIENT_PROGRESS_STAGE.UNDER_REVIEW,
    label: 'Under Review',
    step: 2,
    evidence: 'An employee started verifying the documents.',
    needsEmployeeAction: true,
  },
  {
    code: CLIENT_PROGRESS_STAGE.EVALUATION_COMPLETED,
    label: 'Evaluation Completed',
    step: 3,
    evidence: 'Verification finished and the record was sent for approval.',
    needsEmployeeAction: true,
  },
  {
    code: CLIENT_PROGRESS_STAGE.APPROVED,
    label: 'Approved',
    step: 4,
    evidence: 'An approver selected the record.',
    needsEmployeeAction: true,
  },
  {
    code: CLIENT_PROGRESS_STAGE.REMINDER_MAIL_SENT,
    label: 'Reminder Mail Sent',
    step: 5,
    evidence: 'A payment reminder was actually sent and appears in the communication log.',
    needsEmployeeAction: true,
  },
  {
    code: CLIENT_PROGRESS_STAGE.FEES_RECEIVED,
    label: 'Fees Received',
    step: 6,
    evidence: 'The invoice is settled in full.',
    needsEmployeeAction: false,
  },
  {
    code: CLIENT_PROGRESS_STAGE.CERTIFICATE_VERIFICATION,
    label: 'Certificate Verification',
    step: 7,
    evidence: 'An employee uploaded the certificate and marked it verified.',
    needsEmployeeAction: true,
  },
  {
    code: CLIENT_PROGRESS_STAGE.KIT_DISPATCHED,
    label: 'Kit Dispatched',
    step: 8,
    evidence: 'The courier row carries a dispatch date.',
    needsEmployeeAction: true,
  },
  {
    code: CLIENT_PROGRESS_STAGE.KIT_DELIVERED,
    label: 'Kit Delivered',
    step: 9,
    evidence: 'The courier row carries a delivery date.',
    needsEmployeeAction: true,
  },
  {
    code: CLIENT_PROGRESS_STAGE.PHOTO_RECEIVED,
    label: 'Photo Received',
    step: 10,
    evidence: "A photo was added to the record's evidence after the kit was delivered.",
    needsEmployeeAction: true,
  },
  {
    code: CLIENT_PROGRESS_STAGE.PHOTO_UPLOADED,
    label: 'Photo Uploaded',
    step: 11,
    evidence: 'A publication entry exists — the photo has been published.',
    needsEmployeeAction: true,
  },
];

/** The facts the badge is derived from. Every field is a real, dated event. */
export interface ClientProgressFacts {
  /** ISO timestamps, or null when the thing simply has not happened. */
  readonly submittedAt: string | null;
  readonly reviewStartedAt: string | null;
  readonly evaluationCompletedAt: string | null;
  readonly approvedAt: string | null;
  readonly reminderSentAt: string | null;
  readonly feesReceivedAt: string | null;
  readonly certificateVerifiedAt: string | null;
  readonly dispatchedAt: string | null;
  readonly deliveredAt: string | null;
  readonly photoReceivedAt: string | null;
  readonly photoUploadedAt: string | null;
}

export interface ClientProgressStageState extends ClientProgressStageMeta {
  readonly reached: boolean;
  readonly at: string | null;
  /**
   * Reached, but a later stage was reached without it.
   *
   * The honest name for a payment settled before anyone sent a reminder. The
   * badge shows it as skipped rather than quietly ticking it, which is exactly
   * the "do not falsely mark stages as completed" the client asked for.
   */
  readonly skipped: boolean;
}

export interface ClientProgress {
  readonly stages: readonly ClientProgressStageState[];
  /** The furthest stage genuinely reached, or null before anything happened. */
  readonly current: ClientProgressStageState | null;
  /** How many of the eleven are genuinely done. Never inferred from position. */
  readonly completed: number;
  readonly total: number;
}

/**
 * Turn the facts into the badge.
 *
 * Deliberately a pure function over dates with no access to the record's
 * status. Reading the status would reintroduce exactly the failure the client
 * is describing — a stage looking complete because of where the record sits
 * rather than because the work was done.
 */
export function deriveClientProgress(facts: ClientProgressFacts): ClientProgress {
  const at: Readonly<Record<ClientProgressStage, string | null>> = {
    [CLIENT_PROGRESS_STAGE.SUBMITTED]: facts.submittedAt,
    [CLIENT_PROGRESS_STAGE.UNDER_REVIEW]: facts.reviewStartedAt,
    [CLIENT_PROGRESS_STAGE.EVALUATION_COMPLETED]: facts.evaluationCompletedAt,
    [CLIENT_PROGRESS_STAGE.APPROVED]: facts.approvedAt,
    [CLIENT_PROGRESS_STAGE.REMINDER_MAIL_SENT]: facts.reminderSentAt,
    [CLIENT_PROGRESS_STAGE.FEES_RECEIVED]: facts.feesReceivedAt,
    [CLIENT_PROGRESS_STAGE.CERTIFICATE_VERIFICATION]: facts.certificateVerifiedAt,
    [CLIENT_PROGRESS_STAGE.KIT_DISPATCHED]: facts.dispatchedAt,
    [CLIENT_PROGRESS_STAGE.KIT_DELIVERED]: facts.deliveredAt,
    [CLIENT_PROGRESS_STAGE.PHOTO_RECEIVED]: facts.photoReceivedAt,
    [CLIENT_PROGRESS_STAGE.PHOTO_UPLOADED]: facts.photoUploadedAt,
  };

  // The furthest thing that actually happened, which is not necessarily the
  // last one in a contiguous run.
  let furthest = -1;
  CLIENT_PROGRESS_STAGES.forEach((stage, index) => {
    if (at[stage.code]) furthest = index;
  });

  const stages = CLIENT_PROGRESS_STAGES.map((stage, index) => {
    const reached = Boolean(at[stage.code]);
    return {
      ...stage,
      reached,
      at: at[stage.code],
      // Passed over: the process moved beyond it without it ever happening.
      skipped: !reached && index < furthest,
    };
  });

  return {
    stages,
    current: furthest >= 0 ? stages[furthest]! : null,
    completed: stages.filter((stage) => stage.reached).length,
    total: CLIENT_PROGRESS_STAGES.length,
  };
}
