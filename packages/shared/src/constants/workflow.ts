import { ACTIONS, MODULES, permission, type PermissionCode } from './permissions';
import { RECORD_STATUS, type RecordStatus } from './statuses';

const p = permission;

/**
 * ── Status state machine (§6) ────────────────────────────────────────────────
 *
 * Declares every legal transition. Anything not listed here is rejected by the
 * API with 422 — the UI's dropdown is a convenience, not the guard. Each edge
 * can additionally demand a permission and/or a precondition that the service
 * layer evaluates against live record data (e.g. "balance must be zero").
 */
export type TransitionGuard =
  /** Record must have at least one evidence file. */
  | 'has_evidence'
  /** A payment plan (package + amount) must exist. */
  | 'has_payment_plan'
  /** Outstanding balance must be zero. */
  | 'payment_settled'
  /** At least one certificate version must be uploaded. */
  | 'has_certificate'
  /**
   * An employee must have uploaded a certificate *and* signed it off.
   *
   * Deliberately distinct from `has_certificate`. A file existing is not the
   * milestone — it can be the wrong name, the wrong year, or a draft the
   * designer sent for comment. The certificate stage completes when a person
   * says it is right, and this guard is what makes that a rule rather than a
   * convention.
   */
  | 'certificate_verified'
  /** A dispatch row with a tracking number must exist. */
  | 'has_dispatch'
  /** Applicant must not be under an active blacklist (Admin may override). */
  | 'not_blacklisted';

export interface StatusTransition {
  readonly to: RecordStatus;
  /** Label shown in the Change Status modal. */
  readonly label: string;
  readonly permission: PermissionCode;
  readonly guards?: readonly TransitionGuard[];
  /** Requires a free-text remark that lands on the timeline. */
  readonly requiresRemark?: boolean;
  /** Reserved for Admin/Super Admin override paths (reopen a locked record). */
  readonly requiresOverride?: boolean;
}

const CHANGE_STATUS = p(MODULES.RECORDS, ACTIONS.CHANGE_STATUS);
const VERIFY = p(MODULES.VERIFICATION, ACTIONS.CHANGE_STATUS);
const OVERRIDE = p(MODULES.RECORDS, ACTIONS.OVERRIDE);

