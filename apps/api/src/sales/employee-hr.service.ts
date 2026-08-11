import { Inject, Injectable } from '@nestjs/common';
import {
  ATTENDANCE_STATUS,
  ATTENDANCE_STATUS_META,
  EMPLOYEE_STATUS,
  LEAVE_STATUS,
  LEAVE_TYPE_LABELS,
  NON_WORKING_ATTENDANCE,
  PAYSLIP_STATUS,
  attendanceStatusForLeave,
  isOnProbation,
  payslipPeriodLabel,
  type ApplyLeaveInput,
  type AttendanceStatus,
  type GeneratePayslipInput,
  type LeaveType,
  type MarkAttendanceInput,
} from '@nbr/shared';
import { and, asc, desc, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import { AUDIT, AuditService } from '../audit/audit.service';
import { ConflictError, NotFoundError, ValidationError } from '../common/errors';
import { requireActor } from '../common/request-context';
import type { Database } from '../database/client';
import { DB } from '../database/database.tokens';
import * as schema from '../database/schema';

/** `YYYY-MM-DD` in local terms — the form of every date column here. */
function isoDate(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

/** Calendar days in a month, for the working-day denominator. */
function daysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate();
}

function toMoney(value: number): string {
  return value.toFixed(2);
}

/**
 * Attendance, leave and payroll (§HR).
 *
 * Split from `EmployeesService`, which is the directory — who works here and
 * what their details are. This is what happens to them month by month, and
 * keeping the two apart stops a file that is already long from becoming the
 * place every HR feature lands.
 *
 * One rule runs through all three: **figures are frozen when they are decided.**
 * A payslip copies the salary and the day counts it was generated from rather
 * than recomputing them, because a pay revision in September must not rewrite
 * what March says. The same instinct is why attendance records non-working days
 * explicitly instead of leaving gaps.
 */
@Injectable()
export class EmployeeHrService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  // ── Attendance ────────────────────────────────────────────────────────────

  /**
   * Mark one day, correcting it if it was already marked.
   *
   * Upsert rather than insert: a day has one answer, and the alternative is two
   * contradictory rows with no rule for which wins. The unique index enforces
   * it at the database as well, so a concurrent double-submit cannot slip past.
   */
  async markAttendance(
    employeeId: string,
    input: MarkAttendanceInput,
  ): Promise<{ id: string; corrected: boolean }> {
    const actor = requireActor();
    const employee = await this.loadEmployee(employeeId);

    const onDate = isoDate(input.onDate);

    // Times only make sense together, and a check-out before a check-in is a
    // typo rather than a night shift worth modelling.
    if (input.checkInAt && input.checkOutAt && input.checkOutAt < input.checkInAt) {
      throw new ValidationError({
        checkOutAt: ['Check-out cannot be before check-in.'],
      });
    }

    const workedMinutes =
      input.checkInAt && input.checkOutAt
        ? Math.round((input.checkOutAt.getTime() - input.checkInAt.getTime()) / 60_000)
        : null;

    const [existing] = await this.db
      .select({ id: schema.employeeAttendance.id })
      .from(schema.employeeAttendance)
      .where(
        and(
          eq(schema.employeeAttendance.employeeId, employeeId),
          eq(schema.employeeAttendance.onDate, onDate),
        ),
      )
      .limit(1);

    const values = {
      employeeId,
      onDate,
      status: input.status,
      checkInAt: input.checkInAt ?? null,
      checkOutAt: input.checkOutAt ?? null,
      workedMinutes,
      remarks: input.remarks ?? null,
      markedByUserId: actor.userId,
      markedByName: actor.fullName,
    };

    const [row] = await this.db
      .insert(schema.employeeAttendance)
      .values(values)
      .onConflictDoUpdate({
        target: [schema.employeeAttendance.employeeId, schema.employeeAttendance.onDate],
        set: {
          status: values.status,
          checkInAt: values.checkInAt,
          checkOutAt: values.checkOutAt,
          workedMinutes: values.workedMinutes,
          remarks: values.remarks,
          markedByUserId: values.markedByUserId,
          markedByName: values.markedByName,
        },
      })
      .returning({ id: schema.employeeAttendance.id });

    await this.audit.record({
      action: AUDIT.ATTENDANCE_MARKED,
      entityType: 'employee',
      entityId: employeeId,
      entityLabel: `${employee.fullName} — ${onDate} ${ATTENDANCE_STATUS_META[input.status].label}`,
      meta: { onDate, status: input.status, corrected: Boolean(existing) },
    });

    return { id: row!.id, corrected: Boolean(existing) };
  }

  /**
   * One month's register, plus the totals payroll cares about.
   *
   * The summary is computed here rather than in the browser so the payslip and
   * the screen can never disagree about how many days somebody worked.
   */
  async attendanceForMonth(employeeId: string, month: number, year: number) {
    await this.loadEmployee(employeeId);

    const from = `${year}-${String(month).padStart(2, '0')}-01`;
    const to = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth(month, year)).padStart(2, '0')}`;

    const rows = await this.db
      .select()
      .from(schema.employeeAttendance)
      .where(
        and(
          eq(schema.employeeAttendance.employeeId, employeeId),
          gte(schema.employeeAttendance.onDate, from),
          lte(schema.employeeAttendance.onDate, to),
        ),
      )
      .orderBy(asc(schema.employeeAttendance.onDate));

    const summary = this.summariseAttendance(
      rows.map((row) => row.status as AttendanceStatus),
      month,
      year,
    );

    return {
      month,
      year,
      days: rows.map((row) => ({
        id: row.id,
        onDate: row.onDate,
        status: row.status,
        checkInAt: row.checkInAt?.toISOString() ?? null,
        checkOutAt: row.checkOutAt?.toISOString() ?? null,
        workedMinutes: row.workedMinutes,
        remarks: row.remarks,
        markedByName: row.markedByName,
      })),
      summary,
    };
  }

  /**
   * Turn a month's statuses into the numbers a payslip needs.
   *
   * `workingDays` excludes week-offs and holidays — days nobody was expected in
   * are neither worked nor owed, and counting them would make every month look
   * like a third of it was missed. Unmarked days are treated as present rather
   * than absent: a register nobody filled in is a gap in the record, not
   * evidence that the person did not come to work, and docking pay on that
   * basis is the wrong default by a long way.
   */
  private summariseAttendance(statuses: AttendanceStatus[], month: number, year: number) {
    const counts = statuses.reduce<Record<string, number>>((acc, status) => {
      acc[status] = (acc[status] ?? 0) + 1;
      return acc;
    }, {});

    const nonWorking = NON_WORKING_ATTENDANCE.reduce(
      (total, status) => total + (counts[status] ?? 0),
      0,
    );

    const calendarDays = daysInMonth(month, year);
    const workingDays = calendarDays - nonWorking;

    const markedValue = statuses.reduce(
      (total, status) => total + ATTENDANCE_STATUS_META[status].dayValue,
      0,
    );

    const unmarked = Math.max(0, calendarDays - statuses.length);
    const payableDays = Math.min(workingDays, markedValue + unmarked);

    return {
      calendarDays,
      workingDays,
      payableDays: Number(payableDays.toFixed(1)),
      lopDays: Number(Math.max(0, workingDays - payableDays).toFixed(1)),
      present: counts[ATTENDANCE_STATUS.PRESENT] ?? 0,
      workFromHome: counts[ATTENDANCE_STATUS.WORK_FROM_HOME] ?? 0,
      halfDays: counts[ATTENDANCE_STATUS.HALF_DAY] ?? 0,
      absent: counts[ATTENDANCE_STATUS.ABSENT] ?? 0,
      onLeave: counts[ATTENDANCE_STATUS.ON_LEAVE] ?? 0,
      // Reported separately from paid leave: this is the figure that explains
      // the loss-of-pay line on the payslip.
      leaveWithoutPay: counts[ATTENDANCE_STATUS.LEAVE_WITHOUT_PAY] ?? 0,
      weekOff: counts[ATTENDANCE_STATUS.WEEK_OFF] ?? 0,
      holiday: counts[ATTENDANCE_STATUS.HOLIDAY] ?? 0,
      unmarked,
    };
  }

  // ── Leave ─────────────────────────────────────────────────────────────────

  async applyLeave(employeeId: string, input: ApplyLeaveInput): Promise<{ id: string }> {
    const actor = requireActor();
    const employee = await this.loadEmployee(employeeId);

    const fromDate = isoDate(input.fromDate);
    const toDate = isoDate(input.toDate);

    /**
     * Refuse a request that overlaps one already open or approved.
     *
     * Two live requests covering the same day is how somebody gets approved
     * twice for one absence, and how a payroll run double-counts it. A
     * rejected or cancelled request is not in the way.
     */
    const [clash] = await this.db
      .select({ id: schema.employeeLeaveRequests.id, from: schema.employeeLeaveRequests.fromDate })
      .from(schema.employeeLeaveRequests)
      .where(
        and(
          eq(schema.employeeLeaveRequests.employeeId, employeeId),
          or(
            eq(schema.employeeLeaveRequests.status, LEAVE_STATUS.PENDING),
            eq(schema.employeeLeaveRequests.status, LEAVE_STATUS.APPROVED),
          ),
          lte(schema.employeeLeaveRequests.fromDate, toDate),
          gte(schema.employeeLeaveRequests.toDate, fromDate),
        ),
      )
      .limit(1);

    if (clash) {
      throw new ConflictError(
        'LEAVE_OVERLAPS',
        `There is already a leave request covering ${clash.from}. Cancel it before filing another.`,
      );
    }

    const [row] = await this.db
      .insert(schema.employeeLeaveRequests)
      .values({
        employeeId,
        leaveType: input.leaveType,
        fromDate,
        toDate,
        days: input.days.toFixed(1),
        reason: input.reason,
        status: LEAVE_STATUS.PENDING,
        appliedByUserId: actor.userId,
        appliedByName: actor.fullName,
      })
      .returning({ id: schema.employeeLeaveRequests.id });

    await this.audit.record({
      action: AUDIT.LEAVE_APPLIED,
      entityType: 'employee',
      entityId: employeeId,
      entityLabel: `${employee.fullName} — ${LEAVE_TYPE_LABELS[input.leaveType as LeaveType]} ${fromDate} to ${toDate}`,
      meta: { leaveType: input.leaveType, fromDate, toDate, days: input.days },
    });

    return { id: row!.id };
  }

  /**
   * Approve, reject or cancel.
   *
   * Approving writes the days into the attendance register as `on_leave`, which
   * is what makes leave and attendance agree. Doing it here rather than leaving
   * it to whoever marks the month is the difference between an approval that
   * means something to payroll and one that is only a note.
   */
  async decideLeave(
    leaveId: string,
    input: { status: string; decisionNote?: string },
  ): Promise<{ ok: true }> {
    const actor = requireActor();

    const [leave] = await this.db
      .select()
      .from(schema.employeeLeaveRequests)
      .where(eq(schema.employeeLeaveRequests.id, leaveId))
      .limit(1);

    if (!leave) throw new NotFoundError('Leave request');

    if (leave.status !== LEAVE_STATUS.PENDING) {
      throw new ConflictError(
        'ALREADY_DECIDED',
        `This request was already ${leave.status}. Only a pending request can be decided.`,
      );
    }

    if (input.status === LEAVE_STATUS.REJECTED && !input.decisionNote?.trim()) {
      throw new ValidationError({
        decisionNote: ['Say why it was refused — that is the only question a rejection raises.'],
      });
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.employeeLeaveRequests)
        .set({
          status: input.status,
          decidedByUserId: actor.userId,
          decidedByName: actor.fullName,
          decidedAt: new Date(),
          decisionNote: input.decisionNote ?? null,
        })
        .where(eq(schema.employeeLeaveRequests.id, leaveId));

      if (input.status !== LEAVE_STATUS.APPROVED) return;

      // Write the approved span into the register, one day at a time.
      // `onConflictDoNothing` so an already-marked day is left alone: somebody
      // recording a half-day worked knows more than this loop does.
      const cursor = new Date(leave.fromDate);
      const end = new Date(leave.toDate);

      while (cursor.getTime() <= end.getTime()) {
        await tx
          .insert(schema.employeeAttendance)
          .values({
            employeeId: leave.employeeId,
            onDate: isoDate(cursor),
            // Paid or unpaid is decided here, once, from the request's type —
            // the register holds days, not requests, and payroll reads only
            // the day.
            status: attendanceStatusForLeave(leave.leaveType),
            remarks: `${LEAVE_TYPE_LABELS[leave.leaveType as LeaveType]} — approved`,
            markedByUserId: actor.userId,
            markedByName: actor.fullName,
          })
          .onConflictDoNothing({
            target: [schema.employeeAttendance.employeeId, schema.employeeAttendance.onDate],
          });

        cursor.setDate(cursor.getDate() + 1);
      }
    });

    await this.audit.record({
      action: input.status === LEAVE_STATUS.APPROVED ? AUDIT.LEAVE_APPROVED : AUDIT.LEAVE_DECIDED,
      entityType: 'employee',
      entityId: leave.employeeId,
      entityLabel: `Leave ${input.status} — ${leave.fromDate} to ${leave.toDate}`,
      meta: { leaveId, status: input.status, note: input.decisionNote ?? null },
    });

    return { ok: true };
  }

  async listLeave(employeeId: string) {
    await this.loadEmployee(employeeId);

    const rows = await this.db
      .select()
      .from(schema.employeeLeaveRequests)
      .where(eq(schema.employeeLeaveRequests.employeeId, employeeId))
      .orderBy(desc(schema.employeeLeaveRequests.fromDate));

    // Taken this calendar year, split by type — the figure anyone actually asks
    // for. Only approved leave counts; a pending request has been taken by
    // nobody yet.
    const thisYear = new Date().getFullYear();
    const takenByType: Record<string, number> = {};
    let takenTotal = 0;

    for (const row of rows) {
      if (row.status !== LEAVE_STATUS.APPROVED) continue;
      if (new Date(row.fromDate).getFullYear() !== thisYear) continue;
      const days = Number(row.days);
      takenByType[row.leaveType] = (takenByType[row.leaveType] ?? 0) + days;
      takenTotal += days;
    }

    return {
      requests: rows.map((row) => ({
        id: row.id,
        leaveType: row.leaveType,
        fromDate: row.fromDate,
        toDate: row.toDate,
        days: row.days,
        reason: row.reason,
        status: row.status,
        decidedByName: row.decidedByName,
        decidedAt: row.decidedAt?.toISOString() ?? null,
        decisionNote: row.decisionNote,
        appliedByName: row.appliedByName,
        createdAt: row.createdAt.toISOString(),
      })),
      summary: {
        year: thisYear,
        takenTotal: Number(takenTotal.toFixed(1)),
        takenByType,
        pending: rows.filter((row) => row.status === LEAVE_STATUS.PENDING).length,
      },
    };
  }

  // ── Payroll ───────────────────────────────────────────────────────────────

  /**
   * Generate a payslip for one month, from the salary and the register.
   *
   * Everything is frozen onto the row. Nothing here is recomputed on read, so
   * the slip an employee downloaded in April still says in December exactly
   * what it said then — which is the entire point of a payslip.
   */
  async generatePayslip(
    employeeId: string,
    input: GeneratePayslipInput,
  ): Promise<{ id: string; payslipNumber: string }> {
    const actor = requireActor();
    const employee = await this.loadEmployee(employeeId);

    if (!employee.monthlySalary || Number(employee.monthlySalary) <= 0) {
      throw new ValidationError({
        monthlySalary: [
          'This employee has no monthly salary on record. Set it on their profile before generating a payslip.',
        ],
      });
    }

    const [existing] = await this.db
      .select({ id: schema.employeePayslips.id, number: schema.employeePayslips.payslipNumber })
      .from(schema.employeePayslips)
      .where(
        and(
          eq(schema.employeePayslips.employeeId, employeeId),
          eq(schema.employeePayslips.periodYear, input.periodYear),
          eq(schema.employeePayslips.periodMonth, input.periodMonth),
          sql`${schema.employeePayslips.status} <> ${PAYSLIP_STATUS.CANCELLED}`,
        ),
      )
      .limit(1);

    if (existing) {
      throw new ConflictError(
        'PAYSLIP_EXISTS',
        `${payslipPeriodLabel(input.periodMonth, input.periodYear)} already has payslip ${existing.number}. Cancel it before issuing another.`,
      );
    }

    const attendance = await this.attendanceForMonth(
      employeeId,
      input.periodMonth,
      input.periodYear,
    );

    const monthly = Number(employee.monthlySalary);
    const { workingDays, payableDays, lopDays } = attendance.summary;

    /**
     * Full salary in, loss of pay out — rather than a quietly reduced basic.
     *
     * Both arrive at the same net, but only this way does the printed slip add
     * up: basic at the agreed salary, the shortfall named as its own deduction,
     * and every column totalling to what is beside it. Pro-rating basic and
     * *also* listing loss of pay showed two deduction lines under a total that
     * counted one of them, which is the sort of arithmetic an employee checks
     * and then rings up about.
     *
     * A month with no register marked has no loss of pay at all, so the slip
     * comes out at the full salary — the correct and safe default.
     */
    const lossOfPay = workingDays > 0 ? (monthly * (workingDays - payableDays)) / workingDays : 0;

    const extraEarnings = input.earnings.reduce((total, line) => total + Number(line.amount), 0);
    const namedDeductions = input.deductions.reduce(
      (total, line) => total + Number(line.amount),
      0,
    );

    const grossPay = monthly + extraEarnings;
    const totalDeductions = lossOfPay + namedDeductions;
    const netPay = grossPay - totalDeductions;

    if (netPay < 0) {
      throw new ValidationError({
        deductions: ['Deductions exceed the gross pay for this month.'],
      });
    }

    const payslipNumber = await this.nextPayslipNumber(input.periodYear);

    const [row] = await this.db
      .insert(schema.employeePayslips)
      .values({
        employeeId,
        periodMonth: input.periodMonth,
        periodYear: input.periodYear,
        payslipNumber,
        monthlySalary: toMoney(monthly),
        workingDays: workingDays.toFixed(1),
        payableDays: payableDays.toFixed(1),
        lopDays: lopDays.toFixed(1),
        grossPay: toMoney(grossPay),
        totalDeductions: toMoney(totalDeductions),
        netPay: toMoney(netPay),
        // Basic at the agreed salary, then whatever was added by hand. The
        // shortfall appears below as a deduction, so the slip explains itself.
        earnings: [
          { label: 'Basic pay', amount: toMoney(monthly) },
          ...input.earnings.map((line) => ({ label: line.label, amount: toMoney(Number(line.amount)) })),
        ],
        deductions: [
          ...(lossOfPay > 0.005
            ? [{ label: `Loss of pay (${lopDays} day${lopDays === 1 ? '' : 's'})`, amount: toMoney(lossOfPay) }]
            : []),
          ...input.deductions.map((line) => ({ label: line.label, amount: toMoney(Number(line.amount)) })),
        ],
        status: PAYSLIP_STATUS.ISSUED,
        remarks: input.remarks ?? null,
        generatedByUserId: actor.userId,
        generatedByName: actor.fullName,
      })
      .returning({ id: schema.employeePayslips.id });

    await this.audit.record({
      action: AUDIT.PAYSLIP_GENERATED,
      entityType: 'employee',
      entityId: employeeId,
      entityLabel: `${employee.fullName} — ${payslipPeriodLabel(input.periodMonth, input.periodYear)} (${payslipNumber})`,
      meta: { payslipNumber, netPay: toMoney(netPay) },
    });

    return { id: row!.id, payslipNumber };
  }

  async listPayslips(employeeId: string) {
    await this.loadEmployee(employeeId);

    const rows = await this.db
      .select()
      .from(schema.employeePayslips)
      .where(eq(schema.employeePayslips.employeeId, employeeId))
      .orderBy(desc(schema.employeePayslips.periodYear), desc(schema.employeePayslips.periodMonth));

    return rows.map((row) => ({
      id: row.id,
      payslipNumber: row.payslipNumber,
      periodMonth: row.periodMonth,
      periodYear: row.periodYear,
      periodLabel: payslipPeriodLabel(row.periodMonth, row.periodYear),
      grossPay: row.grossPay,
      totalDeductions: row.totalDeductions,
      netPay: row.netPay,
      payableDays: row.payableDays,
      workingDays: row.workingDays,
      status: row.status,
      generatedByName: row.generatedByName,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async cancelPayslip(payslipId: string, reason: string): Promise<{ ok: true }> {
    const [payslip] = await this.db
      .select()
      .from(schema.employeePayslips)
      .where(eq(schema.employeePayslips.id, payslipId))
      .limit(1);

    if (!payslip) throw new NotFoundError('Payslip');
    if (payslip.status === PAYSLIP_STATUS.CANCELLED) return { ok: true };

    // Cancelled, never deleted. The partial unique index excludes cancelled
    // rows, so a corrected slip can be issued for the same month while the
    // original stays on record with the reason it was withdrawn.
    await this.db
      .update(schema.employeePayslips)
      .set({
        status: PAYSLIP_STATUS.CANCELLED,
        remarks: [payslip.remarks, `Cancelled: ${reason}`].filter(Boolean).join(' · '),
      })
      .where(eq(schema.employeePayslips.id, payslipId));

    await this.audit.record({
      action: AUDIT.PAYSLIP_CANCELLED,
      entityType: 'employee',
      entityId: payslip.employeeId,
      entityLabel: payslip.payslipNumber,
      meta: { reason },
    });

    return { ok: true };
  }

  /** `NBR/PS/2026/00042` — sequential within the year. */
  private async nextPayslipNumber(year: number): Promise<string> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.employeePayslips)
      .where(eq(schema.employeePayslips.periodYear, year));

    return `NBR/PS/${year}/${String((row?.count ?? 0) + 1).padStart(5, '0')}`;
  }

  // ── Activity feed ─────────────────────────────────────────────────────────

  /**
   * What has happened to this employee, newest first.
   *
   * Read from the audit log rather than a second feed table. Every action that
   * matters here already writes one — created, updated, document uploaded,
   * attendance marked, leave approved, payslip generated — and a parallel table
   * would be a copy that drifts the first time somebody adds an action to one
   * and not the other.
   */
  async activity(employeeId: string, limit = 20) {
    await this.loadEmployee(employeeId);

    const rows = await this.db
      .select({
        id: schema.auditLogs.id,
        action: schema.auditLogs.action,
        entityLabel: schema.auditLogs.entityLabel,
        actorName: schema.auditLogs.actorName,
        meta: schema.auditLogs.meta,
        createdAt: schema.auditLogs.createdAt,
      })
      .from(schema.auditLogs)
      .where(
        and(eq(schema.auditLogs.entityType, 'employee'), eq(schema.auditLogs.entityId, employeeId)),
      )
      .orderBy(desc(schema.auditLogs.createdAt))
      .limit(Math.min(limit, 100));

    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      label: row.entityLabel,
      actorName: row.actorName,
      meta: row.meta,
      at: row.createdAt.toISOString(),
    }));
  }

  // ── Directory statistics ──────────────────────────────────────────────────

  /**
   * The five figures across the top of the Employees list.
   *
   * One query with FILTER clauses rather than five round trips — the numbers
   * are all over the same rows, and five separate counts could each be taken at
   * a slightly different moment and fail to add up on screen.
   */
  async stats() {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [row] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) FILTER (WHERE ${schema.employees.status} = ${EMPLOYEE_STATUS.ACTIVE})::int`,
        onLeave: sql<number>`count(*) FILTER (WHERE ${schema.employees.status} = ${EMPLOYEE_STATUS.ON_LEAVE})::int`,
        newJoiners: sql<number>`count(*) FILTER (WHERE ${schema.employees.joinedOn} >= ${isoDate(monthStart)})::int`,
        departments: sql<number>`count(DISTINCT ${schema.employees.department}) FILTER (WHERE ${schema.employees.department} IS NOT NULL)::int`,
      })
      .from(schema.employees)
      .where(isNull(schema.employees.deletedAt));

    const total = row?.total ?? 0;
    const active = row?.active ?? 0;

    return {
      total,
      active,
      // Shown under the Active card. Rounded to one place because "85.7%" is
      // what the design shows and what reads as a real measurement.
      activePercent: total > 0 ? Number(((active / total) * 100).toFixed(1)) : 0,
      onLeave: row?.onLeave ?? 0,
      onLeavePercent: total > 0 ? Number((((row?.onLeave ?? 0) / total) * 100).toFixed(1)) : 0,
      newJoiners: row?.newJoiners ?? 0,
      departments: row?.departments ?? 0,
    };
  }

  /**
   * Everything the Overview tab needs, in one call.
   *
   * The profile opens on Overview and would otherwise fire five requests to
   * paint one screen. Attendance, leave and payslip *detail* stay on their own
   * endpoints — those tabs are opened deliberately, and loading a year of
   * registers to show a summary card would be the wrong trade.
   */
  async overview(employeeId: string) {
    const employee = await this.loadEmployee(employeeId);
    const now = new Date();

    const [attendance, leave, payslips, activity] = await Promise.all([
      this.attendanceForMonth(employeeId, now.getMonth() + 1, now.getFullYear()),
      this.listLeave(employeeId),
      this.listPayslips(employeeId),
      this.activity(employeeId, 6),
    ]);

    return {
      attendanceThisMonth: attendance.summary,
      leaveSummary: leave.summary,
      pendingLeave: leave.requests.filter((request) => request.status === LEAVE_STATUS.PENDING),
      latestPayslip: payslips[0] ?? null,
      payslipCount: payslips.length,
      activity,
      onProbation: isOnProbation(employee.probationEndsOn, now),
    };
  }

  private async loadEmployee(employeeId: string) {
    const [employee] = await this.db
      .select()
      .from(schema.employees)
      .where(and(eq(schema.employees.id, employeeId), isNull(schema.employees.deletedAt)))
      .limit(1);

    if (!employee) throw new NotFoundError('Employee');
    return employee;
  }
}
