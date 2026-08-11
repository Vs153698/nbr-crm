import { describe, expect, it } from 'vitest';
import {
  allowedTransitions,
  findTransition,
  isTerminalStatus,
  ORDERED_STATUSES,
  RECORD_STATUS,
  STAGE_ACTIONS,
  STATUS_META,
  STATUS_TRANSITIONS,
  type RecordStatus,
} from '../index';

/**
 * The state machine is the single source of truth for what a record may do.
 * These tests assert its shape rather than one happy path, because an illegal
 * transition that slips through is a data-integrity bug, not a UI bug.
 */
describe('status state machine', () => {
  it('declares metadata for every status', () => {
    for (const status of Object.values(RECORD_STATUS)) {
      expect(STATUS_META[status], `missing metadata for ${status}`).toBeDefined();
      expect(STATUS_META[status].label.length).toBeGreaterThan(0);
    }
  });

  it('only ever transitions to a status that exists', () => {
    const known = new Set<string>(Object.values(RECORD_STATUS));

    for (const [from, transitions] of Object.entries(STATUS_TRANSITIONS)) {
      for (const transition of transitions) {
        expect(known.has(transition.to), `${from} → ${transition.to} targets an unknown status`).toBe(
          true,
        );
      }
    }
  });

  it('never declares a transition to itself', () => {
    for (const [from, transitions] of Object.entries(STATUS_TRANSITIONS)) {
      for (const transition of transitions) {
        expect(transition.to, `${from} transitions to itself`).not.toBe(from);
      }
    }
  });

  it('rejects the jumps the workflow forbids', () => {
    // Straight from Application Submitted to Completed would skip review,
    // payment and dispatch entirely.
    expect(findTransition(RECORD_STATUS.APPLICATION_SUBMITTED, RECORD_STATUS.COMPLETED)).toBeUndefined();
    expect(findTransition(RECORD_STATUS.NEW_LEAD, RECORD_STATUS.SELECTED)).toBeUndefined();
    expect(findTransition(RECORD_STATUS.UNDER_REVIEW, RECORD_STATUS.DISPATCHED)).toBeUndefined();
    // Payment cannot be skipped.
    expect(findTransition(RECORD_STATUS.SELECTED, RECORD_STATUS.CERTIFICATE_UPLOADED)).toBeUndefined();
  });

  it('allows the documented happy path end to end', () => {
    // The pipeline, end to end: New Application → Verification → Approval
    // Pending → Selection Sent → Fees Received → Certificate → Dispatch →
    // Publication. Asserted as one walk so a transition removed anywhere along
    // it fails here rather than in production.
    const path: RecordStatus[] = [
      RECORD_STATUS.NEW_LEAD,
      RECORD_STATUS.APPLICATION_SUBMITTED,
      RECORD_STATUS.UNDER_REVIEW,
      RECORD_STATUS.VERIFICATION_PENDING,
      RECORD_STATUS.SELECTED,
      RECORD_STATUS.PAYMENT_PENDING,
      RECORD_STATUS.PAYMENT_RECEIVED,
      RECORD_STATUS.CERTIFICATE_PENDING,
      RECORD_STATUS.CERTIFICATE_UPLOADED,
      RECORD_STATUS.DISPATCH_PENDING,
      RECORD_STATUS.DISPATCHED,
      RECORD_STATUS.DELIVERED,
      RECORD_STATUS.PUBLICATION,
      RECORD_STATUS.COMPLETED,
    ];

    for (let index = 0; index < path.length - 1; index += 1) {
      const from = path[index]!;
      const to = path[index + 1]!;
      expect(findTransition(from, to), `${from} → ${to} should be legal`).toBeDefined();
    }
  });

  it('guards approval behind evidence', () => {
    // Approval is taken from Approval Pending, not from Verification — that
    // separation is the point of the stage, so assert where it lives too.
    expect(findTransition(RECORD_STATUS.UNDER_REVIEW, RECORD_STATUS.SELECTED)).toBeUndefined();

    const approve = findTransition(RECORD_STATUS.VERIFICATION_PENDING, RECORD_STATUS.SELECTED);
    expect(approve?.guards).toContain('has_evidence');
    expect(approve?.guards).toContain('not_blacklisted');
    expect(approve?.requiresRemark).toBe(true);
  });

  it('guards payment completion behind a settled balance', () => {
    const settle = findTransition(RECORD_STATUS.PAYMENT_PENDING, RECORD_STATUS.PAYMENT_RECEIVED);
    expect(settle?.guards).toContain('payment_settled');
  });

  it('locks terminal statuses and only reopens them behind an override', () => {
    expect(isTerminalStatus(RECORD_STATUS.COMPLETED)).toBe(true);
    expect(isTerminalStatus(RECORD_STATUS.REJECTED)).toBe(true);
    expect(isTerminalStatus(RECORD_STATUS.UNDER_REVIEW)).toBe(false);

    for (const transition of allowedTransitions(RECORD_STATUS.COMPLETED)) {
      expect(transition.requiresOverride, 'a completed record must not reopen freely').toBe(true);
    }
  });

  it('leaves no status stranded — every one is reachable or is an entry point', () => {
    const reachable = new Set<string>([
      RECORD_STATUS.NEW_LEAD,
      RECORD_STATUS.APPLICATION_SUBMITTED,
      RECORD_STATUS.UNDER_REVIEW,
    ]);

    for (const transitions of Object.values(STATUS_TRANSITIONS)) {
      for (const transition of transitions) reachable.add(transition.to);
    }

    for (const status of Object.values(RECORD_STATUS)) {
      expect(reachable.has(status), `${status} is unreachable`).toBe(true);
    }
  });

  it('gives every status a Smart Action panel', () => {
    for (const status of Object.values(RECORD_STATUS)) {
      expect(STAGE_ACTIONS[status], `no stage actions for ${status}`).toBeDefined();
    }
  });

  it('orders statuses without duplicate sort positions', () => {
    const orders = ORDERED_STATUSES.map((status) => status.order);
    expect(new Set(orders).size).toBe(orders.length);
  });
});