export const STATUS_TRANSITIONS: Readonly<Record<RecordStatus, readonly StatusTransition[]>> = {
  [RECORD_STATUS.NEW_LEAD]: [
    {
      to: RECORD_STATUS.APPLICATION_SUBMITTED,
      label: 'Application received',
      permission: CHANGE_STATUS,
      guards: ['not_blacklisted'],
    },
    { to: RECORD_STATUS.ON_HOLD, label: 'Put on hold', permission: CHANGE_STATUS, requiresRemark: true },
    { to: RECORD_STATUS.CLOSED, label: 'Close lead', permission: CHANGE_STATUS, requiresRemark: true },
  ],

  [RECORD_STATUS.APPLICATION_SUBMITTED]: [
    { to: RECORD_STATUS.UNDER_REVIEW, label: 'Start review', permission: CHANGE_STATUS },
    { to: RECORD_STATUS.ON_HOLD, label: 'Put on hold', permission: CHANGE_STATUS, requiresRemark: true },
    { to: RECORD_STATUS.CLOSED, label: 'Close application', permission: CHANGE_STATUS, requiresRemark: true },
  ],

  /**
   * §Pipeline 2 — Verification.
   *
   * Finishing verification hands the record to an approver; it does not decide
   * anything. Approving straight from here was the shortcut that made Approval
   * Pending an empty queue — the same person verified and approved in one
   * click, and nobody could see what was waiting on a decision.
   *
   * Asking the applicant for more evidence is deliberately *not* a transition.
   * The record has not moved on; it is still being verified, and the request
   * belongs on the timeline and in a task, where it can be chased.
   */
  [RECORD_STATUS.UNDER_REVIEW]: [
    {
      to: RECORD_STATUS.VERIFICATION_PENDING,
      label: 'Verification complete — send for approval',
      permission: VERIFY,
      guards: ['has_evidence'],
      requiresRemark: true,
    },
    { to: RECORD_STATUS.REJECTED, label: 'Reject', permission: VERIFY, requiresRemark: true },
    { to: RECORD_STATUS.ON_HOLD, label: 'Put on hold', permission: CHANGE_STATUS, requiresRemark: true },
  ],

  /**
   * §Pipeline 3 — Approval Pending.
   *
   * The approver's queue. Approving sends the selection letter and moves the
   * record to Selection Sent; the two are one act, so the transition carries
   * the guard that the letter needs a live applicant to go to.
   */
  [RECORD_STATUS.VERIFICATION_PENDING]: [
    {
      to: RECORD_STATUS.SELECTED,
      label: 'Approve — send selection',
      permission: VERIFY,
      guards: ['has_evidence', 'not_blacklisted'],
      requiresRemark: true,
    },
    { to: RECORD_STATUS.REJECTED, label: 'Reject', permission: VERIFY, requiresRemark: true },
    // Something in the verification did not hold up. Back to Verification
    // rather than on to a decision nobody can defend.
    { to: RECORD_STATUS.UNDER_REVIEW, label: 'Send back to verification', permission: VERIFY, requiresRemark: true },
    { to: RECORD_STATUS.ON_HOLD, label: 'Put on hold', permission: CHANGE_STATUS, requiresRemark: true },
  ],

  [RECORD_STATUS.ON_HOLD]: [
    { to: RECORD_STATUS.UNDER_REVIEW, label: 'Resume review', permission: CHANGE_STATUS },
    { to: RECORD_STATUS.APPLICATION_SUBMITTED, label: 'Back to intake', permission: CHANGE_STATUS },
    { to: RECORD_STATUS.CLOSED, label: 'Close', permission: CHANGE_STATUS, requiresRemark: true },
  ],

  [RECORD_STATUS.SELECTED]: [
    {
      to: RECORD_STATUS.PAYMENT_PENDING,
      label: 'Raise payment',
      permission: CHANGE_STATUS,
      guards: ['has_payment_plan'],
    },
    { to: RECORD_STATUS.ON_HOLD, label: 'Put on hold', permission: CHANGE_STATUS, requiresRemark: true },
  ],

  [RECORD_STATUS.REJECTED]: [
    {
      to: RECORD_STATUS.UNDER_REVIEW,
      label: 'Reopen for review (Admin)',
      permission: OVERRIDE,
      requiresRemark: true,
      requiresOverride: true,
    },
  ],

  [RECORD_STATUS.PAYMENT_PENDING]: [
    {
      to: RECORD_STATUS.PAYMENT_RECEIVED,
      label: 'Mark payment received',
      permission: p(MODULES.PAYMENTS, ACTIONS.EDIT),
      guards: ['payment_settled'],
    },
    { to: RECORD_STATUS.ON_HOLD, label: 'Put on hold', permission: CHANGE_STATUS, requiresRemark: true },
  ],

  // Reaching Payment Received advances to Certificate Verification on its own —
  // there was never a decision to take here, only a click to remember. The
  // transition is kept for the rare manual correction.
  [RECORD_STATUS.PAYMENT_RECEIVED]: [
    {
      to: RECORD_STATUS.CERTIFICATE_PENDING,
      label: 'Send to certificate verification',
      permission: CHANGE_STATUS,
    },
  ],

  /**
   * The certificate stage completes only when an employee says so.
   *
   * The guard is `certificate_verified`, not `has_certificate`, so this reads
   * the same whether it is reached from the Certificate tab's sign-off button
   * or from the Change Status modal — neither can complete the stage on an
   * unchecked file, and nothing automatic can complete it at all.
   */
  [RECORD_STATUS.CERTIFICATE_PENDING]: [
    {
      to: RECORD_STATUS.CERTIFICATE_UPLOADED,
      label: 'Mark certificate completed',
      permission: p(MODULES.CERTIFICATES, ACTIONS.CREATE),
      guards: ['certificate_verified'],
    },
  ],

  /**
   * §Pipeline 6 → 7. A completed certificate goes to Dispatch, and only there.
   *
   * Publication used to be an alternative exit from here, which had the
   * magazine entry written while the certificate was still in the office. It
   * now comes after delivery — see `DELIVERED` below.
   */
  [RECORD_STATUS.CERTIFICATE_UPLOADED]: [
    { to: RECORD_STATUS.DISPATCH_PENDING, label: 'Ready for dispatch', permission: CHANGE_STATUS },
  ],

  /**
   * §Pipeline 8 — Publication, the last working stage.
   *
   * Reached only from Delivered. Completing from here is the normal end for a
   * record that was published; the record can also be completed straight from
   * Delivered without ever coming here.
   */
  [RECORD_STATUS.PUBLICATION]: [
    { to: RECORD_STATUS.COMPLETED, label: 'Complete & lock', permission: CHANGE_STATUS },
  ],

  [RECORD_STATUS.DISPATCH_PENDING]: [
    {
      to: RECORD_STATUS.DISPATCHED,
      label: 'Mark dispatched',
      permission: p(MODULES.DISPATCH, ACTIONS.EDIT),
      guards: ['has_dispatch'],
    },
  ],

  [RECORD_STATUS.DISPATCHED]: [
    {
      to: RECORD_STATUS.DELIVERED,
      label: 'Mark delivered',
      permission: p(MODULES.DISPATCH, ACTIONS.EDIT),
    },
  ],

  /**
   * §Pipeline 7 → 8. Delivered offers Publication, and also the exit past it.
   *
   * Most records are never published, and a mandatory Publication stage would
   * park every one of them in a queue nobody will action — which is how a
   * queue stops being read. So Publication is offered first, and completing
   * directly is the honest path for a record that has no publication to make.
   */
  [RECORD_STATUS.DELIVERED]: [
    {
      to: RECORD_STATUS.PUBLICATION,
      label: 'Send to publication',
      permission: p(MODULES.PUBLICATIONS, ACTIONS.CREATE),
    },
    { to: RECORD_STATUS.COMPLETED, label: 'Complete & lock', permission: CHANGE_STATUS },
  ],

  // §11 stage 9 — Completed locks the workflow. Reopening is an audited
  // Admin override; the profile itself stays fully readable forever.
  [RECORD_STATUS.COMPLETED]: [
    {
      to: RECORD_STATUS.DELIVERED,
      label: 'Reopen (Admin override)',
      permission: OVERRIDE,
      requiresRemark: true,
      requiresOverride: true,
    },
  ],

  [RECORD_STATUS.CLOSED]: [
    {
      to: RECORD_STATUS.APPLICATION_SUBMITTED,
      label: 'Reopen (Admin override)',
      permission: OVERRIDE,
      requiresRemark: true,
      requiresOverride: true,
    },
  ],
};

