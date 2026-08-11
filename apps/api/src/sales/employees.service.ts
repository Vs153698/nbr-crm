import { Inject, Injectable } from '@nestjs/common';
import { EMPLOYEE_STATUS, formatEmployeeId, type EmployeeInput } from '@nbr/shared';
import { and, asc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { AUDIT, AuditService } from '../audit/audit.service';
import { ConflictError, NotFoundError, ValidationError } from '../common/errors';
import { requireActor } from '../common/request-context';
import type { Database } from '../database/client';
import { DB } from '../database/database.tokens';
import * as schema from '../database/schema';

const DEFAULT_PAGE_SIZE = 50;

/** Columns safe to return in a list. Excludes the personal block. */
const LIST_COLUMNS = {
  id: schema.employees.id,
  employeeCode: schema.employees.employeeCode,
  fullName: schema.employees.fullName,
  workEmail: schema.employees.workEmail,
  mobile: schema.employees.mobile,
  department: schema.employees.department,
  designation: schema.employees.designation,
  employmentType: schema.employees.employmentType,
  status: schema.employees.status,
  joinedOn: schema.employees.joinedOn,
  workLocation: schema.employees.workLocation,
  photoKey: schema.employees.photoKey,
  userId: schema.employees.userId,
  reportsToEmployeeId: schema.employees.reportsToEmployeeId,
  probationEndsOn: schema.employees.probationEndsOn,
};

/**
 * The staff directory.
 *
 * Deliberately not the same table as `users`. Not every employee has a login —
 * field staff and contractors appear here and never sign in — an account can be
 * deactivated while the person is still employed, and the directory carries
 * things a login has no business storing, such as a joining date and an
 * emergency contact.
 */
@Injectable()
export class EmployeesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async list(filters: {
    q?: string;
    department?: string;
    status?: string;
    employmentType?: string;
    limit?: number;
  }) {
    const conditions: SQL[] = [isNull(schema.employees.deletedAt)];

    if (filters.department) conditions.push(eq(schema.employees.department, filters.department));
    if (filters.status) conditions.push(eq(schema.employees.status, filters.status));
    if (filters.employmentType) {
      conditions.push(eq(schema.employees.employmentType, filters.employmentType));
    }

    if (filters.q) {
      const term = `%${filters.q}%`;
      const digits = filters.q.replace(/\D/g, '');
      const search = [
        ilike(schema.employees.fullName, term),
        ilike(schema.employees.employeeCode, term),
        ilike(schema.employees.designation, term),
      ];
      if (digits.length >= 4) search.push(ilike(schema.employees.mobile, `%${digits}%`));
      conditions.push(or(...search)!);
    }

    /**
     * The reporting manager by name, via a self-join.
     *
     * The directory table shows a manager on every row, and resolving the id
     * per row in the browser would be one request per employee — forty on a
     * first page. An alias join costs nothing here and returns the whole list
     * in one query.
     */
    const manager = alias(schema.employees, 'manager');

    const rows = await this.db
      .select({
        ...LIST_COLUMNS,
        reportsToName: manager.fullName,
        reportsToDesignation: manager.designation,
      })
      .from(schema.employees)
      .leftJoin(manager, eq(schema.employees.reportsToEmployeeId, manager.id))
      .where(and(...conditions))
      .orderBy(asc(schema.employees.fullName))
      .limit(Math.min(filters.limit ?? DEFAULT_PAGE_SIZE, 200));

    return { items: rows };
  }

  async getById(employeeId: string) {
    const [employee] = await this.db
      .select()
      .from(schema.employees)
      .where(and(eq(schema.employees.id, employeeId), isNull(schema.employees.deletedAt)))
      .limit(1);

    if (!employee) throw new NotFoundError('Employee');

    // The reporting line by name, so the profile does not need a second call.
    let reportsToName: string | null = null;
    if (employee.reportsToEmployeeId) {
      const [manager] = await this.db
        .select({ fullName: schema.employees.fullName })
        .from(schema.employees)
        .where(eq(schema.employees.id, employee.reportsToEmployeeId))
        .limit(1);
      reportsToName = manager?.fullName ?? null;
    }

    const reports = await this.db
      .select({
        id: schema.employees.id,
        fullName: schema.employees.fullName,
        designation: schema.employees.designation,
      })
      .from(schema.employees)
      .where(
        and(
          eq(schema.employees.reportsToEmployeeId, employeeId),
          isNull(schema.employees.deletedAt),
        ),
      )
      .orderBy(asc(schema.employees.fullName));

    // The profile always renders the onboarding section; the count lets it show
    // "3 documents" in the header without a second round trip for the list.
    const [documents] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.employeeDocuments)
      .where(
        and(
          eq(schema.employeeDocuments.employeeId, employeeId),
          isNull(schema.employeeDocuments.deletedAt),
        ),
      );

    return { ...employee, reportsToName, reports, documentCount: documents?.count ?? 0 };
  }

  async create(input: EmployeeInput): Promise<{ id: string; employeeCode: string }> {
    const actor = requireActor();

    const employeeCode = input.employeeCode?.trim().toUpperCase();
    if (employeeCode) await this.assertCodeFree(employeeCode);
    if (input.userId) await this.assertAccountFree(input.userId);

    const created = await this.db.transaction(async (tx) => {
      let code = employeeCode;
      if (!code) {
        const result = await tx.execute<{ nextval: string }>(
          sql`SELECT nextval('employee_code_seq')::text AS nextval`,
        );
        code = formatEmployeeId(Number((result as unknown as Array<{ nextval: string }>)[0]!.nextval));
      }

      const [row] = await tx
        .insert(schema.employees)
        .values({
          ...this.toRow(input),
          employeeCode: code,
          createdByUserId: actor.userId,
          // toRow widens to Record<string, unknown> while mapping the date
          // columns; the schema above guarantees the required fields are present.
        } as typeof schema.employees.$inferInsert)
        .returning({ id: schema.employees.id, employeeCode: schema.employees.employeeCode });

      return row!;
    });

    await this.audit.record({
      action: AUDIT.EMPLOYEE_CREATED,
      entityType: 'employee',
      entityId: created.id,
      entityLabel: `${created.employeeCode} — ${input.fullName}`,
    });

    return created;
  }

  async update(employeeId: string, input: Partial<EmployeeInput>): Promise<{ ok: true }> {
    const [existing] = await this.db
      .select({
        id: schema.employees.id,
        employeeCode: schema.employees.employeeCode,
        userId: schema.employees.userId,
      })
      .from(schema.employees)
      .where(and(eq(schema.employees.id, employeeId), isNull(schema.employees.deletedAt)))
      .limit(1);

    if (!existing) throw new NotFoundError('Employee');

    if (input.employeeCode && input.employeeCode.toUpperCase() !== existing.employeeCode) {
      await this.assertCodeFree(input.employeeCode.trim().toUpperCase());
    }
    if (input.userId && input.userId !== existing.userId) {
      await this.assertAccountFree(input.userId);
    }

    // Someone cannot report to themselves — the org chart would loop and the
    // reporting-line lookup would never terminate.
    if (input.reportsToEmployeeId === employeeId) {
      throw new ValidationError({
        reportsToEmployeeId: ['An employee cannot report to themselves.'],
      });
    }

    await this.db
      .update(schema.employees)
      .set(this.toRow(input))
      .where(eq(schema.employees.id, employeeId));

    await this.audit.record({
      action: AUDIT.EMPLOYEE_UPDATED,
      entityType: 'employee',
      entityId: employeeId,
      entityLabel: existing.employeeCode,
      meta: { fields: Object.keys(input) },
    });

    return { ok: true };
  }

  /**
   * Soft delete.
   *
   * An exited employee is normally marked `exited` rather than removed — audit
   * entries, records they handled and the reporting line all point at them, and
   * a hard delete would leave those dangling. Deletion is for a row created in
   * error.
   */
  async remove(employeeId: string, reason?: string): Promise<{ ok: true }> {
    const [existing] = await this.db
      .select({ employeeCode: schema.employees.employeeCode })
      .from(schema.employees)
      .where(and(eq(schema.employees.id, employeeId), isNull(schema.employees.deletedAt)))
      .limit(1);

    if (!existing) throw new NotFoundError('Employee');

    const [report] = await this.db
      .select({ id: schema.employees.id })
      .from(schema.employees)
      .where(
        and(
          eq(schema.employees.reportsToEmployeeId, employeeId),
          isNull(schema.employees.deletedAt),
        ),
      )
      .limit(1);

    if (report) {
      throw new ConflictError(
        'EMPLOYEE_HAS_REPORTS',
        'Other employees report to this person. Move them first, or mark this record Exited instead.',
      );
    }

    await this.db
      .update(schema.employees)
      .set({ deletedAt: new Date() })
      .where(eq(schema.employees.id, employeeId));

    await this.audit.record({
      action: AUDIT.EMPLOYEE_DELETED,
      entityType: 'employee',
      entityId: employeeId,
      entityLabel: existing.employeeCode,
      meta: { reason: reason ?? null },
    });

    return { ok: true };
  }

  /** Departments actually in use, for the filter bar. */
  async departments(): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ department: schema.employees.department })
      .from(schema.employees)
      .where(and(isNull(schema.employees.deletedAt), sql`${schema.employees.department} is not null`))
      .orderBy(asc(schema.employees.department));

    return rows.map((row) => row.department!).filter(Boolean);
  }

  private async assertCodeFree(code: string): Promise<void> {
    const [clash] = await this.db
      .select({ id: schema.employees.id })
      .from(schema.employees)
      .where(eq(schema.employees.employeeCode, code))
      .limit(1);

    if (clash) {
      throw new ValidationError({ employeeCode: [`${code} is already in use.`] });
    }
  }

  private async assertAccountFree(userId: string): Promise<void> {
    const [clash] = await this.db
      .select({ employeeCode: schema.employees.employeeCode })
      .from(schema.employees)
      .where(and(eq(schema.employees.userId, userId), isNull(schema.employees.deletedAt)))
      .limit(1);

    if (clash) {
      throw new ValidationError({
        userId: [`That login account is already linked to ${clash.employeeCode}.`],
      });
    }
  }

  /** Dates arrive as Date and are stored as DATE strings. */
  private toRow(input: Partial<EmployeeInput>): Record<string, unknown> {
    const row: Record<string, unknown> = { ...input };
    for (const key of ['dateOfBirth', 'joinedOn', 'exitedOn'] as const) {
      const value = input[key];
      if (value instanceof Date) row[key] = value.toISOString().slice(0, 10);
    }
    if (typeof input.employeeCode === 'string') {
      row.employeeCode = input.employeeCode.trim().toUpperCase();
    }
    return row;
  }
}
