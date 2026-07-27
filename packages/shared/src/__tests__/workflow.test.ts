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
    const path: RecordStatus[] = [
      RECORD_STATUS.NEW_LEAD,
      RECORD_STATUS.APPLICATION_SUBMITTED,
      RECORD_STATUS.UNDER_REVIEW,
      RECORD_STATUS.SELECTED,
      RECORD_STATUS.PAYMENT_PENDING,
      RECORD_STATUS.PAYMENT_RECEIVED,
      RECORD_STATUS.CERTIFICATE_PENDING,
      RECORD_STATUS.CERTIFICATE_UPLOADED,
      RECORD_STATUS.DISPATCH_PENDING,
      RECORD_STATUS.DISPATCHED,
      RECORD_STATUS.DELIVERED,
      RECORD_STATUS.COMPLETED,
    ];

    for (let index = 0; index < path.length - 1; index += 1) {
      const from = path[index]!;
      const to = path[index + 1]!;
      expect(findTransition(from, to), `${from} → ${to} should be legal`).toBeDefined();
    }
  });

  it('guards approval behind evidence', () => {
    const approve = findTransition(RECORD_STATUS.UNDER_REVIEW, RECORD_STATUS.SELECTED);
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
