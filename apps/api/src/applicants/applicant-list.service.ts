import { Inject, Injectable } from '@nestjs/common';
import type { ApplicantListQuery } from '@nbr/shared';
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../database/client';
import { DB } from '../database/database.tokens';
import * as schema from '../database/schema';

export interface ApplicantListRow {
  readonly recordId: string;
  readonly applicantId: string;
  readonly applicantCode: string;
  readonly recordCode: string;
  readonly fullName: string;
  readonly mobile: string;
  readonly city: string | null;
  readonly recordTitle: string | null;
  readonly categoryName: string | null;
  readonly status: string;
  readonly assignedToUserId: string | null;
  readonly assignedToName: string | null;
  readonly paymentStatus: string;
  readonly deliveryStatus: string;
  readonly isBlacklisted: boolean;
  readonly flags: string[];
  readonly updatedAt: string;
}

export interface ApplicantListResult {
  readonly items: ApplicantListRow[];
  readonly nextCursor: string | null;
  readonly total?: number;
}

/**
 * The applicant list (§3, P1-07).
 *
 * One row per *record*, not per applicant — the list's columns (Record Title,
 * Current Status, Payment, Dispatch) are all record-level, and a repeat
 * applicant legitimately appears once per record they hold.
 *
 * Keyset pagination throughout. OFFSET degrades linearly with page depth and
 * skips or repeats rows when data changes mid-scroll; a cursor on
 * `(updated_at, id)` keeps page 500 as fast as page 1 and never drops a row.
 */
@Injectable()
export class ApplicantListService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async list(query: ApplicantListQuery): Promise<ApplicantListResult> {
    const conditions = this.buildFilters(query);

    // Sorting is restricted to an allow-list of indexed columns. Interpolating
    // a client-supplied column name would be an injection vector, and sorting
    // on an unindexed column would silently sequential-scan the table.
    const sortColumn = this.resolveSortColumn(query.sortBy);
    const direction = query.sortDir === 'asc' ? asc : desc;

    const cursorClause = query.cursor
      ? decodeCursor(query.cursor, sortColumn, query.sortDir)
      : undefined;

    if (cursorClause) conditions.push(cursorClause);

    const rows = await this.db
      .select({
        recordId: schema.records.id,
        applicantId: schema.applicants.id,
        applicantCode: schema.applicants.applicantCode,
        recordCode: schema.records.recordCode,
        fullName: schema.applicants.fullName,
        mobile: schema.applicants.mobile,
        city: schema.applicants.city,
        recordTitle: schema.achievements.recordTitle,
        categoryName: schema.categories.name,
        status: schema.records.status,
        assignedToUserId: schema.records.assignedToUserId,
        assignedToName: schema.users.fullName,
        paymentStatus: schema.records.paymentStatus,
        deliveryStatus: schema.records.deliveryStatus,
        isBlacklisted: schema.applicants.isBlacklisted,
        updatedAt: schema.records.updatedAt,
        sortValue: sortColumn,
        // Flags come back as an aggregated array rather than a second query
        // per row — this is the N+1 the plan's review checklist calls out.
        flags: sql<string[]>`
          coalesce(
            (SELECT array_agg(f.flag)
               FROM ${schema.applicantFlags} f
              WHERE f.applicant_id = ${schema.applicants.id}
                AND f.removed_at IS NULL),
            '{}'
          )`,
      })
      .from(schema.records)
      .innerJoin(schema.applicants, eq(schema.records.applicantId, schema.applicants.id))
      .leftJoin(schema.achievements, eq(schema.achievements.recordId, schema.records.id))
      .leftJoin(schema.categories, eq(schema.achievements.categoryId, schema.categories.id))
      .leftJoin(schema.users, eq(schema.records.assignedToUserId, schema.users.id))
      .where(and(...conditions))
      .orderBy(direction(sortColumn), direction(schema.records.id))
      // One extra row answers "is there another page?" without a COUNT.
      .limit(query.limit + 1);

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    const items: ApplicantListRow[] = page.map((row) => ({
      recordId: row.recordId,
      applicantId: row.applicantId,
      applicantCode: row.applicantCode,
      recordCode: row.recordCode,
      fullName: row.fullName,
      mobile: row.mobile,
      city: row.city,
      recordTitle: row.recordTitle,
      categoryName: row.categoryName,
      status: row.status,
      assignedToUserId: row.assignedToUserId,
      assignedToName: row.assignedToName,
      paymentStatus: row.paymentStatus,
      deliveryStatus: row.deliveryStatus,
      isBlacklisted: row.isBlacklisted,
      flags: row.flags ?? [],
      updatedAt: row.updatedAt.toISOString(),
    }));

    const last = page.at(-1);
    const nextCursor =
      hasMore && last ? encodeCursor(serialiseSortValue(last.sortValue), last.recordId) : null;

