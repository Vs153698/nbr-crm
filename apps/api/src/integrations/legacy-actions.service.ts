import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  LEGACY_APPLICATION_ACTION,
  LEGACY_APPLICATION_ACTION_META,
  LEGACY_STAGE,
  RECORD_STATUS,
  TIMELINE_EVENT,
  type LegacyApplicationAction,
  type LegacyApplicationActionInput,
  type LegacyStage,
  type RecordStatus,
} from '@nbr/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { AUDIT, AuditService } from '../audit/audit.service';
import { NotFoundError, ValidationError } from '../common/errors';
import { requireActor } from '../common/request-context';
import type { Database } from '../database/client';
import { DB } from '../database/database.tokens';
import * as schema from '../database/schema';
import { CacheService, CacheTag } from '../redis/cache.service';
import { TimelineService } from '../timeline/timeline.service';
import { LegacyPushService } from './legacy-push.service';

export interface LegacyActionAvailability {
  readonly mirrored: boolean;
  readonly externalId: string | null;
  readonly externalUrl: string | null;
  /** The website's own application code, so an operator can cross-reference. */
  readonly appCode: string | null;
  /** The award applied for — "Bharat Vibhushan" and the like — for the badge. */
  readonly awardTitle: string | null;
  readonly awardCategory: string | null;
  readonly actions: readonly LegacyApplicationAction[];
}

/**
 * Which website review actions make sense at each point.
 *
 * Mirrors the guards on the website's own routes rather than restating them
 * loosely: it will not approve something already past the decision, only
 * validates from the statuses that route accepts, and only reopens from a
 * terminal state. Offering a button the far side would reject just moves the
 * error from "greyed out" to "failed after the click".
 */
function legacyActionsFor(status: RecordStatus): LegacyApplicationAction[] {
  const preDecision: RecordStatus[] = [
    RECORD_STATUS.APPLICATION_SUBMITTED,
    RECORD_STATUS.UNDER_REVIEW,
    RECORD_STATUS.VERIFICATION_PENDING,
  ];

  if (preDecision.includes(status)) {
    return [
      LEGACY_APPLICATION_ACTION.APPROVE,
      LEGACY_APPLICATION_ACTION.REJECT,
      LEGACY_APPLICATION_ACTION.REQUEST_INFO,
      // The website's validate route accepts only `pending` and `under_review`,
      // and Verification Pending is already the far side of it.
      ...(status === RECORD_STATUS.VERIFICATION_PENDING
        ? []
        : [LEGACY_APPLICATION_ACTION.VALIDATE]),
    ];
  }

  // Decided and being fulfilled. Cancelling is still on the table; approving
  // again is not.
  if (status === RECORD_STATUS.SELECTED || status === RECORD_STATUS.PAYMENT_RECEIVED) {
    return [LEGACY_APPLICATION_ACTION.CANCEL];
  }

  if (status === RECORD_STATUS.REJECTED || status === RECORD_STATUS.CLOSED) {
    return [LEGACY_APPLICATION_ACTION.REOPEN];
  }

  // Certificate issued and beyond — the applicant has been served, and there is
  // no review action left that would mean anything.
  return [];
}

/**
 * Website stages at which its own `cancel` route will accept the application.
 *
 * The route guards on `status IN ('approved','paid')`, and these are the stages
 * that sit behind those two statuses. Sending a cancel for anything earlier
 * comes back a 404 with nothing changed on either side.
 */
const CANCELLABLE_STAGES: readonly LegacyStage[] = [
  LEGACY_STAGE.APPROVED,
  LEGACY_STAGE.PAYMENT_RECEIVED,
  LEGACY_STAGE.CERTIFICATE_ISSUED,
  LEGACY_STAGE.DISPATCH_PENDING,
  LEGACY_STAGE.DISPATCHED,
  LEGACY_STAGE.DELIVERED,
];

