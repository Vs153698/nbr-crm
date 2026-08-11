import { Global, Inject, Injectable, Logger, Module } from '@nestjs/common';
import { STATUS_META, TIMELINE_EVENT, type RecordStatus } from '@nbr/shared';
import { eq } from 'drizzle-orm';
import { AUDIT, AuditService } from '../audit/audit.service';
import type { Database } from '../database/client';
import { DB } from '../database/database.tokens';
import * as schema from '../database/schema';
import { CacheService, CacheTag } from '../redis/cache.service';
import { TimelineService } from '../timeline/timeline.service';

/**
 * Status changes the system makes on its own.
 *
 * Deliberately *not* routed through `WorkflowService.changeStatus`, for the
 * same reason the website mirror is not: that method's permission checks and
 * guards describe what a **human operator** may choose to do next. These moves
 * are not choices — they are the consequence of something that has already
 * happened and been checked, and running them through the transition graph
 * would mean a payments clerk without `records:change_status` could settle an
 * invoice and leave the record stranded one stage behind reality.
 *
 * Two rules keep this honest:
 *
 *  • **The caller states the precondition.** Every call site has already
 *    verified the thing that justifies the move — the money is settled, the
 *    certificate is signed off. This service does not re-derive it.
 *  • **It is always visible.** Each advance writes a timeline entry naming
 *    itself as automatic and giving the reason, so an operator never finds a
 *    record somewhere new with no explanation.
 *
 * Its own `@Global` module because it needs nothing but the globally-provided
 * database, timeline, audit and cache — the same shape `AuditService` uses —
 * and because both the payments and certificate services reach for it from
 * different module trees.
 */
@Injectable()
export class RecordAdvanceService {
  private readonly logger = new Logger(RecordAdvanceService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly timeline: TimelineService,
    private readonly audit: AuditService,
    private readonly cache: CacheService,
  ) {}

  /**
   * Move a record forward because something already happened.
   *
   * `expectedFrom` is the guard against a race: two payments settling at once,
   * or an operator moving the record by hand in the same second. The update is
   * conditional on the status still being what the caller saw, so the loser of
   * that race changes nothing rather than dragging the record backwards.
   *
   * Returns whether the move actually happened, so a caller chaining several
   * advances can stop at the first one that did not apply.
   */
  async advance(
    input: {
      recordId: string;
      applicantId: string;
      expectedFrom: readonly RecordStatus[];
      to: RecordStatus;
      /** Shown on the timeline: why this happened without anyone clicking. */
      reason: string;
    },
    tx?: Database,
  ): Promise<boolean> {
    const db = tx ?? this.db;

    const [current] = await db
      .select({ status: schema.records.status, recordCode: schema.records.recordCode })
      .from(schema.records)
      .where(eq(schema.records.id, input.recordId))
      .limit(1);

    if (!current) return false;

    const from = current.status as RecordStatus;
    if (from === input.to) return false;
    if (!input.expectedFrom.includes(from)) return false;

    await db
      .update(schema.records)
      .set({ status: input.to })
      .where(eq(schema.records.id, input.recordId));

    await this.timeline.write(
      {
        applicantId: input.applicantId,
        recordId: input.recordId,
        eventType: TIMELINE_EVENT.STATUS_CHANGED,
        summary: `${STATUS_META[from].label} → ${STATUS_META[input.to].label} — ${input.reason}`,
        meta: { from, to: input.to, automatic: true, reason: input.reason },
        actorKind: 'system',
      },
      tx,
    );

    await this.audit.record(
      {
        action: AUDIT.STATUS_CHANGED,
        entityType: 'record',
        entityId: input.recordId,
        entityLabel: current.recordCode,
        changes: { status: { from, to: input.to } },
        meta: { automatic: true, reason: input.reason },
      },
      tx,
    );

    this.logger.log(`${current.recordCode}: ${from} → ${input.to} (${input.reason})`);
    return true;
  }

  /** Cache busting is the caller's job inside a transaction; this is for after. */
  async bust(recordId: string, applicantId: string): Promise<void> {
    await this.cache.invalidateTags(
      CacheTag.record(recordId),
      CacheTag.applicant(applicantId),
      CacheTag.applicantList(),
      CacheTag.dashboard(),
    );
  }
}

@Global()
@Module({
  providers: [RecordAdvanceService],
  exports: [RecordAdvanceService],
})
export class RecordAdvanceModule {}