    // The total costs a second full scan, so it is opt-in. The UI asks for it
    // on first load ("1–50 of 12,548") and omits it while paging.
    let total: number | undefined;
    if (query.withTotal) {
      const countConditions = this.buildFilters(query);
      const [countRow] = await this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.records)
        .innerJoin(schema.applicants, eq(schema.records.applicantId, schema.applicants.id))
        .leftJoin(schema.achievements, eq(schema.achievements.recordId, schema.records.id))
        .where(and(...countConditions));
      total = countRow?.count ?? 0;
    }

    return { items, nextCursor, total };
  }

  private buildFilters(query: ApplicantListQuery): SQL[] {
    const conditions: SQL[] = [
      isNull(schema.records.deletedAt) as SQL,
      isNull(schema.applicants.deletedAt) as SQL,
    ];

    // Free-text search across the fields §17 lists. The trigram indexes make
    // this an index scan; ILIKE on its own would sequential-scan.
    if (query.q) {
      const term = `%${query.q}%`;
      const clause = or(
        sql`${schema.applicants.fullName} ILIKE ${term}`,
        sql`${schema.applicants.mobile} ILIKE ${term}`,
        sql`${schema.applicants.email} ILIKE ${term}`,
        sql`${schema.applicants.applicantCode} ILIKE ${term}`,
        sql`${schema.records.recordCode} ILIKE ${term}`,
        sql`${schema.achievements.recordTitle} ILIKE ${term}`,
      );
      if (clause) conditions.push(clause);
    }

    if (query.status?.length) conditions.push(inArray(schema.records.status, query.status));
    if (query.assignedToUserId?.length) {
      conditions.push(inArray(schema.records.assignedToUserId, query.assignedToUserId));
    }
    if (query.categoryId?.length) {
      conditions.push(inArray(schema.achievements.categoryId, query.categoryId));
    }
    if (query.source?.length) conditions.push(inArray(schema.records.source, query.source));
    if (query.paymentStatus?.length) {
      conditions.push(inArray(schema.records.paymentStatus, query.paymentStatus));
    }
    if (query.deliveryStatus?.length) {
      conditions.push(inArray(schema.records.deliveryStatus, query.deliveryStatus));
    }

    if (query.createdFrom) conditions.push(gte(schema.records.applicationDate, query.createdFrom));
    if (query.createdTo) conditions.push(lte(schema.records.applicationDate, query.createdTo));
    if (query.updatedFrom) conditions.push(gte(schema.records.updatedAt, query.updatedFrom));
    if (query.updatedTo) conditions.push(lte(schema.records.updatedAt, query.updatedTo));

    if (!query.includeBlacklisted) {
      conditions.push(eq(schema.applicants.isBlacklisted, false));
    }

    // Flag filter — EXISTS rather than a join, so a record with three flags
    // still yields exactly one row.
    if (query.flag?.length) {
      conditions.push(
        sql`EXISTS (
          SELECT 1 FROM ${schema.applicantFlags} f
           WHERE f.applicant_id = ${schema.applicants.id}
             AND f.removed_at IS NULL
             AND f.flag = ANY(${query.flag})
        )`,
      );
    }

    return conditions;
  }

  /** Allow-list: only indexed columns are sortable. */
  private resolveSortColumn(sortBy: string | undefined) {
    switch (sortBy) {
      case 'name':
        return schema.applicants.fullName;
      case 'status':
        return schema.records.status;
      case 'applicationDate':
        return schema.records.applicationDate;
      case 'paymentStatus':
        return schema.records.paymentStatus;
      case 'deliveryStatus':
        return schema.records.deliveryStatus;
      case 'recordCode':
        return schema.records.recordCode;
      case 'updatedAt':
      default:
        // Matches records_list_covering_idx, so the default view is an
        // index-only scan.
        return schema.records.updatedAt;
    }
  }
}

function serialiseSortValue(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value ?? '');
}

function encodeCursor(sortValue: string, id: string): string {
  return Buffer.from(`${sortValue}|${id}`).toString('base64url');
}

/**
 * Compare on the composite `(sortColumn, id)` so rows sharing a sort value —
 * two records updated in the same millisecond — are still ordered
 * deterministically and neither is lost at the page boundary.
 */
function decodeCursor(
  cursor: string,
  sortColumn: ReturnType<ApplicantListService['resolveSortColumn']>,
  direction: 'asc' | 'desc',
): SQL | undefined {
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const separator = decoded.lastIndexOf('|');
  if (separator === -1) return undefined;

  const sortValue = decoded.slice(0, separator);
  const id = decoded.slice(separator + 1);
  if (!id) return undefined;

  const comparison = direction === 'asc' ? sql`>` : sql`<`;

  return sql`(${sortColumn}, ${schema.records.id}) ${comparison} (${sortValue}, ${id}::uuid)`;
}