/** Stages where the application is live but undecided — a close reads as a reject. */
const REJECTABLE_STAGES: readonly LegacyStage[] = [
  LEGACY_STAGE.SUBMITTED,
  LEGACY_STAGE.UNDER_REVIEW,
  LEGACY_STAGE.VALIDATED,
];

/**
 * The website action that expresses a CRM status change, if any.
 *
 * Closing and rejecting are the same gesture on this side — a record that will
 * not go any further — but the website distinguishes them by *when*: `cancel`
 * unwinds something already approved or paid, unpublishing the awardee page and
 * the public record; `reject` ends an application still under evaluation. The
 * stage the website last reported is what decides which one it will accept.
 *
 * `null` means there is nothing to say over there:
 *
 *  • A draft, because the applicant never submitted it. Closing an abandoned
 *    lead here must not email them a rejection for something they did not send.
 *  • Already rejected or cancelled on the website, which is where this is
 *    trying to get it to.
 */
export function legacyActionForStatusChange(
  to: RecordStatus,
  stage: LegacyStage | null,
): LegacyApplicationAction | null {
  if (!stage) return null;
  if (stage === LEGACY_STAGE.REJECTED || stage === LEGACY_STAGE.CANCELLED) return null;
  if (stage === LEGACY_STAGE.DRAFT) return null;

  if (to === RECORD_STATUS.CLOSED) {
    if (CANCELLABLE_STAGES.includes(stage)) return LEGACY_APPLICATION_ACTION.CANCEL;
    if (REJECTABLE_STAGES.includes(stage)) return LEGACY_APPLICATION_ACTION.REJECT;
    return null;
  }

  // Reject is accepted from any live stage on the website — its route carries
  // no status guard, because a decision can be taken at any point.
  if (to === RECORD_STATUS.REJECTED) return LEGACY_APPLICATION_ACTION.REJECT;

  return null;
}

/**
 * Running the website's review decisions from here.
 *
 * The CRM is now where applications are evaluated, but the website still owns
 * the applicant relationship: their portal login, the address they applied
 * with, the WhatsApp thread, the invoice templates and the legal archive copy.
 * So a decision taken here is *applied there* — the website updates the
 * application and sends the mail from its own templates, then pushes the
 * resulting snapshot back, and that snapshot is what moves this record.
 *
 * The alternative — writing the status here and mailing from here — would mean
 * two systems with two sets of templates both believing they own the applicant,
 * and an applicant receiving two different letters for one decision.
 *
 * Lives beside the other integration code rather than in `WorkflowService`
 * because it needs `LegacyPushService`, and having the applicants module reach
 * into governance for it would make the two modules mutually dependent.
 */
@Injectable()
export class LegacyActionsService {
  private readonly logger = new Logger(LegacyActionsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly legacyPush: LegacyPushService,
    private readonly timeline: TimelineService,
    private readonly audit: AuditService,
    private readonly cache: CacheService,
  ) {}

  /**
   * What this record offers.
   *
   * A record created in the CRM has no `legacy_mirror` row, so there is nothing
   * on the website to decide about and the list comes back empty — the UI shows
   * nothing rather than buttons that would fail on click.
   */
  async available(recordId: string): Promise<LegacyActionAvailability> {
    const record = await this.loadRecord(recordId);

    const [mirror] = await this.db
      .select({
        externalId: schema.legacyMirror.externalId,
        legacyUrl: schema.legacyMirror.legacyUrl,
        legacyAppCode: schema.legacyMirror.legacyAppCode,
        awardTitle: schema.legacyMirror.awardTitle,
        awardCategory: schema.legacyMirror.awardCategory,
      })
      .from(schema.legacyMirror)
      .where(eq(schema.legacyMirror.recordId, recordId))
      .limit(1);

    if (!mirror) {
      return {
        mirrored: false,
        externalId: null,
        externalUrl: null,
        appCode: null,
        awardTitle: null,
        awardCategory: null,
        actions: [],
      };
    }

    return {
      mirrored: true,
      externalId: mirror.externalId,
      externalUrl: mirror.legacyUrl ?? null,
      appCode: mirror.legacyAppCode ?? null,
      awardTitle: mirror.awardTitle ?? null,
      awardCategory: mirror.awardCategory ?? null,
      actions: legacyActionsFor(record.status as RecordStatus),
    };
  }