export function allowedTransitions(from: RecordStatus): readonly StatusTransition[] {
  return STATUS_TRANSITIONS[from] ?? [];
}

export function findTransition(
  from: RecordStatus,
  to: RecordStatus,
): StatusTransition | undefined {
  return allowedTransitions(from).find((t) => t.to === to);
}

/**
 * ── Smart Workflow Engine (§11) ──────────────────────────────────────────────
 *
 * "The system should not only store data, but also guide employees through the
 * next step based on the current applicant status." For every status we declare
 * the contextual actions to surface in the profile's Next Steps panel. The API
 * computes the panel server-side (GET /records/:id/actions), filters by the
 * caller's permissions and live record data, and caches it per status.
 */
export type ActionKind =
  | 'modal'
  | 'navigate'
  | 'transition'
  | 'download'
  | 'external';

export interface StageAction {
  readonly id: string;
  readonly label: string;
  /** lucide-react icon name — the UI maps this through a single typed icon map. */
  readonly icon: string;
  readonly kind: ActionKind;
  /** Modal id, route or transition target depending on `kind`. */
  readonly target: string;
  readonly permission: PermissionCode;
  readonly variant?: 'primary' | 'secondary' | 'success' | 'danger' | 'whatsapp';
  /** Hidden when the applicant carries the DO_NOT_CONTACT flag. */
  readonly suppressedByDoNotContact?: boolean;
}

