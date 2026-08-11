import { Inject, Injectable } from '@nestjs/common';
import { REPORT_TYPE, type ReportType } from '@nbr/shared';
import { sql } from 'drizzle-orm';
import { ValidationError } from '../common/errors';
import type { Database } from '../database/client';
import { DB } from '../database/database.tokens';
import { CacheService, CacheTag } from '../redis/cache.service';

export interface ReportFilters {
  readonly from?: Date;
  readonly to?: Date;
  readonly employeeId?: string;
  readonly categoryId?: string;
  readonly country?: string;
  readonly groupBy?: 'day' | 'week' | 'month' | 'quarter' | 'year';
}

export interface ReportResult {
  readonly type: ReportType;
  readonly columns: ReadonlyArray<{ key: string; label: string; align?: 'right' }>;
  readonly rows: ReadonlyArray<Record<string, unknown>>;
  readonly totals?: Record<string, unknown>;
  readonly generatedAt: string;
}

/**
 * Reports (§24, P2-12).
 *
 * Every query is date-bounded and hits a covering index — an unbounded report
 * over a 100k-row table is how a "quick check" takes the database down at 4pm.
 * The default window is 12 months when the caller supplies none.
 *
 * Results are cached briefly: a report is a snapshot, and five people opening
 * the same revenue view in a morning meeting should cost one query, not five.
 */