/**
 * The eight-stage pipeline, asserted as shape rather than as one happy path.
 *
 * Each of these encodes a rule that was wrong before and would be easy to undo
 * by accident — an approval shortcut, a publication step in the wrong place —
 * so they are worth more than a walk from end to end.
 */
describe('application pipeline', () => {
  it('lands every new application in New Application and nowhere else', () => {
    expect(STATUS_META[RECORD_STATUS.APPLICATION_SUBMITTED].label).toBe('New Application');

    // The only way further in is through Verification. A record cannot arrive
    // at Approval Pending, Selection Sent or anything past it without being
    // verified first.
    const onward = allowedTransitions(RECORD_STATUS.APPLICATION_SUBMITTED).map((t) => t.to);
    expect(onward).toContain(RECORD_STATUS.UNDER_REVIEW);
    expect(onward).not.toContain(RECORD_STATUS.VERIFICATION_PENDING);
    expect(onward).not.toContain(RECORD_STATUS.SELECTED);
  });

  it('separates verification from approval', () => {
    // Verification hands over; it does not decide. One person doing both in a
    // single click is what left Approval Pending empty.
    const fromVerification = allowedTransitions(RECORD_STATUS.UNDER_REVIEW).map((t) => t.to);
    expect(fromVerification).toContain(RECORD_STATUS.VERIFICATION_PENDING);
    expect(fromVerification).not.toContain(RECORD_STATUS.SELECTED);

    const fromApproval = allowedTransitions(RECORD_STATUS.VERIFICATION_PENDING).map((t) => t.to);
    expect(fromApproval).toContain(RECORD_STATUS.SELECTED);
  });

  it('names the stages the way the pipeline does', () => {
    expect(STATUS_META[RECORD_STATUS.UNDER_REVIEW].label).toBe('Verification');
    expect(STATUS_META[RECORD_STATUS.VERIFICATION_PENDING].label).toBe('Approval Pending');
    expect(STATUS_META[RECORD_STATUS.SELECTED].label).toBe('Selection Sent');
    expect(STATUS_META[RECORD_STATUS.PAYMENT_RECEIVED].label).toBe('Fees Received');
  });

  it('puts publication after dispatch, not before it', () => {
    // The old order produced the magazine entry while the certificate was
    // still in the office.
    expect(
      findTransition(RECORD_STATUS.CERTIFICATE_UPLOADED, RECORD_STATUS.PUBLICATION),
    ).toBeUndefined();
    expect(
      findTransition(RECORD_STATUS.PUBLICATION, RECORD_STATUS.DISPATCH_PENDING),
    ).toBeUndefined();

    expect(findTransition(RECORD_STATUS.DELIVERED, RECORD_STATUS.PUBLICATION)).toBeDefined();

    const order = STATUS_META[RECORD_STATUS.PUBLICATION].order;
    expect(order).toBeGreaterThan(STATUS_META[RECORD_STATUS.DISPATCHED].order);
    expect(order).toBeGreaterThan(STATUS_META[RECORD_STATUS.DELIVERED].order);
  });

  it('leaves publication optional', () => {
    // A record nobody publishes must still be able to finish, or the
    // publication queue fills with rows no one will ever action.
    expect(findTransition(RECORD_STATUS.DELIVERED, RECORD_STATUS.COMPLETED)).toBeDefined();
    expect(findTransition(RECORD_STATUS.PUBLICATION, RECORD_STATUS.COMPLETED)).toBeDefined();
  });
});

