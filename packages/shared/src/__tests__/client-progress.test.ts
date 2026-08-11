import { describe, expect, it } from 'vitest';
import {
  CLIENT_PROGRESS_STAGE,
  CLIENT_PROGRESS_STAGES,
  deriveClientProgress,
  type ClientProgressFacts,
} from '../index';

/** Nothing has happened yet. Each test switches on only what it is about. */
const NOTHING: ClientProgressFacts = {
  submittedAt: null,
  reviewStartedAt: null,
  evaluationCompletedAt: null,
  approvedAt: null,
  reminderSentAt: null,
  feesReceivedAt: null,
  certificateVerifiedAt: null,
  dispatchedAt: null,
  deliveredAt: null,
  photoReceivedAt: null,
  photoUploadedAt: null,
};

const AT = (day: number) => `2026-03-${String(day).padStart(2, '0')}T10:00:00.000Z`;

/**
 * The client's rule, stated once: a stage is complete because it happened, not
 * because the record has moved past it. These tests are the enforcement.
 */
describe('client progress badge', () => {
  it('lists the eleven stages the client asked for, in order', () => {
    expect(CLIENT_PROGRESS_STAGES.map((stage) => stage.label)).toEqual([
      'Submitted',
      'Under Review',
      'Evaluation Completed',
      'Approved',
      'Reminder Mail Sent',
      'Fees Received',
      'Certificate Verification',
      'Kit Dispatched',
      'Kit Delivered',
      'Photo Received',
      'Photo Uploaded',
    ]);

    CLIENT_PROGRESS_STAGES.forEach((stage, index) => {
      expect(stage.step).toBe(index + 1);
    });
  });

  it('reports nothing when nothing has happened', () => {
    const progress = deriveClientProgress(NOTHING);
    expect(progress.current).toBeNull();
    expect(progress.completed).toBe(0);
    expect(progress.stages.every((stage) => !stage.reached)).toBe(true);
  });

  it('never marks a later stage complete because an earlier one is', () => {
    // Submitted only. Everything downstream must stay open — this is the
    // failure the client is describing, so it gets its own test.
    const progress = deriveClientProgress({ ...NOTHING, submittedAt: AT(1) });

    expect(progress.completed).toBe(1);
    expect(progress.current?.code).toBe(CLIENT_PROGRESS_STAGE.SUBMITTED);
    expect(
      progress.stages.filter((stage) => stage.code !== CLIENT_PROGRESS_STAGE.SUBMITTED),
    ).toSatisfy((rest: typeof progress.stages) => rest.every((stage) => !stage.reached));
  });

  it('never marks an earlier stage complete because a later one is', () => {
    // The certificate is verified, but nobody recorded a review. The badge
    // must not backfill the earlier stages to make the run look continuous.
    const progress = deriveClientProgress({
      ...NOTHING,
      submittedAt: AT(1),
      certificateVerifiedAt: AT(9),
    });

    const byCode = Object.fromEntries(progress.stages.map((stage) => [stage.code, stage]));
    expect(byCode[CLIENT_PROGRESS_STAGE.CERTIFICATE_VERIFICATION]!.reached).toBe(true);
    expect(byCode[CLIENT_PROGRESS_STAGE.UNDER_REVIEW]!.reached).toBe(false);
    expect(byCode[CLIENT_PROGRESS_STAGE.APPROVED]!.reached).toBe(false);
    expect(progress.completed).toBe(2);
  });

  it('calls a passed-over stage skipped rather than complete', () => {
    // Paid before anyone chased them. Reporting the reminder as sent would be
    // the small lie the badge exists to avoid.
    const progress = deriveClientProgress({
      ...NOTHING,
      submittedAt: AT(1),
      approvedAt: AT(4),
      feesReceivedAt: AT(6),
    });

    const reminder = progress.stages.find(
      (stage) => stage.code === CLIENT_PROGRESS_STAGE.REMINDER_MAIL_SENT,
    )!;

    expect(reminder.reached).toBe(false);
    expect(reminder.skipped).toBe(true);
    expect(progress.current?.code).toBe(CLIENT_PROGRESS_STAGE.FEES_RECEIVED);
  });

  it('does not call an unreached future stage skipped', () => {
    const progress = deriveClientProgress({ ...NOTHING, submittedAt: AT(1) });

    // Nothing has been passed over — the record simply has not got there.
    expect(progress.stages.some((stage) => stage.skipped)).toBe(false);
  });

  it('reports the furthest milestone actually reached', () => {
    const progress = deriveClientProgress({
      ...NOTHING,
      submittedAt: AT(1),
      reviewStartedAt: AT(2),
      evaluationCompletedAt: AT(3),
      approvedAt: AT(4),
      reminderSentAt: AT(5),
      feesReceivedAt: AT(6),
      certificateVerifiedAt: AT(7),
      dispatchedAt: AT(8),
      deliveredAt: AT(9),
    });

    expect(progress.current?.code).toBe(CLIENT_PROGRESS_STAGE.KIT_DELIVERED);
    expect(progress.completed).toBe(9);
    expect(progress.total).toBe(11);
  });

  it('carries the date each milestone happened', () => {
    const progress = deriveClientProgress({ ...NOTHING, submittedAt: AT(1), approvedAt: AT(4) });
    const approved = progress.stages.find(
      (stage) => stage.code === CLIENT_PROGRESS_STAGE.APPROVED,
    )!;

    expect(approved.at).toBe(AT(4));
  });

  it('marks the stages that only an employee can complete', () => {
    const needsAction = CLIENT_PROGRESS_STAGES.filter((stage) => stage.needsEmployeeAction).map(
      (stage) => stage.code,
    );

    // Submitted and Fees Received happen to the record; every other stage waits
    // on a person, and the badge says so where one is not yet ticked.
    expect(needsAction).not.toContain(CLIENT_PROGRESS_STAGE.SUBMITTED);
    expect(needsAction).not.toContain(CLIENT_PROGRESS_STAGE.FEES_RECEIVED);
    expect(needsAction).toContain(CLIENT_PROGRESS_STAGE.CERTIFICATE_VERIFICATION);
    expect(needsAction).toContain(CLIENT_PROGRESS_STAGE.PHOTO_UPLOADED);
  });
});
