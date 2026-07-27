import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RECORD_STATUS } from '@nbr/shared';
import { and, desc, eq, isNull, lte, sql } from 'drizzle-orm';
import { getActor } from '../common/request-context';
import { NotFoundError } from '../common/errors';
import type { Database } from '../database/client';
import { DB } from '../database/database.tokens';
import * as schema from '../database/schema';

export interface NotificationRow {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly body: string | null;
  readonly severity: string;
  readonly link: string | null;
  readonly applicantId: string | null;
  readonly recordId: string | null;
  readonly readAt: string | null;
  readonly createdAt: string;
}

/**
 * Smart notifications (§11, P2-11).
 *
 * Scheduled generators raise alerts for the queues the plan lists: pending
 * reviews, pending payments, pending certificates, pending dispatch, today's
 * follow-ups, assigned tasks and overdue applications.
 *
 * Every generated row carries a `dedupeKey` with a unique index behind it, so
 * a job that runs every hour cannot bury someone under twenty-four copies of
 * "payment overdue". Dismissing an alert frees the key, so it can legitimately
 * re-raise if the condition persists after the user has acknowledged it.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  async list(options: { unreadOnly?: boolean; limit?: number } = {}): Promise<NotificationRow[]> {
    const actor = getActor();
    if (!actor) return [];

    const conditions = [
      // A row with no userId is a broadcast to everyone who can see the module.
      sql`(${schema.notifications.userId} = ${actor.userId} OR ${schema.notifications.userId} IS NULL)`,
      isNull(schema.notifications.dismissedAt),
    ];

    if (options.unreadOnly) conditions.push(isNull(schema.notifications.readAt));

    const rows = await this.db
      .select({
        id: schema.notifications.id,
        kind: schema.notifications.kind,
        title: schema.notifications.title,
        body: schema.notifications.body,
        severity: schema.notifications.severity,
        link: schema.notifications.link,
        applicantId: schema.notifications.applicantId,
        recordId: schema.notifications.recordId,
        readAt: schema.notifications.readAt,
        createdAt: schema.notifications.createdAt,
      })
      .from(schema.notifications)
      .where(and(...conditions))
      .orderBy(desc(schema.notifications.createdAt))
      .limit(options.limit ?? 50);

    return rows.map((row) => ({
      ...row,
      readAt: row.readAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async unreadCount(): Promise<number> {
    const actor = getActor();
    if (!actor) return 0;

    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.notifications)
      .where(
        and(
          sql`(${schema.notifications.userId} = ${actor.userId} OR ${schema.notifications.userId} IS NULL)`,
          isNull(schema.notifications.readAt),
          isNull(schema.notifications.dismissedAt),
        ),
      );

    return row?.count ?? 0;
  }

  async markRead(notificationId: string): Promise<void> {
    const updated = await this.db
      .update(schema.notifications)
      .set({ readAt: new Date() })
      .where(and(eq(schema.notifications.id, notificationId), isNull(schema.notifications.readAt)))
      .returning({ id: schema.notifications.id });

    if (updated.length === 0) throw new NotFoundError('Notification');
  }

  async markAllRead(): Promise<{ count: number }> {
    const actor = getActor();
    if (!actor) return { count: 0 };

    const updated = await this.db
      .update(schema.notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          sql`(${schema.notifications.userId} = ${actor.userId} OR ${schema.notifications.userId} IS NULL)`,
          isNull(schema.notifications.readAt),
        ),
      )
      .returning({ id: schema.notifications.id });

    return { count: updated.length };
  }

  async dismiss(notificationId: string): Promise<void> {
    await this.db
      .update(schema.notifications)
      .set({ dismissedAt: new Date() })
      .where(eq(schema.notifications.id, notificationId));
  }

  /**
   * Raise one notification, ignoring it if the same dedupe key is already live.
   * `onConflictDoNothing` against the partial unique index is what makes the
   * generators safe to run on a tight schedule.
   */
  private async raise(input: {
    userId?: string | null;
    kind: string;
    title: string;
    body?: string;
    severity?: 'info' | 'warning' | 'critical';
    applicantId?: string | null;
    recordId?: string | null;
    link?: string;
    dedupeKey: string;
  }): Promise<void> {
    await this.db
      .insert(schema.notifications)
      .values({
        userId: input.userId ?? null,
        kind: input.kind,
        title: input.title,
        body: input.body ?? null,
        severity: input.severity ?? 'info',
        applicantId: input.applicantId ?? null,
        recordId: input.recordId ?? null,
        link: input.link ?? null,
        dedupeKey: input.dedupeKey,
      })
      .onConflictDoNothing();
  }

  /**
   * Hourly sweep of every queue the plan names.
   *
   * Runs hourly rather than every few minutes because these are day-scale
   * concerns — a payment three days overdue does not become more overdue in
   * ten minutes, and a tighter schedule would only add database load.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async generateQueueAlerts(): Promise<void> {
    try {
      await Promise.all([
        this.alertOverdueReviews(),
        this.alertOverduePayments(),
        this.alertPendingCertificates(),
        this.alertPendingDispatch(),
        this.alertOverdueTasks(),
        this.alertOverdueDsr(),
      ]);
    } catch (error: unknown) {
      // A failing generator must never take the scheduler down with it.
      this.logger.error(
        `Notification generation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** §11 — applications sitting under review past the SLA. */
  private async alertOverdueReviews(): Promise<void> {
    const slaHours = await this.setting('notifications.review_sla_hours', 48);
    const cutoff = new Date(Date.now() - slaHours * 3_600_000);

    const rows = await this.db
      .select({
        id: schema.records.id,
        recordCode: schema.records.recordCode,
        applicantId: schema.records.applicantId,
        applicantName: schema.applicants.fullName,
        assignedToUserId: schema.records.assignedToUserId,
        updatedAt: schema.records.updatedAt,
      })
      .from(schema.records)
      .innerJoin(schema.applicants, eq(schema.records.applicantId, schema.applicants.id))
      .where(
        and(
          isNull(schema.records.deletedAt),
          sql`${schema.records.status} IN (${RECORD_STATUS.UNDER_REVIEW}, ${RECORD_STATUS.VERIFICATION_PENDING})`,
          lte(schema.records.updatedAt, cutoff),
        ),
      )
      .limit(200);

    for (const row of rows) {
      const days = Math.floor((Date.now() - row.updatedAt.getTime()) / 86_400_000);
      await this.raise({
        userId: row.assignedToUserId,
        kind: 'review_overdue',
        severity: 'warning',
        title: `Review overdue — ${row.applicantName}`,
        body: `${row.recordCode} has been awaiting review for ${days} day${days === 1 ? '' : 's'}.`,
        applicantId: row.applicantId,
        recordId: row.id,
        link: `/applicants/${row.applicantId}`,
        // Day-scoped so the alert refreshes once a day rather than hourly.
        dedupeKey: `review_overdue:${row.id}:${new Date().toISOString().slice(0, 10)}`,
      });
    }
  }

  /** §11 stage 5 — payments past their due date. */
  private async alertOverduePayments(): Promise<void> {
    const rows = await this.db
      .select({
        paymentId: schema.payments.id,
        recordId: schema.payments.recordId,
        applicantId: schema.payments.applicantId,
        applicantName: schema.applicants.fullName,
        dueDate: schema.payments.dueDate,
        finalAmount: schema.payments.finalAmount,
        amountPaid: schema.payments.amountPaid,
        assignedToUserId: schema.records.assignedToUserId,
      })
      .from(schema.payments)
      .innerJoin(schema.applicants, eq(schema.payments.applicantId, schema.applicants.id))
      .innerJoin(schema.records, eq(schema.payments.recordId, schema.records.id))
      .where(
        and(
          sql`${schema.payments.status} IN ('pending', 'partial')`,
          sql`${schema.payments.dueDate} IS NOT NULL AND ${schema.payments.dueDate} < now()`,
        ),
      )
      .limit(200);

    for (const row of rows) {
      const balance = (
        (Math.round(Number(row.finalAmount) * 100) - Math.round(Number(row.amountPaid) * 100)) /
        100
      ).toFixed(2);
      const daysOverdue = row.dueDate
        ? Math.floor((Date.now() - row.dueDate.getTime()) / 86_400_000)
        : 0;

      await this.raise({
        userId: row.assignedToUserId,
        kind: 'payment_overdue',
        severity: daysOverdue > 14 ? 'critical' : 'warning',
        title: `Payment overdue — ${row.applicantName}`,
        body: `₹${balance} outstanding, ${daysOverdue} day${daysOverdue === 1 ? '' : 's'} past the due date.`,
        applicantId: row.applicantId,
        recordId: row.recordId,
        link: `/applicants/${row.applicantId}?tab=payment`,
        dedupeKey: `payment_overdue:${row.paymentId}:${new Date().toISOString().slice(0, 10)}`,
      });
    }
  }

  private async alertPendingCertificates(): Promise<void> {
    const slaDays = await this.setting('notifications.certificate_sla_days', 7);
    const cutoff = new Date(Date.now() - slaDays * 86_400_000);

    const rows = await this.db
      .select({
        id: schema.records.id,
        recordCode: schema.records.recordCode,
        applicantId: schema.records.applicantId,
        applicantName: schema.applicants.fullName,
        updatedAt: schema.records.updatedAt,
      })
      .from(schema.records)
      .innerJoin(schema.applicants, eq(schema.records.applicantId, schema.applicants.id))
      .where(
        and(
          isNull(schema.records.deletedAt),
          eq(schema.records.hasCertificate, false),
          sql`${schema.records.status} IN (${RECORD_STATUS.PAYMENT_RECEIVED}, ${RECORD_STATUS.CERTIFICATE_PENDING})`,
          lte(schema.records.updatedAt, cutoff),
        ),
      )
      .limit(200);

    for (const row of rows) {
      await this.raise({
        kind: 'certificate_pending',
        severity: 'warning',
        title: `Certificate pending — ${row.applicantName}`,
        body: `${row.recordCode} has been paid for but has no certificate after ${slaDays} days.`,
        applicantId: row.applicantId,
        recordId: row.id,
        link: `/applicants/${row.applicantId}?tab=certificate`,
        dedupeKey: `certificate_pending:${row.id}:${new Date().toISOString().slice(0, 10)}`,
      });
    }
  }

  private async alertPendingDispatch(): Promise<void> {
    const slaDays = await this.setting('notifications.dispatch_sla_days', 5);
    const cutoff = new Date(Date.now() - slaDays * 86_400_000);

    const rows = await this.db
      .select({
        id: schema.records.id,
        recordCode: schema.records.recordCode,
        applicantId: schema.records.applicantId,
        applicantName: schema.applicants.fullName,
      })
      .from(schema.records)
      .innerJoin(schema.applicants, eq(schema.records.applicantId, schema.applicants.id))
      .where(
        and(
          isNull(schema.records.deletedAt),
          eq(schema.records.status, RECORD_STATUS.DISPATCH_PENDING),
          lte(schema.records.updatedAt, cutoff),
        ),
      )
      .limit(200);

    for (const row of rows) {
      await this.raise({
        kind: 'dispatch_pending',
        severity: 'warning',
        title: `Dispatch pending — ${row.applicantName}`,
        body: `${row.recordCode} has been ready to dispatch for over ${slaDays} days.`,
        applicantId: row.applicantId,
        recordId: row.id,
        link: `/applicants/${row.applicantId}?tab=dispatch`,
        dedupeKey: `dispatch_pending:${row.id}:${new Date().toISOString().slice(0, 10)}`,
      });
    }
  }

  private async alertOverdueTasks(): Promise<void> {
    const rows = await this.db
      .select({
        id: schema.tasks.id,
        title: schema.tasks.title,
        dueDate: schema.tasks.dueDate,
        assignedToUserId: schema.tasks.assignedToUserId,
        applicantId: schema.tasks.applicantId,
        recordId: schema.tasks.recordId,
      })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.status, 'pending'), lte(schema.tasks.dueDate, new Date())))
      .limit(200);

    for (const row of rows) {
      const days = Math.floor((Date.now() - row.dueDate.getTime()) / 86_400_000);
      await this.raise({
        userId: row.assignedToUserId,
        kind: 'task_overdue',
        severity: days > 3 ? 'critical' : 'warning',
        title: `Task overdue — ${row.title}`,
        body: days === 0 ? 'Due today.' : `${days} day${days === 1 ? '' : 's'} overdue.`,
        applicantId: row.applicantId,
        recordId: row.recordId,
        link: row.applicantId ? `/applicants/${row.applicantId}` : '/tasks',
        dedupeKey: `task_overdue:${row.id}:${new Date().toISOString().slice(0, 10)}`,
      });
    }
  }

  /**
   * DPDP §11–§14: a data-principal request approaching its statutory deadline.
   * Missing one is a regulatory failure, not an operational annoyance, so these
   * are always critical.
   */
  private async alertOverdueDsr(): Promise<void> {
    const rows = await this.db
      .select({
        id: schema.dataPrincipalRequests.id,
        referenceCode: schema.dataPrincipalRequests.referenceCode,
        type: schema.dataPrincipalRequests.type,
        dueAt: schema.dataPrincipalRequests.dueAt,
        assignedToUserId: schema.dataPrincipalRequests.assignedToUserId,
      })
      .from(schema.dataPrincipalRequests)
      .where(
        and(
          isNull(schema.dataPrincipalRequests.resolvedAt),
          // Warn three days out, not on the day it expires.
          sql`${schema.dataPrincipalRequests.dueAt} < now() + interval '3 days'`,
        ),
      )
      .limit(100);

    for (const row of rows) {
      const overdue = row.dueAt.getTime() < Date.now();
      const days = Math.abs(Math.ceil((row.dueAt.getTime() - Date.now()) / 86_400_000));

      await this.raise({
        userId: row.assignedToUserId,
        kind: 'dsr_due',
        severity: 'critical',
        title: `${overdue ? 'OVERDUE' : 'Due soon'}: data request ${row.referenceCode}`,
        body: `${row.type.replace(/_/g, ' ')} request — ${overdue ? `${days} days past` : `${days} days until`} the statutory deadline.`,
        link: '/admin/privacy',
        dedupeKey: `dsr_due:${row.id}:${new Date().toISOString().slice(0, 10)}`,
      });
    }
  }

  /** Read an operator-configurable threshold, falling back to a sane default. */
  private async setting(key: string, fallback: number): Promise<number> {
    const [row] = await this.db
      .select({ value: schema.settings.value })
      .from(schema.settings)
      .where(eq(schema.settings.key, key))
      .limit(1);

    const value = Number(row?.value);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }
}