export const STAGE_ACTIONS: Readonly<Record<RecordStatus, readonly StageAction[]>> = {
  // §11.1 New Lead
  [RECORD_STATUS.NEW_LEAD]: [
    { id: 'add-followup', label: 'Add follow-up', icon: 'CalendarPlus', kind: 'modal', target: 'task', permission: p(MODULES.TASKS, ACTIONS.CREATE), variant: 'primary' },
    { id: 'assign-employee', label: 'Assign employee', icon: 'UserPlus', kind: 'modal', target: 'assign', permission: p(MODULES.RECORDS, ACTIONS.EDIT) },
    { id: 'add-note', label: 'Add note', icon: 'StickyNote', kind: 'modal', target: 'note', permission: p(MODULES.NOTES, ACTIONS.CREATE) },
    { id: 'call-note', label: 'Log call', icon: 'Phone', kind: 'modal', target: 'call-note', permission: p(MODULES.COMMUNICATIONS, ACTIONS.SEND), suppressedByDoNotContact: true },
  ],

  // §Pipeline 1 — New Application
  [RECORD_STATUS.APPLICATION_SUBMITTED]: [
    { id: 'review-application', label: 'Start verification', icon: 'ClipboardCheck', kind: 'transition', target: RECORD_STATUS.UNDER_REVIEW, permission: CHANGE_STATUS, variant: 'primary' },
    { id: 'upload-evidence', label: 'Upload missing documents', icon: 'Upload', kind: 'modal', target: 'evidence', permission: p(MODULES.EVIDENCE, ACTIONS.CREATE) },
    { id: 'assign-verification', label: 'Assign verification team', icon: 'Users', kind: 'modal', target: 'assign', permission: p(MODULES.RECORDS, ACTIONS.EDIT) },
  ],

  /**
   * §Pipeline 2 — Verification.
   *
   * Checking the documents, and then handing over. Approve is gone from here
   * on purpose: it let one person verify and approve in a single click, which
   * is how Approval Pending stayed empty and nobody could see what was waiting
   * on a decision. Rejecting outright is still available — a forged document
   * needs no second opinion.
   */
  [RECORD_STATUS.UNDER_REVIEW]: [
    { id: 'verify-documents', label: 'Verify documents', icon: 'ShieldCheck', kind: 'navigate', target: 'tab:evidence', permission: p(MODULES.EVIDENCE, ACTIONS.VIEW), variant: 'primary' },
    { id: 'request-evidence', label: 'Request more evidence', icon: 'MailQuestion', kind: 'modal', target: 'email', permission: p(MODULES.COMMUNICATIONS, ACTIONS.SEND), suppressedByDoNotContact: true },
    { id: 'verification-remarks', label: 'Add verification remarks', icon: 'PenLine', kind: 'modal', target: 'note', permission: p(MODULES.NOTES, ACTIONS.CREATE) },
    { id: 'send-for-approval', label: 'Verification complete', icon: 'CheckCircle2', kind: 'transition', target: RECORD_STATUS.VERIFICATION_PENDING, permission: VERIFY, variant: 'success' },
    { id: 'reject', label: 'Reject', icon: 'XCircle', kind: 'transition', target: RECORD_STATUS.REJECTED, permission: VERIFY, variant: 'danger' },
  ],

  // §Pipeline 3 — Approval Pending. The approver's decision, and nothing else.
  [RECORD_STATUS.VERIFICATION_PENDING]: [
    { id: 'review-evidence', label: 'Review evidence', icon: 'ShieldCheck', kind: 'navigate', target: 'tab:evidence', permission: p(MODULES.EVIDENCE, ACTIONS.VIEW) },
    { id: 'approve', label: 'Approve & send selection', icon: 'CheckCircle2', kind: 'transition', target: RECORD_STATUS.SELECTED, permission: VERIFY, variant: 'success' },
    { id: 'reject', label: 'Reject', icon: 'XCircle', kind: 'transition', target: RECORD_STATUS.REJECTED, permission: VERIFY, variant: 'danger' },
    { id: 'back-to-verification', label: 'Send back to verification', icon: 'RotateCcw', kind: 'transition', target: RECORD_STATUS.UNDER_REVIEW, permission: VERIFY },
  ],

  [RECORD_STATUS.ON_HOLD]: [
    { id: 'resume', label: 'Resume', icon: 'PlayCircle', kind: 'transition', target: RECORD_STATUS.UNDER_REVIEW, permission: CHANGE_STATUS, variant: 'primary' },
    { id: 'add-note', label: 'Add note', icon: 'StickyNote', kind: 'modal', target: 'note', permission: p(MODULES.NOTES, ACTIONS.CREATE) },
  ],

  /**
   * §Pipeline 4 — Selection Sent.
   *
   * The letter is the work of this stage, so it leads. The Selection Sent panel
   * on the record reads the communication history and says whether it has
   * actually gone — an approved applicant nobody wrote to is the failure this
   * stage exists to catch.
   */
  [RECORD_STATUS.SELECTED]: [
    { id: 'selection-letter', label: 'Send selection letter', icon: 'FileDown', kind: 'modal', target: 'selection-letter', permission: p(MODULES.COMMUNICATIONS, ACTIONS.SEND), variant: 'primary', suppressedByDoNotContact: true },
    { id: 'send-selection-email', label: 'Send selection email', icon: 'Mail', kind: 'modal', target: 'email:selection', permission: p(MODULES.COMMUNICATIONS, ACTIONS.SEND), suppressedByDoNotContact: true },
    { id: 'send-selection-whatsapp', label: 'Send selection WhatsApp', icon: 'MessageCircle', kind: 'modal', target: 'whatsapp:selection', permission: p(MODULES.COMMUNICATIONS, ACTIONS.SEND), variant: 'whatsapp', suppressedByDoNotContact: true },
    { id: 'download-selection-letter', label: 'Download selection letter', icon: 'FileDown', kind: 'download', target: 'selection-letter', permission: p(MODULES.RECORDS, ACTIONS.EXPORT) },
    { id: 'set-payment-deadline', label: 'Set payment deadline', icon: 'CalendarClock', kind: 'modal', target: 'payment-plan', permission: p(MODULES.PAYMENTS, ACTIONS.CREATE) },
    { id: 'add-note', label: 'Add internal note', icon: 'StickyNote', kind: 'modal', target: 'note', permission: p(MODULES.NOTES, ACTIONS.CREATE) },
  ],

  [RECORD_STATUS.REJECTED]: [
    { id: 'send-rejection-email', label: 'Send rejection email', icon: 'Mail', kind: 'modal', target: 'email:rejection', permission: p(MODULES.COMMUNICATIONS, ACTIONS.SEND), suppressedByDoNotContact: true },
    { id: 'reopen', label: 'Reopen (Admin)', icon: 'Undo2', kind: 'transition', target: RECORD_STATUS.UNDER_REVIEW, permission: OVERRIDE },
  ],

  // §11.5 Payment Pending — panel also shows due date, days remaining, reminder count
  [RECORD_STATUS.PAYMENT_PENDING]: [
    { id: 'payment-reminder-email', label: 'Send payment reminder (Email)', icon: 'MailWarning', kind: 'modal', target: 'email:payment_reminder', permission: p(MODULES.COMMUNICATIONS, ACTIONS.SEND), variant: 'primary', suppressedByDoNotContact: true },
    { id: 'payment-reminder-whatsapp', label: 'Send payment reminder (WhatsApp)', icon: 'MessageCircle', kind: 'modal', target: 'whatsapp:payment_reminder', permission: p(MODULES.COMMUNICATIONS, ACTIONS.SEND), variant: 'whatsapp', suppressedByDoNotContact: true },
    { id: 'record-payment', label: 'Record payment', icon: 'IndianRupee', kind: 'modal', target: 'payment', permission: p(MODULES.PAYMENTS, ACTIONS.CREATE), variant: 'success' },
  ],

  /**
   * §Pipeline 5 — Fees Received.
   *
   * A staging post rather than a stage with work in it: the record advances to
   * Certificate Verification by itself the moment the fee settles. What is left
   * here is the paperwork that belongs to the money.
   */
  [RECORD_STATUS.PAYMENT_RECEIVED]: [
    { id: 'upload-certificate', label: 'Upload certificate', icon: 'Award', kind: 'modal', target: 'certificate', permission: p(MODULES.CERTIFICATES, ACTIONS.CREATE), variant: 'primary' },
    { id: 'assign-operations', label: 'Assign operations team', icon: 'Users', kind: 'modal', target: 'assign', permission: p(MODULES.RECORDS, ACTIONS.EDIT) },
    { id: 'create-dispatch-task', label: 'Create dispatch task', icon: 'ListChecks', kind: 'modal', target: 'task', permission: p(MODULES.TASKS, ACTIONS.CREATE) },
    { id: 'generate-invoice', label: 'Generate invoice', icon: 'ReceiptIndianRupee', kind: 'download', target: 'invoice', permission: p(MODULES.PAYMENTS, ACTIONS.EXPORT) },
    { id: 'payment-confirmation', label: 'Send payment confirmation', icon: 'Mail', kind: 'modal', target: 'email:payment_confirmation', permission: p(MODULES.COMMUNICATIONS, ACTIONS.SEND), suppressedByDoNotContact: true },
  ],

  /**
   * §11.6b Certificate Verification.
   *
   * Two steps, both by hand, in the order they happen. The second is the one
   * that completes the stage and sends the record to Dispatch — it opens the
   * Certificate tab rather than firing a transition, because the operator is
   * meant to look at the file before signing it off.
   */
  [RECORD_STATUS.CERTIFICATE_PENDING]: [
    { id: 'upload-certificate', label: 'Upload certificate', icon: 'Award', kind: 'modal', target: 'certificate', permission: p(MODULES.CERTIFICATES, ACTIONS.CREATE), variant: 'primary' },
    { id: 'verify-certificate', label: 'Mark certificate verified', icon: 'ShieldCheck', kind: 'modal', target: 'certificate', permission: p(MODULES.CERTIFICATES, ACTIONS.CREATE), variant: 'success' },
    { id: 'assign-operations', label: 'Assign operations team', icon: 'Users', kind: 'modal', target: 'assign', permission: p(MODULES.RECORDS, ACTIONS.EDIT) },
  ],

  /**
   * §Pipeline 6 — Certificate Completed. The next stop is Dispatch, and only
   * Dispatch; publication now happens after the parcel has been delivered.
   */
  [RECORD_STATUS.CERTIFICATE_UPLOADED]: [
    { id: 'send-certificate-email', label: 'Send certificate email', icon: 'Mail', kind: 'modal', target: 'email:certificate_ready', permission: p(MODULES.COMMUNICATIONS, ACTIONS.SEND), variant: 'primary', suppressedByDoNotContact: true },
    { id: 'send-certificate-whatsapp', label: 'Send certificate WhatsApp', icon: 'MessageCircle', kind: 'modal', target: 'whatsapp:certificate', permission: p(MODULES.COMMUNICATIONS, ACTIONS.SEND), variant: 'whatsapp', suppressedByDoNotContact: true },
    { id: 'ready-for-dispatch', label: 'Mark ready for dispatch', icon: 'PackageCheck', kind: 'transition', target: RECORD_STATUS.DISPATCH_PENDING, permission: CHANGE_STATUS, variant: 'success' },
  ],

  // §Pipeline 8 — Publication. The magazine and website entries, then done.
  [RECORD_STATUS.PUBLICATION]: [
    { id: 'add-publication', label: 'Add publication', icon: 'Newspaper', kind: 'modal', target: 'publication', permission: p(MODULES.PUBLICATIONS, ACTIONS.CREATE), variant: 'primary' },
    { id: 'upload-magazine', label: 'Upload magazine', icon: 'BookOpen', kind: 'modal', target: 'publication:magazine', permission: p(MODULES.PUBLICATIONS, ACTIONS.CREATE) },
    { id: 'upload-enews', label: 'Upload e-news', icon: 'Newspaper', kind: 'modal', target: 'publication:enews', permission: p(MODULES.PUBLICATIONS, ACTIONS.CREATE) },
    { id: 'complete', label: 'Complete & lock', icon: 'Lock', kind: 'transition', target: RECORD_STATUS.COMPLETED, permission: CHANGE_STATUS, variant: 'success' },
  ],

  // §11.8 Dispatch
  [RECORD_STATUS.DISPATCH_PENDING]: [
    { id: 'add-courier', label: 'Add courier details', icon: 'Truck', kind: 'modal', target: 'dispatch', permission: p(MODULES.DISPATCH, ACTIONS.CREATE), variant: 'primary' },
    { id: 'update-tracking', label: 'Update tracking number', icon: 'ScanBarcode', kind: 'modal', target: 'dispatch', permission: p(MODULES.DISPATCH, ACTIONS.EDIT) },
  ],

  [RECORD_STATUS.DISPATCHED]: [
    { id: 'send-dispatch-email', label: 'Send dispatch email', icon: 'Mail', kind: 'modal', target: 'email:dispatch', permission: p(MODULES.COMMUNICATIONS, ACTIONS.SEND), suppressedByDoNotContact: true },
    { id: 'mark-delivered', label: 'Mark delivered', icon: 'PackageCheck', kind: 'transition', target: RECORD_STATUS.DELIVERED, permission: p(MODULES.DISPATCH, ACTIONS.EDIT), variant: 'success' },
    { id: 'upload-pod', label: 'Upload proof of delivery', icon: 'FileCheck2', kind: 'modal', target: 'dispatch:pod', permission: p(MODULES.DISPATCH, ACTIONS.EDIT) },
  ],

  /**
   * §Pipeline 7 → 8. Delivered, and the fork: publish, or finish.
   *
   * Publication leads because it is the stage that follows in the pipeline, but
   * completing directly sits beside it — most records are never published, and
   * routing all of them through a publication queue would fill it with rows
   * nobody intends to action.
   */
  [RECORD_STATUS.DELIVERED]: [
    { id: 'send-congratulations', label: 'Send congratulations', icon: 'PartyPopper', kind: 'modal', target: 'email:congratulations', permission: p(MODULES.COMMUNICATIONS, ACTIONS.SEND), suppressedByDoNotContact: true },
    { id: 'send-to-publication', label: 'Send to publication', icon: 'Newspaper', kind: 'transition', target: RECORD_STATUS.PUBLICATION, permission: p(MODULES.PUBLICATIONS, ACTIONS.CREATE), variant: 'primary' },
    { id: 'complete', label: 'Complete & lock', icon: 'Lock', kind: 'transition', target: RECORD_STATUS.COMPLETED, permission: CHANGE_STATUS, variant: 'success' },
  ],

  // §11.9 Completed — workflow locked, profile stays active for reference
  [RECORD_STATUS.COMPLETED]: [
    { id: 'download-certificate', label: 'Re-download certificate', icon: 'FileDown', kind: 'download', target: 'certificate', permission: p(MODULES.CERTIFICATES, ACTIONS.VIEW), variant: 'primary' },
    { id: 'new-record', label: 'Create new record for this applicant', icon: 'FilePlus2', kind: 'navigate', target: 'record:new', permission: p(MODULES.RECORDS, ACTIONS.CREATE) },
    { id: 'export-pdf', label: 'Export applicant PDF', icon: 'Printer', kind: 'download', target: 'applicant-pdf', permission: p(MODULES.APPLICANTS, ACTIONS.EXPORT) },
  ],

  [RECORD_STATUS.CLOSED]: [
    { id: 'reopen', label: 'Reopen (Admin)', icon: 'Undo2', kind: 'transition', target: RECORD_STATUS.APPLICATION_SUBMITTED, permission: OVERRIDE },
    { id: 'new-record', label: 'Create new record', icon: 'FilePlus2', kind: 'navigate', target: 'record:new', permission: p(MODULES.RECORDS, ACTIONS.CREATE) },
  ],
};