  /**
   * Send a decision to the website and wait for its answer.
   *
   * Nothing about the record is written here. The returning snapshot moves it,
   * and a local write would race that snapshot — leaving the two systems
   * disagreeing about a decision the applicant has already been told about.
   *
   * The timeline entry is the exception: it records that an operator *here*
   * asked for this, which the returning snapshot cannot say.
   */
  async run(
    recordId: string,
    input: LegacyApplicationActionInput,
  ): Promise<{ ok: true; action: LegacyApplicationAction }> {
    const record = await this.loadRecord(recordId);
    const availability = await this.available(recordId);

    if (!availability.mirrored) {
      throw new ValidationError({
        action: ['This record was created in the CRM and does not exist on the website.'],
      });
    }

    if (!availability.actions.includes(input.action)) {
      throw new ValidationError({
        action: [
          `${LEGACY_APPLICATION_ACTION_META[input.action].label} is not available while this record is ${record.status.replace(/_/g, ' ')}.`,
        ],
      });
    }

    this.assertRequiredFieldPresent(input);

    const result = await this.legacyPush.pushApplicationAction(recordId, {
      action: input.action,
      note: input.note,
      message: input.message,
      reason: input.reason,
      deadlineHours: input.deadlineHours,
    });

    if (!result.ok) {
      // Surfaced, never swallowed. The applicant was not written to, and an
      // operator shown a success would have no way to discover that.
      throw new ValidationError({
        action: [
          result.skipped
            ? `Not sent — ${result.reason ?? 'the website integration is unavailable'}.`
            : `The website refused this action: ${result.reason ?? 'no reason given'}`,
        ],
      });
    }

    const actor = requireActor();
    const meta = LEGACY_APPLICATION_ACTION_META[input.action];

    await this.timeline.write({
      applicantId: record.applicantId,
      recordId,
      eventType: TIMELINE_EVENT.STATUS_CHANGED,
      summary: `${meta.label} — sent to the NBR website, which has written to the applicant`,
      meta: {
        action: input.action,
        note: input.note ?? null,
        message: input.message ?? null,
        reason: input.reason ?? null,
      },
    });

    await this.audit.record({
      action: AUDIT.STATUS_CHANGED,
      entityType: 'record',
      entityId: recordId,
      entityLabel: `${record.recordCode} — website ${input.action}`,
      meta: { action: input.action, actorUserId: actor.userId },
    });

    await this.cache.invalidateTags(
      CacheTag.record(recordId),
      CacheTag.applicant(record.applicantId),
      CacheTag.applicantList(),
    );

    return { ok: true, action: input.action };
  }

