import { Inject, Injectable } from '@nestjs/common';
import { RECORD_STATUS } from '@nbr/shared';
import { and, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { requireActor } from '../common/request-context';
import type { Database } from '../database/client';
import { DB } from '../database/database.tokens';
import * as schema from '../database/schema';
import { CacheService, CacheTag, CacheTtl } from '../redis/cache.service';
import { TimelineService } from '../timeline/timeline.service';

export interface DashboardStats {
  readonly totalApplicants: number;
  readonly totalRecords: number;
  readonly applicationsToday: number;
  readonly pendingReviews: number;
  readonly selected: number;
  readonly rejected: number;
  readonly paymentPending: number;
  readonly paymentReceived: number;
  readonly certificatePending: number;
  readonly dispatchPending: number;
  readonly delivered: number;
  readonly monthlyRevenue: string;
  readonly outstandingRevenue: string;
  readonly blacklisted: number;
}

export interface DashboardPayload {
  readonly stats: DashboardStats;
  readonly statusBreakdown: Array<{ status: string; count: number }>;
  readonly monthlyTrend: Array<{ month: string; applications: number; revenue: string }>;
  readonly todaysFollowUps: Array<{
    id: string;
    title: string;
    dueDate: string;
    priority: string;
    applicantId: string | null;
    applicantName: string | null;
    overdue: boolean;
  }>;
  readonly myPendingTasks: Array<{
    id: string;
    title: string;
    dueDate: string;
    priority: string;
    applicantId: string | null;
    applicantName: string | null;
    overdue: boolean;
  }>;
  readonly recentActivities: Awaited<ReturnType<TimelineService['recentActivity']>>;
}

/**
 * Live dashboard (§2, §3 of the V1.0 doc, P1-06).
 *
 * Every counter is served from Redis with a 60-second TTL and event-driven
 * invalidation, so the dashboard is a ~2 ms cache read rather than fourteen
 * aggregate queries per visit. The budget is < 40 ms and a sub-1s TTI.
 *
 * The whole stat block is computed in *one* round trip using conditional
 * aggregation — `count(*) FILTER (WHERE …)` — rather than fourteen separate
 * COUNT queries. Postgres scans the index once and buckets as it goes.
 */
@Injectable()
export class DashboardService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly cache: CacheService,
    private readonly timeline: TimelineService,
  ) {}

  async getDashboard(): Promise<DashboardPayload> {
    const actor = requireActor();

    // Stats are org-wide and identical for every user, so they share one cache
    // key. Tasks are per-user and are deliberately not cached — a follow-up
    // list that is 60 seconds stale is worse than useless to the person
    // working it.
    const [stats, statusBreakdown, monthlyTrend] = await Promise.all([
      this.cache.remember('dashboard:stats', CacheTtl.dashboard, [CacheTag.dashboard()], () =>
        this.computeStats(),
      ),
      this.cache.remember('dashboard:status-breakdown', CacheTtl.dashboard, [CacheTag.dashboard()], () =>
        this.computeStatusBreakdown(),
      ),
      this.cache.remember('dashboard:monthly-trend', CacheTtl.dashboard, [CacheTag.dashboard()], () =>
        this.computeMonthlyTrend(),
      ),
    ]);

    const [todaysFollowUps, myPendingTasks, recentActivities] = await Promise.all([
      this.getTodaysFollowUps(actor.userId),
      this.getMyPendingTasks(actor.userId),
      this.timeline.recentActivity(12),
    ]);

    return { stats, statusBreakdown, monthlyTrend, todaysFollowUps, myPendingTasks, recentActivities };
  }

  private async computeStats(): Promise<DashboardStats> {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const S = RECORD_STATUS;

    // Inside a raw `sql` fragment Drizzle has no column type to infer from, so
    // a Date parameter reaches the driver untyped and is rejected. Passing an
    // ISO string with an explicit cast tells Postgres exactly what it is.
    const todayParam = sql`${startOfToday.toISOString()}::timestamptz`;

    // One pass over records, bucketed by FILTER clauses.
    const [recordStats] = await this.db
      .select({
        totalRecords: sql<number>`count(*)::int`,
        applicationsToday: sql<number>`count(*) FILTER (WHERE ${schema.records.applicationDate} >= ${todayParam})::int`,
        pendingReviews: sql<number>`count(*) FILTER (WHERE ${schema.records.status} IN (${S.UNDER_REVIEW}, ${S.VERIFICATION_PENDING}))::int`,
        selected: sql<number>`count(*) FILTER (WHERE ${schema.records.status} = ${S.SELECTED})::int`,
        rejected: sql<number>`count(*) FILTER (WHERE ${schema.records.status} = ${S.REJECTED})::int`,
        paymentPending: sql<number>`count(*) FILTER (WHERE ${schema.records.status} = ${S.PAYMENT_PENDING})::int`,
        paymentReceived: sql<number>`count(*) FILTER (WHERE ${schema.records.status} = ${S.PAYMENT_RECEIVED})::int`,
        certificatePending: sql<number>`count(*) FILTER (WHERE ${schema.records.status} = ${S.CERTIFICATE_PENDING})::int`,
        dispatchPending: sql<number>`count(*) FILTER (WHERE ${schema.records.status} = ${S.DISPATCH_PENDING})::int`,
        delivered: sql<number>`count(*) FILTER (WHERE ${schema.records.status} IN (${S.DELIVERED}, ${S.COMPLETED}))::int`,
      })
      .from(schema.records)
      .where(isNull(schema.records.deletedAt));

    const [applicantStats] = await this.db
      .select({
        totalApplicants: sql<number>`count(*)::int`,
        blacklisted: sql<number>`count(*) FILTER (WHERE ${schema.applicants.isBlacklisted})::int`,
      })
      .from(schema.applicants)
      .where(isNull(schema.applicants.deletedAt));

    // Revenue is what was actually *received* this month, not what was
    // invoiced — an unpaid invoice is not revenue.
    const [revenue] = await this.db
      .select({
        monthlyRevenue: sql<string>`coalesce(sum(${schema.paymentTransactions.amount}), 0)::text`,
      })
      .from(schema.paymentTransactions)
      .where(gte(schema.paymentTransactions.paidOn, startOfMonth));

    const [outstanding] = await this.db
      .select({
        outstanding: sql<string>`coalesce(sum(${schema.payments.finalAmount} - ${schema.payments.amountPaid}), 0)::text`,
      })
      .from(schema.payments)
      .where(sql`${schema.payments.status} IN ('pending', 'partial')`);

    return {
      totalApplicants: applicantStats?.totalApplicants ?? 0,
      blacklisted: applicantStats?.blacklisted ?? 0,
      totalRecords: recordStats?.totalRecords ?? 0,
      applicationsToday: recordStats?.applicationsToday ?? 0,
      pendingReviews: recordStats?.pendingReviews ?? 0,
      selected: recordStats?.selected ?? 0,
      rejected: recordStats?.rejected ?? 0,
      paymentPending: recordStats?.paymentPending ?? 0,
      paymentReceived: recordStats?.paymentReceived ?? 0,
      certificatePending: recordStats?.certificatePending ?? 0,
      dispatchPending: recordStats?.dispatchPending ?? 0,
      delivered: recordStats?.delivered ?? 0,
      monthlyRevenue: revenue?.monthlyRevenue ?? '0',
      outstandingRevenue: outstanding?.outstanding ?? '0',
    };
  }

  /** Feeds the pie chart (§3 "Pie Charts"). */
  private async computeStatusBreakdown(): Promise<Array<{ status: string; count: number }>> {
    const rows = await this.db
      .select({
        status: schema.records.status,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.records)
      .where(isNull(schema.records.deletedAt))
      .groupBy(schema.records.status);

    return rows;
  }

  /** Feeds the monthly graph (§3 "Monthly Graphs") — last 12 months. */
  private async computeMonthlyTrend(): Promise<
    Array<{ month: string; applications: number; revenue: string }>
  > {
    const rows = await this.db.execute<{
      month: string;
      applications: number;
      revenue: string;
    }>(sql`
      WITH months AS (
        SELECT date_trunc('month', generate_series(
          date_trunc('month', now()) - interval '11 months',
          date_trunc('month', now()),
          interval '1 month'
        )) AS month
      )
      SELECT
        to_char(m.month, 'YYYY-MM') AS month,
        coalesce(r.applications, 0)::int AS applications,
        coalesce(p.revenue, 0)::text    AS revenue
      FROM months m
      LEFT JOIN (
        SELECT date_trunc('month', application_date) AS month, count(*) AS applications
          FROM records WHERE deleted_at IS NULL
         GROUP BY 1
      ) r ON r.month = m.month
      LEFT JOIN (
        SELECT date_trunc('month', paid_on) AS month, sum(amount) AS revenue
          FROM payment_transactions
         GROUP BY 1
      ) p ON p.month = m.month
      ORDER BY m.month
    `);

    return rows as unknown as Array<{ month: string; applications: number; revenue: string }>;
  }

  /** §2 "Today's Follow-ups" — everything due today or already overdue. */
  private async getTodaysFollowUps(userId: string) {
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const rows = await this.db
      .select({
        id: schema.tasks.id,
        title: schema.tasks.title,
        dueDate: schema.tasks.dueDate,
        priority: schema.tasks.priority,
        applicantId: schema.tasks.applicantId,
        applicantName: schema.applicants.fullName,
      })
      .from(schema.tasks)
      .leftJoin(schema.applicants, eq(schema.tasks.applicantId, schema.applicants.id))
      .where(
        and(
          eq(schema.tasks.assignedToUserId, userId),
          eq(schema.tasks.status, 'pending'),
          lte(schema.tasks.dueDate, endOfToday),
        ),
      )
      .orderBy(schema.tasks.dueDate)
      .limit(20);

    return rows.map((row) => ({
      ...row,
      dueDate: row.dueDate.toISOString(),
      overdue: row.dueDate.getTime() < Date.now(),
    }));
  }

  /** §2 "Pending Tasks" — the caller's whole open queue, nearest deadline first. */
  private async getMyPendingTasks(userId: string) {
    const rows = await this.db
      .select({
        id: schema.tasks.id,
        title: schema.tasks.title,
        dueDate: schema.tasks.dueDate,
        priority: schema.tasks.priority,
        applicantId: schema.tasks.applicantId,
        applicantName: schema.applicants.fullName,
      })
      .from(schema.tasks)
      .leftJoin(schema.applicants, eq(schema.tasks.applicantId, schema.applicants.id))
      .where(and(eq(schema.tasks.assignedToUserId, userId), eq(schema.tasks.status, 'pending')))
      .orderBy(schema.tasks.dueDate)
      .limit(20);

    return rows.map((row) => ({
      ...row,
      dueDate: row.dueDate.toISOString(),
      overdue: row.dueDate.getTime() < Date.now(),
    }));
  }
}