export function stageActions(status: RecordStatus): readonly StageAction[] {
  return STAGE_ACTIONS[status] ?? [];
}

/**
 * The panel on the applicant profile where this stage's work actually happens.
 *
 * One mapping, used for two things that were previously left to the operator:
 * which panel to open when a profile is first opened, and which panel to follow
 * the record to when its stage changes under them.
 *
 * Verification already behaved this way — its primary action navigates to
 * Evidence — but only because somebody wrote that one action by hand. Every
 * other stage left the operator on whichever panel they happened to be on, so
 * recording a payment advanced the record to Certificate Verification and left
 * them looking at the payment ledger, with no sign that the work had moved.
 *
 * Stages with no work of their own point at Overview rather than inventing a
 * destination: a rejected or completed record is read, not worked on.
 */
const STAGE_WORK_TAB: Readonly<Record<RecordStatus, string>> = {
  // Intake — the application itself is what there is to look at.
  [RECORD_STATUS.NEW_LEAD]: 'overview',
  [RECORD_STATUS.APPLICATION_SUBMITTED]: 'application',

  // Verification and approval are both decided by reading the evidence.
  [RECORD_STATUS.UNDER_REVIEW]: 'evidence',
  [RECORD_STATUS.VERIFICATION_PENDING]: 'evidence',

  // The selection letter is the work, and it goes out from Communication.
  [RECORD_STATUS.SELECTED]: 'communication',

  [RECORD_STATUS.PAYMENT_PENDING]: 'payment',

  // Fees received: the money is done and the certificate is what is owed next.
  [RECORD_STATUS.PAYMENT_RECEIVED]: 'certificate',
  [RECORD_STATUS.CERTIFICATE_PENDING]: 'certificate',
  [RECORD_STATUS.CERTIFICATE_UPLOADED]: 'certificate',

  [RECORD_STATUS.DISPATCH_PENDING]: 'dispatch',
  [RECORD_STATUS.DISPATCHED]: 'dispatch',
  [RECORD_STATUS.DELIVERED]: 'dispatch',

  [RECORD_STATUS.PUBLICATION]: 'publications',

  // Nothing left to do — these are read rather than worked.
  [RECORD_STATUS.ON_HOLD]: 'overview',
  [RECORD_STATUS.REJECTED]: 'overview',
  [RECORD_STATUS.COMPLETED]: 'overview',
  [RECORD_STATUS.CLOSED]: 'overview',
};