  /**
   * ── Mirror an ordinary status change ─────────────────────────────────────
   *
   * The Website Review panel was the only path that reached the website. But
   * closing or rejecting a record is something operators do from the Change
   * Status modal, because that is where every other transition lives — and
   * those writes stayed local. The result was a record shown as Closed here and
   * still sitting in the website's approved queue, with the applicant never
   * told and the awardee page still public.
   *
   * Fire-and-forget, and deliberately so. The transition has already been
   * committed and answered; a website that is offline must not roll it back.
   * Where a push does fail it lands on the mirror row and surfaces on the
   * integrations screen, which is the same treatment every other mirrored
   * change gets.
   *
   * Called after the transaction commits, never inside it — a fetch held open
   * inside a database transaction is how connection pools get exhausted.
   */
  mirrorStatusChange(input: {
    recordId: string;
    applicantId: string;
    from: RecordStatus;
    to: RecordStatus;
    remark?: string | null;
    overrideReason?: string | null;
  }): void {
    setImmediate(() => {
      void this.sendStatusChange(input).catch((error: unknown) => {
        this.logger.error(
          `Mirroring ${input.from} → ${input.to} threw: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    });
  }

  /** The awaited body of `mirrorStatusChange`. */
  async sendStatusChange(input: {
    recordId: string;
    applicantId: string;
    from: RecordStatus;
    to: RecordStatus;
    remark?: string | null;
    overrideReason?: string | null;
  }): Promise<void> {
    const [mirror] = await this.db
      .select({
        externalId: schema.legacyMirror.externalId,
        legacyStage: schema.legacyMirror.legacyStage,
      })
      .from(schema.legacyMirror)
      .where(eq(schema.legacyMirror.recordId, input.recordId))
      .limit(1);

    // Created in the CRM — there is nothing on the website to move.
    if (!mirror) return;

    const stage = (mirror.legacyStage as LegacyStage | null) ?? null;
    const reopening =
      (input.from === RECORD_STATUS.REJECTED || input.from === RECORD_STATUS.CLOSED) &&
      input.to !== RECORD_STATUS.REJECTED &&
      input.to !== RECORD_STATUS.CLOSED;

    // Reopening is only meaningful if the website actually has it closed; its
    // own route accepts nothing else.
    const action = reopening
      ? stage === LEGACY_STAGE.REJECTED || stage === LEGACY_STAGE.CANCELLED
        ? LEGACY_APPLICATION_ACTION.REOPEN
        : null
      : legacyActionForStatusChange(input.to, stage);

    if (!action) return;

    // The website requires the free text for all three of these, and shows it
    // to the applicant. The remark the operator typed into the modal is exactly
    // that text — every transition to Closed or Rejected demands one.
    const text =
      input.remark?.trim() ||
      input.overrideReason?.trim() ||
      `Status changed to ${input.to.replace(/_/g, ' ')} in the NBR CRM.`;

    const meta = LEGACY_APPLICATION_ACTION_META[action];

    const result = await this.legacyPush.pushApplicationAction(input.recordId, {
      action,
      // Which field carries the text differs per action on the website's side,
      // so it is read from the same metadata the manual panel uses rather than
      // hardcoded here and left to drift.
      ...(meta.field === 'reason' ? { reason: text } : {}),
      ...(meta.field === 'message' ? { message: text } : {}),
      ...(meta.field === 'note' || !meta.field ? { note: text } : {}),
    });

    await this.timeline.write({
      applicantId: input.applicantId,
      recordId: input.recordId,
      eventType: TIMELINE_EVENT.STATUS_CHANGED,
      summary: result.ok
        ? `${meta.label} sent to the NBR website, which has written to the applicant`
        : `Could not mirror this to the NBR website — ${result.reason ?? 'no reason given'}`,
      meta: {
        action,
        mirrored: result.ok,
        legacyStage: stage,
        externalId: mirror.externalId,
        reason: result.ok ? null : (result.reason ?? null),
      },
    });

    if (!result.ok && !result.skipped) {
      this.logger.error(
        `Status change ${input.from} → ${input.to} not mirrored for ${mirror.externalId}: ${result.reason}`,
      );
    }
  }

  /**
   * The website rejects a missing reason with a 400 that reaches the operator
   * as a bare "action failed". Catching it here names the field instead.
   */
  private assertRequiredFieldPresent(input: LegacyApplicationActionInput): void {
    const meta = LEGACY_APPLICATION_ACTION_META[input.action];
    if (!meta.required || !meta.field) return;

    const value = input[meta.field];
    if (!value || value.trim().length === 0) {
      throw new ValidationError({
        [meta.field]: [`${meta.label} needs this — the applicant is told what you write.`],
      });
    }
  }

  private async loadRecord(recordId: string) {
    const [record] = await this.db
      .select({
        id: schema.records.id,
        recordCode: schema.records.recordCode,
        applicantId: schema.records.applicantId,
        status: schema.records.status,
      })
      .from(schema.records)
      .where(and(eq(schema.records.id, recordId), isNull(schema.records.deletedAt)))
      .limit(1);

    if (!record) throw new NotFoundError('Record');
    return record;
  }
}