@Injectable()
export class ReportsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly cache: CacheService,
  ) {}

  async run(type: ReportType, filters: ReportFilters): Promise<ReportResult> {
    const bounded = this.applyDefaultWindow(filters);
    const key = `report:${type}:${JSON.stringify(bounded)}`;

    const result = await this.cache.remember(key, 120, [CacheTag.reports()], () =>
      this.execute(type, bounded),
    );

    return { ...result, generatedAt: new Date().toISOString() };
  }

  /**
   * An unbounded report is a table scan waiting to happen, so a missing date
   * range becomes "the last 12 months" rather than "everything".
   */
  private applyDefaultWindow(filters: ReportFilters): Required<Pick<ReportFilters, 'from' | 'to'>> &
    ReportFilters {
    const to = filters.to ?? new Date();
    const from = filters.from ?? new Date(to.getTime() - 365 * 86_400_000);

    if (from > to) {
      throw new ValidationError({ from: ['The start date must be before the end date.'] });
    }

    return { ...filters, from, to };
  }

  private async execute(
    type: ReportType,
    filters: ReportFilters & { from: Date; to: Date },
  ): Promise<Omit<ReportResult, 'generatedAt'>> {
    switch (type) {
      case REPORT_TYPE.APPLICATIONS:
        return this.applications(filters);
      case REPORT_TYPE.REVENUE:
        return this.revenue(filters);
      case REPORT_TYPE.PENDING_PAYMENTS:
        return this.pendingPayments(filters);
      case REPORT_TYPE.PENDING_CERTIFICATES:
        return this.pendingCertificates(filters);
      case REPORT_TYPE.PENDING_DISPATCH:
        return this.pendingDispatch(filters);
      case REPORT_TYPE.EMPLOYEE_PERFORMANCE:
        return this.employeePerformance(filters);
      case REPORT_TYPE.CATEGORY_WISE:
        return this.categoryWise(filters);
      case REPORT_TYPE.COUNTRY_WISE:
        return this.countryWise(filters);
      default:
        throw new ValidationError({ type: ['Unknown report type.'] });
    }
  }

  /** Applications received per period, split by outcome. */
  private async applications(filters: ReportFilters & { from: Date; to: Date }) {
    const grain = filters.groupBy ?? 'month';

    const rows = await this.db.execute<Record<string, unknown>>(sql`
      SELECT
        to_char(date_trunc(${grain}, r.application_date), 'YYYY-MM-DD') AS period,
        count(*)::int                                                    AS total,
        count(*) FILTER (WHERE r.status = 'selected')::int               AS selected,
        count(*) FILTER (WHERE r.status = 'rejected')::int               AS rejected,
        count(*) FILTER (WHERE r.status IN ('under_review','verification_pending'))::int AS in_review,
        count(*) FILTER (WHERE r.status IN ('completed','delivered'))::int AS completed
      FROM records r
      LEFT JOIN achievements a ON a.record_id = r.id
      WHERE r.deleted_at IS NULL
        AND r.application_date BETWEEN ${filters.from.toISOString()}::timestamptz
                                   AND ${filters.to.toISOString()}::timestamptz
        ${filters.employeeId ? sql`AND r.assigned_to_user_id = ${filters.employeeId}::uuid` : sql``}
        ${filters.categoryId ? sql`AND a.category_id = ${filters.categoryId}::uuid` : sql``}
      GROUP BY 1
      ORDER BY 1
    `);

    const list = rows as unknown as Array<Record<string, number | string>>;

    return {
      type: REPORT_TYPE.APPLICATIONS as ReportType,
      columns: [
        { key: 'period', label: 'Period' },
        { key: 'total', label: 'Applications', align: 'right' as const },
        { key: 'in_review', label: 'In review', align: 'right' as const },
        { key: 'selected', label: 'Selected', align: 'right' as const },
        { key: 'rejected', label: 'Rejected', align: 'right' as const },
        { key: 'completed', label: 'Completed', align: 'right' as const },
      ],
      rows: list,
      totals: {
        period: 'Total',
        total: sum(list, 'total'),
        in_review: sum(list, 'in_review'),
        selected: sum(list, 'selected'),
        rejected: sum(list, 'rejected'),
        completed: sum(list, 'completed'),
      },
    };
  }

  /**
   * Revenue = money actually received, by the date it was received.
   * Deliberately not "invoiced" — an unpaid invoice is not revenue, and
   * reporting it as such is how a business misreads its own cash position.
   */
  private async revenue(filters: ReportFilters & { from: Date; to: Date }) {
    const grain = filters.groupBy ?? 'month';

    const rows = await this.db.execute<Record<string, unknown>>(sql`
      SELECT
        to_char(date_trunc(${grain}, t.paid_on), 'YYYY-MM-DD') AS period,
        count(DISTINCT t.payment_id)::int                       AS payments,
        sum(t.amount)::text                                     AS received,
        sum(t.amount) FILTER (WHERE t.is_reversal)::text        AS reversed
      FROM payment_transactions t
      WHERE t.paid_on BETWEEN ${filters.from.toISOString()}::timestamptz
                          AND ${filters.to.toISOString()}::timestamptz
      GROUP BY 1
      ORDER BY 1
    `);

    const list = rows as unknown as Array<Record<string, string | number>>;

    return {
      type: REPORT_TYPE.REVENUE as ReportType,
      columns: [
        { key: 'period', label: 'Period' },
        { key: 'payments', label: 'Payments', align: 'right' as const },
        { key: 'reversed', label: 'Reversals (₹)', align: 'right' as const },
        { key: 'received', label: 'Received (₹)', align: 'right' as const },
      ],
      rows: list,
      totals: {
        period: 'Total',
        payments: sum(list, 'payments'),
        received: sumMoney(list, 'received'),
        reversed: sumMoney(list, 'reversed'),
      },
    };
  }

  private async pendingPayments(filters: ReportFilters & { from: Date; to: Date }) {
    const rows = await this.db.execute<Record<string, unknown>>(sql`
      SELECT
        a.applicant_code                                    AS applicant_code,
        a.full_name                                         AS applicant_name,
        r.record_code                                       AS record_code,
        p.package_name                                      AS package,
        p.final_amount::text                                AS total,
        p.amount_paid::text                                 AS paid,
        (p.final_amount - p.amount_paid)::text              AS balance,
        to_char(p.due_date, 'YYYY-MM-DD')                   AS due_date,
        GREATEST(0, EXTRACT(DAY FROM now() - p.due_date))::int AS days_overdue,
        p.reminder_count                                    AS reminders,
        u.full_name                                         AS assigned_to
      FROM payments p
      JOIN applicants a ON a.id = p.applicant_id
      JOIN records    r ON r.id = p.record_id
      LEFT JOIN users u ON u.id = r.assigned_to_user_id
      WHERE p.status IN ('pending','partial')
      ORDER BY p.due_date NULLS LAST
      LIMIT 1000
    `);

    const list = rows as unknown as Array<Record<string, string | number>>;

    return {
      type: REPORT_TYPE.PENDING_PAYMENTS as ReportType,
      columns: [
        { key: 'applicant_code', label: 'Applicant ID' },
        { key: 'applicant_name', label: 'Name' },
        { key: 'record_code', label: 'Record' },
        { key: 'package', label: 'Package' },
        { key: 'total', label: 'Total (₹)', align: 'right' as const },
        { key: 'paid', label: 'Paid (₹)', align: 'right' as const },
        { key: 'balance', label: 'Balance (₹)', align: 'right' as const },
        { key: 'due_date', label: 'Due' },
        { key: 'days_overdue', label: 'Days overdue', align: 'right' as const },
        { key: 'reminders', label: 'Reminders', align: 'right' as const },
        { key: 'assigned_to', label: 'Assigned' },
      ],
      rows: list,
      totals: { applicant_code: `${list.length} records`, balance: sumMoney(list, 'balance') },
    };
  }

  private async pendingCertificates(_filters: ReportFilters & { from: Date; to: Date }) {
    const rows = await this.db.execute<Record<string, unknown>>(sql`
      SELECT
        a.applicant_code AS applicant_code,
        a.full_name      AS applicant_name,
        r.record_code    AS record_code,
        ach.record_title AS record_title,
        r.status         AS status,
        r.payment_status AS payment_status,
        EXTRACT(DAY FROM now() - r.updated_at)::int AS days_waiting
      FROM records r
      JOIN applicants a ON a.id = r.applicant_id
      LEFT JOIN achievements ach ON ach.record_id = r.id
      WHERE r.deleted_at IS NULL
        -- Outstanding means "not signed off", not "no file". A certificate
        -- uploaded and left unchecked is precisely the row this report is for,
        -- and testing has_certificate dropped it the moment anything landed —
        -- including the number the NBR website mints by itself, which is no
        -- file at all.
        AND NOT EXISTS (
          SELECT 1 FROM certificates c
           WHERE c.record_id = r.id
             AND c.verification_status = 'verified'
        )
        AND r.status IN ('payment_received','certificate_pending')
      ORDER BY r.updated_at
      LIMIT 1000
    `);

    const list = rows as unknown as Array<Record<string, string | number>>;

    return {
      type: REPORT_TYPE.PENDING_CERTIFICATES as ReportType,
      columns: [
        { key: 'applicant_code', label: 'Applicant ID' },
        { key: 'applicant_name', label: 'Name' },
        { key: 'record_code', label: 'Record' },
        { key: 'record_title', label: 'Title' },
        { key: 'status', label: 'Status' },
        { key: 'days_waiting', label: 'Days waiting', align: 'right' as const },
      ],
      rows: list,
      totals: { applicant_code: `${list.length} records` },
    };
  }

  private async pendingDispatch(_filters: ReportFilters & { from: Date; to: Date }) {
    const rows = await this.db.execute<Record<string, unknown>>(sql`
      SELECT
        a.applicant_code AS applicant_code,
        a.full_name      AS applicant_name,
        r.record_code    AS record_code,
        concat_ws(', ', a.city, a.state, a.pincode) AS destination,
        r.delivery_status AS delivery_status,
        d.courier_partner AS courier,
        d.tracking_number AS tracking,
        EXTRACT(DAY FROM now() - r.updated_at)::int AS days_waiting
      FROM records r
      JOIN applicants a ON a.id = r.applicant_id
      LEFT JOIN dispatches d ON d.record_id = r.id AND d.is_current = true
      WHERE r.deleted_at IS NULL
        -- Publication follows delivery now, so a record there has shipped and
        -- is not outstanding dispatch work.
        AND r.status IN ('dispatch_pending','certificate_uploaded','dispatched')
        AND r.delivery_status <> 'delivered'
      ORDER BY r.updated_at
      LIMIT 1000
    `);

    const list = rows as unknown as Array<Record<string, string | number>>;

    return {
      type: REPORT_TYPE.PENDING_DISPATCH as ReportType,
      columns: [
        { key: 'applicant_code', label: 'Applicant ID' },
        { key: 'applicant_name', label: 'Name' },
        { key: 'record_code', label: 'Record' },
        { key: 'destination', label: 'Destination' },
        { key: 'delivery_status', label: 'Status' },
        { key: 'courier', label: 'Courier' },
        { key: 'tracking', label: 'Tracking' },
        { key: 'days_waiting', label: 'Days waiting', align: 'right' as const },
      ],
      rows: list,
      totals: { applicant_code: `${list.length} records` },
    };
  }

  /** §24 Employee Performance — throughput, not a ranking. */
  private async employeePerformance(filters: ReportFilters & { from: Date; to: Date }) {
    const rows = await this.db.execute<Record<string, unknown>>(sql`
      SELECT
        u.full_name                                                      AS employee,
        ro.name                                                          AS role,
        count(r.id)::int                                                 AS assigned,
        count(r.id) FILTER (WHERE r.status = 'selected')::int            AS selected,
        count(r.id) FILTER (WHERE r.status = 'rejected')::int            AS rejected,
        count(r.id) FILTER (WHERE r.status IN ('completed','delivered'))::int AS completed,
        count(r.id) FILTER (WHERE r.status IN ('under_review','verification_pending'))::int AS open,
        round(avg(EXTRACT(EPOCH FROM (r.updated_at - r.application_date)) / 86400)
              FILTER (WHERE r.status IN ('completed','delivered')))::int AS avg_days_to_complete
      FROM users u
      JOIN roles ro ON ro.id = u.role_id
      LEFT JOIN records r
             ON r.assigned_to_user_id = u.id
            AND r.deleted_at IS NULL
            AND r.application_date BETWEEN ${filters.from.toISOString()}::timestamptz
                                       AND ${filters.to.toISOString()}::timestamptz
      WHERE u.deleted_at IS NULL AND u.status = 'active'
      GROUP BY u.id, u.full_name, ro.name
      HAVING count(r.id) > 0
      ORDER BY assigned DESC
    `);

    const list = rows as unknown as Array<Record<string, string | number>>;

    return {
      type: REPORT_TYPE.EMPLOYEE_PERFORMANCE as ReportType,
      columns: [
        { key: 'employee', label: 'Employee' },
        { key: 'role', label: 'Role' },
        { key: 'assigned', label: 'Assigned', align: 'right' as const },
        { key: 'open', label: 'Open', align: 'right' as const },
        { key: 'selected', label: 'Selected', align: 'right' as const },
        { key: 'rejected', label: 'Rejected', align: 'right' as const },
        { key: 'completed', label: 'Completed', align: 'right' as const },
        { key: 'avg_days_to_complete', label: 'Avg days', align: 'right' as const },
      ],
      rows: list,
      totals: {
        employee: 'Total',
        assigned: sum(list, 'assigned'),
        completed: sum(list, 'completed'),
      },
    };
  }

  private async categoryWise(filters: ReportFilters & { from: Date; to: Date }) {
    const rows = await this.db.execute<Record<string, unknown>>(sql`
      SELECT
        coalesce(c.name, 'Uncategorised')                     AS category,
        count(r.id)::int                                      AS records,
        count(r.id) FILTER (WHERE r.status = 'selected')::int AS selected,
        count(r.id) FILTER (WHERE r.status IN ('completed','delivered'))::int AS completed,
        coalesce(sum(p.amount_paid), 0)::text                 AS revenue
      FROM records r
      LEFT JOIN achievements a ON a.record_id = r.id
      LEFT JOIN categories   c ON c.id = a.category_id
      LEFT JOIN payments     p ON p.record_id = r.id
      WHERE r.deleted_at IS NULL
        AND r.application_date BETWEEN ${filters.from.toISOString()}::timestamptz
                                   AND ${filters.to.toISOString()}::timestamptz
      GROUP BY 1
      ORDER BY records DESC
    `);

    const list = rows as unknown as Array<Record<string, string | number>>;

    return {
      type: REPORT_TYPE.CATEGORY_WISE as ReportType,
      columns: [
        { key: 'category', label: 'Category' },
        { key: 'records', label: 'Records', align: 'right' as const },
        { key: 'selected', label: 'Selected', align: 'right' as const },
        { key: 'completed', label: 'Completed', align: 'right' as const },
        { key: 'revenue', label: 'Revenue (₹)', align: 'right' as const },
      ],
      rows: list,
      totals: {
        category: 'Total',
        records: sum(list, 'records'),
        revenue: sumMoney(list, 'revenue'),
      },
    };
  }

  private async countryWise(filters: ReportFilters & { from: Date; to: Date }) {
    const rows = await this.db.execute<Record<string, unknown>>(sql`
      SELECT
        coalesce(a.country, 'Unknown') AS country,
        coalesce(a.state, '—')         AS state,
        count(DISTINCT a.id)::int      AS applicants,
        count(r.id)::int               AS records
      FROM applicants a
      LEFT JOIN records r
             ON r.applicant_id = a.id
            AND r.deleted_at IS NULL
            AND r.application_date BETWEEN ${filters.from.toISOString()}::timestamptz
                                       AND ${filters.to.toISOString()}::timestamptz
      WHERE a.deleted_at IS NULL
        ${filters.country ? sql`AND a.country = ${filters.country}` : sql``}
      GROUP BY 1, 2
      ORDER BY applicants DESC
      LIMIT 500
    `);

    const list = rows as unknown as Array<Record<string, string | number>>;

    return {
      type: REPORT_TYPE.COUNTRY_WISE as ReportType,
      columns: [
        { key: 'country', label: 'Country' },
        { key: 'state', label: 'State' },
        { key: 'applicants', label: 'Applicants', align: 'right' as const },
        { key: 'records', label: 'Records', align: 'right' as const },
      ],
      rows: list,
      totals: {
        country: 'Total',
        applicants: sum(list, 'applicants'),
        records: sum(list, 'records'),
      },
    };
  }
}

function sum(rows: ReadonlyArray<Record<string, unknown>>, key: string): number {
  return rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
}

/** Money totals are summed in integer paise, never as floats. */
function sumMoney(rows: ReadonlyArray<Record<string, unknown>>, key: string): string {
  const paise = rows.reduce(
    (total, row) => total + Math.round((Number(row[key]) || 0) * 100),
    0,
  );
  return (paise / 100).toFixed(2);
}