/**
 * The certificate stage is employee-controlled by construction, not by
 * convention. These assert the parts of that which live in the state machine —
 * the rest is enforced in `CertificatesService.verify` and the
 * `certificate_verified` guard, both of which read their rules from here.
 */
describe('certificate stage', () => {
  it('routes fees received into certificate verification', () => {
    const transition = findTransition(
      RECORD_STATUS.PAYMENT_RECEIVED,
      RECORD_STATUS.CERTIFICATE_PENDING,
    );

    expect(transition, 'a paid record must be able to reach certificate verification').toBeDefined();
  });

  it('completes the certificate stage only on a verified certificate', () => {
    const transition = findTransition(
      RECORD_STATUS.CERTIFICATE_PENDING,
      RECORD_STATUS.CERTIFICATE_UPLOADED,
    );

    expect(transition).toBeDefined();
    // `has_certificate` would pass on any uploaded file, including a draft the
    // designer sent for comment. The stage completes on a person's sign-off.
    expect(transition?.guards).toContain('certificate_verified');
    expect(transition?.guards).not.toContain('has_certificate');
  });

  it('offers no way out of certificate verification except completing it', () => {
    const exits = allowedTransitions(RECORD_STATUS.CERTIFICATE_PENDING).map((t) => t.to);

    // Anything else here would be a path around the sign-off — which is the
    // one thing this stage exists to make unavoidable.
    expect(exits).toEqual([RECORD_STATUS.CERTIFICATE_UPLOADED]);
  });

  it('sends a completed certificate on to dispatch', () => {
    const exits = allowedTransitions(RECORD_STATUS.CERTIFICATE_UPLOADED).map((t) => t.to);
    expect(exits).toContain(RECORD_STATUS.DISPATCH_PENDING);
  });

  it('names the two stages the way the process does', () => {
    expect(STATUS_META[RECORD_STATUS.CERTIFICATE_PENDING].label).toBe('Certificate Verification');
    expect(STATUS_META[RECORD_STATUS.CERTIFICATE_UPLOADED].label).toBe('Certificate Completed');
  });

  it('puts both manual steps on the certificate verification panel', () => {
    const actions = STAGE_ACTIONS[RECORD_STATUS.CERTIFICATE_PENDING].map((action) => action.id);
    expect(actions).toContain('upload-certificate');
    expect(actions).toContain('verify-certificate');
  });
});
