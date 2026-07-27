import { Inject, Injectable } from '@nestjs/common';
import {
  findTransition,
  isTerminalStatus,
  stageActions,
  STATUS_META,
  TIMELINE_EVENT,
  allowedTransitions,
  type RecordStatus,
  type StageAction,
  type TransitionGuard,
} from '@nbr/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { AUDIT, AuditService } from '../audit/audit.service';
import {
  ForbiddenError,
  GuardNotSatisfiedError,
  InvalidTransitionError,
  NotFoundError,
  StaleWriteError,
  WorkflowLockedError,
} from '../common/errors';
import { requireActor, type Actor } from '../common/request-context';
import type { Database } from '../database/client';
import { DB } from '../database/database.tokens';
import * as schema from '../database/schema';
import { CacheService, CacheTag } from '../redis/cache.service';
import { TimelineService } from '../timeline/timeline.service';

export interface ChangeStatusInput {
  readonly toStatus: RecordStatus;
  readonly remark?: string | undefined;
  readonly override?: boolean;
  readonly overrideReason?: string | undefined;
  readonly expectedUpdatedAt?: Date | undefined;
}

export interface AvailableTransition {
  readonly to: RecordStatus;
  readonly label: string;
  readonly requiresRemark: boolean;
  readonly requiresOverride: boolean;
  /** False when a guard is unmet — the UI shows it disabled with the reason. */
  readonly available: boolean;
  readonly blockedReason?: string;
}

export interface SmartActionPanel {
  readonly status: RecordStatus;
  readonly statusLabel: string;
  readonly locked: boolean;
  readonly actions: readonly StageAction[];
  readonly transitions: readonly AvailableTransition[];
  /** §11 stage 5 context: due date, days remaining, reminder counter. */
  readonly paymentContext?: {
    readonly dueDate: string | null;
    readonly daysRemaining: number | null;
    readonly balanceDue: string;
    readonly reminderCount: number;
    readonly overdue: boolean;
  };
}

/**
 * The workflow state machine and Smart Workflow Engine (§6, §11).
 *
 * Two responsibilities:
 *
 *  1. **Enforce legal transitions.** The compiled state machine in @nbr/shared
 *     is the authority. A transition not declared there is rejected with 422
 *     regardless of what the client sent — the UI's dropdown is a convenience,
 *     never the guard.
 *
 *  2. **Guide the next step.** For the current status, compute the contextual
 *     actions an employee should take, filtered by their permissions and by
 *     live record data. This is the "system should not only store data, but
 *     also guide employees" requirement, computed server-side so every client
 *     agrees on what comes next.
 */