/**
 * Where the work is for a record at this status.
 *
 * Falls back to Overview, which is always safe to land on — a status this build
 * does not recognise must not send the operator to a panel that cannot render
 * it.
 */
export function stageWorkTab(status: string): string {
  return STAGE_WORK_TAB[status as RecordStatus] ?? 'overview';
}

/**
 * Timeline event types (§13). Append-only: the API writes these, nothing
 * updates or deletes them. `meta` carries the structured payload per type.
 */
export const TIMELINE_EVENT = {
  APPLICANT_CREATED: 'applicant.created',
  APPLICANT_UPDATED: 'applicant.updated',
  APPLICANT_MERGED: 'applicant.merged',
  RECORD_CREATED: 'record.created',
  RECORD_UPDATED: 'record.updated',
  RECORD_IMPORTED: 'record.imported',
  STATUS_CHANGED: 'record.status_changed',
  ASSIGNED: 'record.assigned',
  EVIDENCE_UPLOADED: 'evidence.uploaded',
  ATTACHMENT_UPLOADED: 'attachment.uploaded',
  NOTE_ADDED: 'note.added',
  NOTE_EDITED: 'note.edited',
  TASK_CREATED: 'task.created',
  TASK_COMPLETED: 'task.completed',
  PAYMENT_PLAN_CREATED: 'payment.plan_created',
  PAYMENT_RECORDED: 'payment.recorded',
  PAYMENT_SETTLED: 'payment.settled',
  INVOICE_GENERATED: 'payment.invoice_generated',
  CERTIFICATE_UPLOADED: 'certificate.uploaded',
  CERTIFICATE_VERSIONED: 'certificate.versioned',
  PUBLICATION_ADDED: 'publication.added',
  DISPATCH_CREATED: 'dispatch.created',
  DISPATCH_UPDATED: 'dispatch.updated',
  DISPATCH_DELIVERED: 'dispatch.delivered',
  EMAIL_SENT: 'communication.email_sent',
  WHATSAPP_SENT: 'communication.whatsapp_sent',
  CALL_LOGGED: 'communication.call_logged',
  BLACKLISTED: 'blacklist.added',
  BLACKLIST_LIFTED: 'blacklist.lifted',
  FLAG_ADDED: 'flag.added',
  FLAG_REMOVED: 'flag.removed',
  CONSENT_RECORDED: 'privacy.consent_recorded',
  CONSENT_WITHDRAWN: 'privacy.consent_withdrawn',
  DSR_RAISED: 'privacy.dsr_raised',
  DSR_RESOLVED: 'privacy.dsr_resolved',
  DATA_ERASED: 'privacy.data_erased',
} as const;

export type TimelineEventType = (typeof TIMELINE_EVENT)[keyof typeof TIMELINE_EVENT];