@Injectable()
export class WorkflowService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly timeline: TimelineService,
    private readonly audit: AuditService,
    private readonly cache: CacheService,
  ) {}

  async changeStatus(recordId: string, input: ChangeStatusInput): Promise<{ status: RecordStatus }> {
    const actor = requireActor();

    const record = await this.loadRecord(recordId);
    const from = record.status as RecordStatus;
    const to = input.toStatus;

    if (from === to) {
      throw new InvalidTransitionError(from, to, 'The record is already at this status.');
    }

    // Optimistic lock (§6 Concurrency) — stops two staff double-transitioning.
    if (
      input.expectedUpdatedAt &&
      record.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()
    ) {
      throw new StaleWriteError('record');
    }

    // A completed record is locked. Reopening is an Admin override, audited.
    if (record.lockedAt && !input.override) throw new WorkflowLockedError();

    const transition = findTransition(from, to);
    if (!transition) {
      const legal = allowedTransitions(from)
        .map((t) => STATUS_META[t.to].label)
        .join(', ');
      throw new InvalidTransitionError(
        STATUS_META[from].label,
        STATUS_META[to].label,
        legal
          ? `From ${STATUS_META[from].label}, a record can only move to: ${legal}.`
          : `${STATUS_META[from].label} is a final status.`,
      );
    }

    if (!actor.isSuperAdmin && !actor.permissions.has(transition.permission)) {
      throw new ForbiddenError(
        `You do not have permission to move a record to ${STATUS_META[to].label}.`,
        { required: transition.permission },
      );
    }

    if (transition.requiresRemark && !input.remark?.trim()) {
      throw new GuardNotSatisfiedError(
        'remark_required',
        `Moving to ${STATUS_META[to].label} needs a remark explaining why — it goes on the permanent timeline.`,
      );
    }

    if (transition.requiresOverride) {
      const canOverride = actor.isSuperAdmin || actor.permissions.has('records:override');
      if (!canOverride) {
        throw new ForbiddenError('Only an Admin can reopen a locked or rejected record.');
      }
      if (!input.overrideReason?.trim()) {
        throw new GuardNotSatisfiedError(
          'override_reason_required',
          'An override needs a written reason.',
        );
      }
    }

    // Data guards — e.g. "cannot mark payment received while a balance stands".
    for (const guard of transition.guards ?? []) {
      const failure = await this.checkGuard(guard, recordId, record.applicantId);
      if (failure) throw new GuardNotSatisfiedError(guard, failure);
    }

    const nowTerminal = isTerminalStatus(to);

    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.records)
        .set({
          status: to,
          lockedAt: nowTerminal ? new Date() : null,
          ...(to === 'selected' ? { selectionDate: new Date(), reviewedByUserId: actor.userId } : {}),
          ...(to === 'rejected' ? { rejectionReason: input.remark ?? null } : {}),
        })
        .where(eq(schema.records.id, recordId));

      await this.timeline.write(
        {
          applicantId: record.applicantId,
          recordId,
          eventType: TIMELINE_EVENT.STATUS_CHANGED,
          summary: `Status changed: ${STATUS_META[from].label} → ${STATUS_META[to].label}`,
          meta: {
            from,
            to,
            remark: input.remark ?? null,
            override: Boolean(input.override),
            overrideReason: input.overrideReason ?? null,
          },
        },
        tx,
      );

      await this.audit.record(
        {
          action: input.override ? AUDIT.STATUS_OVERRIDE : AUDIT.STATUS_CHANGED,
          entityType: 'record',
          entityId: recordId,
          entityLabel: record.recordCode,
          changes: { status: { from, to } },
          meta: { remark: input.remark ?? null, overrideReason: input.overrideReason ?? null },
        },
        tx,
      );
    });

    await this.cache.invalidateTags(
      CacheTag.record(recordId),
      CacheTag.applicant(record.applicantId),
      CacheTag.applicantList(),
      CacheTag.dashboard(),
    );

    return { status: to };
  }

  /**
   * GET /records/:id/actions — the Next Steps panel (§11).
   *
   * Filtered three ways before it reaches the client: by the caller's
   * permissions, by the DO_NOT_CONTACT flag (which hides every outreach
   * action), and by whether each transition's data guards are currently
   * satisfied.
   */
  async getActionPanel(recordId: string): Promise<SmartActionPanel> {
    const actor = requireActor();
    const record = await this.loadRecord(recordId);
    const status = record.status as RecordStatus;

    const doNotContact = await this.hasFlag(record.applicantId, 'do_not_contact');

    const actions = stageActions(status).filter((action) => {
      if (action.suppressedByDoNotContact && doNotContact) return false;
      return actor.isSuperAdmin || actor.permissions.has(action.permission);
    });

    const transitions: AvailableTransition[] = [];
    for (const t of allowedTransitions(status)) {
      const permitted = actor.isSuperAdmin || actor.permissions.has(t.permission);
      if (!permitted) continue;

      let blockedReason: string | undefined;
      for (const guard of t.guards ?? []) {
        const failure = await this.checkGuard(guard, recordId, record.applicantId);
        if (failure) {
          blockedReason = failure;
          break;
        }
      }

      transitions.push({
        to: t.to,
        label: t.label,
        requiresRemark: t.requiresRemark ?? false,
        requiresOverride: t.requiresOverride ?? false,
        available: !blockedReason,
        blockedReason,
      });
    }

    const panel: SmartActionPanel = {
      status,
      statusLabel: STATUS_META[status].label,
      locked: Boolean(record.lockedAt),
      actions,
      transitions,
    };

    // §11 stage 5 shows due date, days remaining and the reminder counter.
    if (status === 'payment_pending' || status === 'selected') {
      const context = await this.paymentContext(recordId);
      if (context) return { ...panel, paymentContext: context };
    }

    return panel;
  }

  private async paymentContext(recordId: string): Promise<SmartActionPanel['paymentContext']> {
    const [payment] = await this.db
      .select({
        dueDate: schema.payments.dueDate,
        finalAmount: schema.payments.finalAmount,
        amountPaid: schema.payments.amountPaid,
        reminderCount: schema.payments.reminderCount,
      })
      .from(schema.payments)
      .where(eq(schema.payments.recordId, recordId))
      .limit(1);

    if (!payment) return undefined;

    const daysRemaining = payment.dueDate
      ? Math.ceil((payment.dueDate.getTime() - Date.now()) / 86_400_000)
      : null;

    const balancePaise =
      Math.round(Number(payment.finalAmount) * 100) - Math.round(Number(payment.amountPaid) * 100);

    return {
      dueDate: payment.dueDate?.toISOString() ?? null,
      daysRemaining,
      balanceDue: (Math.max(balancePaise, 0) / 100).toFixed(2),
      reminderCount: payment.reminderCount,
      overdue: daysRemaining !== null && daysRemaining < 0 && balancePaise > 0,
    };
  }

  /**
   * Evaluate a transition guard against live data.
   * Returns null when satisfied, or a user-facing explanation when not.
   */
  private async checkGuard(
    guard: TransitionGuard,
    recordId: string,
    applicantId: string,
  ): Promise<string | null> {
    switch (guard) {
      case 'has_evidence': {
        const [row] = await this.db
          .select({ count: sql<number>`count(*)::int` })
          .from(schema.evidenceFiles)
          .where(eq(schema.evidenceFiles.recordId, recordId));
        return (row?.count ?? 0) > 0
          ? null
          : 'Upload at least one piece of evidence before approving this record.';
      }

      case 'has_payment_plan': {
        const [row] = await this.db
          .select({ id: schema.payments.id })
          .from(schema.payments)
          .where(eq(schema.payments.recordId, recordId))
          .limit(1);
        return row ? null : 'Set the package and amount before raising payment.';
      }

      case 'payment_settled': {
        const [row] = await this.db
          .select({
            finalAmount: schema.payments.finalAmount,
            amountPaid: schema.payments.amountPaid,
          })
          .from(schema.payments)
          .where(eq(schema.payments.recordId, recordId))
          .limit(1);
        if (!row) return 'No payment has been raised for this record.';
        const balance =
          Math.round(Number(row.finalAmount) * 100) - Math.round(Number(row.amountPaid) * 100);
        return balance <= 0
          ? null
          : `₹${(balance / 100).toFixed(2)} is still outstanding. Record the balance first.`;
      }

      case 'has_certificate': {
        const [row] = await this.db
          .select({ id: schema.certificates.id })
          .from(schema.certificates)
          .where(eq(schema.certificates.recordId, recordId))
          .limit(1);
        return row ? null : 'Upload the certificate before moving to this stage.';
      }

      case 'has_dispatch': {
        const [row] = await this.db
          .select({ trackingNumber: schema.dispatches.trackingNumber })
          .from(schema.dispatches)
          .where(and(eq(schema.dispatches.recordId, recordId), eq(schema.dispatches.isCurrent, true)))
          .limit(1);
        return row?.trackingNumber
          ? null
          : 'Add the courier and tracking number before marking this dispatched.';
      }

      case 'not_blacklisted': {
        const [row] = await this.db
          .select({ isBlacklisted: schema.applicants.isBlacklisted })
          .from(schema.applicants)
          .where(eq(schema.applicants.id, applicantId))
          .limit(1);
        return row?.isBlacklisted
          ? 'This applicant is blacklisted. An Admin must lift or override the blacklist first.'
          : null;
      }

      default:
        return null;
    }
  }

  private async hasFlag(applicantId: string, flag: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: schema.applicantFlags.id })
      .from(schema.applicantFlags)
      .where(
        and(
          eq(schema.applicantFlags.applicantId, applicantId),
          eq(schema.applicantFlags.flag, flag),
          isNull(schema.applicantFlags.removedAt),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  private async loadRecord(recordId: string) {
    const [record] = await this.db
      .select({
        id: schema.records.id,
        recordCode: schema.records.recordCode,
        applicantId: schema.records.applicantId,
        status: schema.records.status,
        lockedAt: schema.records.lockedAt,
        updatedAt: schema.records.updatedAt,
      })
      .from(schema.records)
      .where(and(eq(schema.records.id, recordId), isNull(schema.records.deletedAt)))
      .limit(1);

    if (!record) throw new NotFoundError('Record');
    return record;
  }

  /** Used by the Change Status modal to populate its dropdown (M-01). */
  getAllowedTransitions(from: RecordStatus, actor: Actor): AvailableTransition[] {
    return allowedTransitions(from)
      .filter((t) => actor.isSuperAdmin || actor.permissions.has(t.permission))
      .map((t) => ({
        to: t.to,
        label: t.label,
        requiresRemark: t.requiresRemark ?? false,
        requiresOverride: t.requiresOverride ?? false,
        available: true,
      }));
  }
}
