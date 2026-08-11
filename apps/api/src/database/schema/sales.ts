import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, primaryId, timestamps } from './_shared';
import { applicants } from './applicants';
import { users } from './identity';
import { records } from './records';

/**
 * ── Leads (outbound sales) ───────────────────────────────────────────────────
 *
 * People the sales team is calling who have not applied. Kept out of
 * `applicants` on purpose: that table's duplicate engine, consent ledger and
 * every report assume someone who applied, and cold prospects would both
 * distort the numbers and imply consent that was never given.
 */
export const leads = pgTable(
  'leads',
  {
    id: primaryId(),
    /** Human-facing: NBRL00001. */
    leadCode: varchar('lead_code', { length: 20 }).notNull(),

    fullName: varchar('full_name', { length: 150 }).notNull(),
    mobile: varchar('mobile', { length: 20 }).notNull(),
    /** Digits only, for the duplicate guard below. */
    mobileNormalised: varchar('mobile_normalised', { length: 20 }).notNull(),
    email: varchar('email', { length: 255 }),
    city: varchar('city', { length: 100 }),
    state: varchar('state', { length: 100 }),

    /** What they might be recognised for — the reason we are calling. */
    achievementSummary: text('achievement_summary'),
    category: varchar('category', { length: 150 }),

    status: varchar('status', { length: 30 }).notNull().default('new'),
    source: varchar('source', { length: 30 }).notNull().default('cold_call'),
    /** Free text for where an imported list came from. */
    sourceDetail: varchar('source_detail', { length: 200 }),

    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),

    /**
     * The commitment made on the last call. The sales report counts a follow-up
     * as missed when this is in the past and the lead is still open, which is
     * why it lives on the lead rather than only in the call history.
     */
    nextFollowUpAt: timestamp('next_follow_up_at', { withTimezone: true, mode: 'date' }),
    lastContactedAt: timestamp('last_contacted_at', { withTimezone: true, mode: 'date' }),
    /** Maintained alongside every logged call so list queries need no aggregate. */
    callCount: integer('call_count').notNull().default(0),

    /** Set once, at conversion. */
    convertedApplicantId: uuid('converted_applicant_id').references(() => applicants.id, {
      onDelete: 'set null',
    }),
    convertedRecordId: uuid('converted_record_id').references(() => records.id, {
      onDelete: 'set null',
    }),
    convertedAt: timestamp('converted_at', { withTimezone: true, mode: 'date' }),

    /** Why it was closed without converting — the useful half of a lost lead. */
    lostReason: varchar('lost_reason', { length: 300 }),
    notes: text('notes'),
    extra: jsonb('extra').$type<Record<string, unknown>>(),

    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    ...timestamps(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('leads_code_uq').on(t.leadCode),
    /**
     * One live lead per phone number. Two reps calling the same person from two
     * imported lists is the classic outbound failure, and it is the number —
     * not the name — that identifies them. Closed and deleted leads are excluded
     * so a person who said no last year can be approached again.
     */
    uniqueIndex('leads_mobile_open_uq')
      .on(t.mobileNormalised)
      .where(
        sql`${t.deletedAt} is null and ${t.status} not in ('converted','lost','not_interested','unqualified')`,
      ),
    index('leads_status_owner_idx').on(t.status, t.ownerUserId),
    index('leads_owner_idx').on(t.ownerUserId),
    index('leads_updated_idx').on(t.updatedAt),
    // The two hot queues: what is due today, and what has been missed.
    index('leads_follow_up_idx')
      .on(t.nextFollowUpAt)
      .where(sql`${t.nextFollowUpAt} is not null and ${t.deletedAt} is null`),
    index('leads_mobile_idx').on(t.mobileNormalised),
  ],
);

/**
 * One row per call attempt.
 *
 * Append-only in practice: a call happened or it did not, and editing history
 * to improve a day's figures is exactly what a sales report must not permit.
 * Separate from `communications` because that table is applicant-scoped and a
 * lead has no applicant yet.
 */
export const leadCalls = pgTable(
  'lead_calls',
  {
    id: primaryId(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),

    /** Who dialled. Snapshotted by name so the report still reads after they leave. */
    calledByUserId: uuid('called_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    calledByName: varchar('called_by_name', { length: 150 }),

    calledAt: timestamp('called_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    outcome: varchar('outcome', { length: 30 }).notNull(),
    durationMinutes: integer('duration_minutes'),
    summary: text('summary').notNull(),

    /** What the rep promised on this call, if anything. */
    followUpAt: timestamp('follow_up_at', { withTimezone: true, mode: 'date' }),
    /** Status the lead moved to as a result, for the conversion funnel. */
    resultingStatus: varchar('resulting_status', { length: 30 }),

    createdAt: createdAt(),
  },
  (t) => [
    index('lead_calls_lead_idx').on(t.leadId, t.calledAt),
    // The report's main query: every call by rep within a date window.
    index('lead_calls_user_date_idx').on(t.calledByUserId, t.calledAt),
    index('lead_calls_outcome_idx').on(t.outcome, t.calledAt),
  ],
);

export const leadsRelations = relations(leads, ({ one, many }) => ({
  owner: one(users, { fields: [leads.ownerUserId], references: [users.id] }),
  convertedApplicant: one(applicants, {
    fields: [leads.convertedApplicantId],
    references: [applicants.id],
  }),
  calls: many(leadCalls),
}));

export const leadCallsRelations = relations(leadCalls, ({ one }) => ({
  lead: one(leads, { fields: [leadCalls.leadId], references: [leads.id] }),
  calledBy: one(users, { fields: [leadCalls.calledByUserId], references: [users.id] }),
}));

/**
 * ── Employee directory ───────────────────────────────────────────────────────
 *
 * HR records, deliberately not the same table as `users`. Not every employee
 * has a login, an account can be deactivated while the person is still employed,
 * and the directory holds things a login has no business storing — joining date,
 * emergency contact, reporting line.
 */
export const employees = pgTable(
  'employees',
  {
    id: primaryId(),
    /** Human-facing: NBREMP001. Also what payroll and attendance quote. */
    employeeCode: varchar('employee_code', { length: 30 }).notNull(),

    fullName: varchar('full_name', { length: 150 }).notNull(),
    personalEmail: varchar('personal_email', { length: 255 }),
    workEmail: varchar('work_email', { length: 255 }),
    mobile: varchar('mobile', { length: 20 }).notNull(),
    alternatePhone: varchar('alternate_phone', { length: 20 }),
    dateOfBirth: date('date_of_birth', { mode: 'string' }),
    gender: varchar('gender', { length: 20 }),
    photoKey: varchar('photo_key', { length: 500 }),

    department: varchar('department', { length: 120 }),
    designation: varchar('designation', { length: 120 }),
    employmentType: varchar('employment_type', { length: 30 }).notNull().default('full_time'),
    status: varchar('status', { length: 30 }).notNull().default('active'),
    joinedOn: date('joined_on', { mode: 'string' }),
    exitedOn: date('exited_on', { mode: 'string' }),
    workLocation: varchar('work_location', { length: 150 }),

    /** Self-reference: who they report to. */
    reportsToEmployeeId: uuid('reports_to_employee_id'),

    /**
     * The login account, when they have one. Nullable and unique: at most one
     * account per employee, and plenty of employees with none.
     */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),

    addressLine: varchar('address_line', { length: 300 }),
    city: varchar('city', { length: 100 }),
    state: varchar('state', { length: 100 }),
    pincode: varchar('pincode', { length: 12 }),

    emergencyContactName: varchar('emergency_contact_name', { length: 150 }),
    emergencyContactPhone: varchar('emergency_contact_phone', { length: 20 }),
    emergencyContactRelation: varchar('emergency_contact_relation', { length: 60 }),
    emergencyContactAddress: varchar('emergency_contact_address', { length: 300 }),

    /**
     * ── Pay ─────────────────────────────────────────────────────────────────
     *
     * `monthlySalary` is what goes out each month; `ctc` is the annual figure
     * quoted in the offer. Both stored because the profile shows one and the
     * offer conversation uses the other, and deriving either from the other
     * assumes a fixed multiple that no real package respects.
     *
     * Nullable throughout: the directory holds contractors and volunteers with
     * no salary at all, and a zero would read as "paid nothing" rather than
     * "not applicable".
     */
    monthlySalary: numeric('monthly_salary', { precision: 12, scale: 2 }),
    ctc: numeric('ctc', { precision: 14, scale: 2 }),

    /**
     * When probation ends. A date, not a status — see `isOnProbation`.
     *
     * A fifth employee status would have to be cleared by hand on the day it
     * expired, and it never would be; a date answers the question by itself
     * and keeps being right without anyone touching it.
     */
    probationEndsOn: date('probation_ends_on', { mode: 'string' }),

    /** Payroll identity. Printed on the payslip and nowhere else. */
    panNumber: varchar('pan_number', { length: 20 }),
    bankName: varchar('bank_name', { length: 150 }),
    bankAccountNumber: varchar('bank_account_number', { length: 40 }),

    notes: text('notes'),
    /** Exited staff are retained, never deleted — history references them. */
    isDirectoryVisible: boolean('is_directory_visible').notNull().default(true),

    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    ...timestamps(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('employees_code_uq').on(t.employeeCode),
    uniqueIndex('employees_user_uq')
      .on(t.userId)
      .where(sql`${t.userId} is not null`),
    index('employees_department_idx').on(t.department, t.status),
    index('employees_status_idx').on(t.status),
    index('employees_name_idx').on(t.fullName),
  ],
);

/**
 * ── Onboarding documents ─────────────────────────────────────────────────────
 *
 * The joining file: offer letter, ID proof, education certificates, signed
 * contract. Its own table rather than a column on `employees` because there are
 * many per person and each carries its own provenance — who uploaded it, when,
 * and what the bytes hash to.
 *
 * Unlike the evidence vault (§7) these are deletable. An onboarding folder
 * accumulates mis-scans and duplicates, and HR must be able to tidy one without
 * a DBA; the delete is soft and audited, so the row and its object survive for
 * investigation.
 */
export const employeeDocuments = pgTable(
  'employee_documents',
  {
    id: primaryId(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),

    kind: varchar('kind', { length: 40 }).notNull(),
    storageKey: varchar('storage_key', { length: 500 }).notNull(),
    fileName: varchar('file_name', { length: 255 }).notNull(),
    contentType: varchar('content_type', { length: 120 }).notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    /**
     * What the browser started with, before it re-encoded the image. Equal to
     * `sizeBytes` when the file was stored untouched — PDFs are never altered.
     */
    originalSizeBytes: bigint('original_size_bytes', { mode: 'number' }),
    checksumSha256: varchar('checksum_sha256', { length: 64 }),

    description: text('description'),
    /** Government identifiers. Downloads of these are written to the audit log. */
    isSensitive: boolean('is_sensitive').notNull().default(false),

    uploadedByUserId: uuid('uploaded_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('employee_documents_employee_idx').on(t.employeeId, t.createdAt),
    uniqueIndex('employee_documents_storage_key_uq').on(t.storageKey),
    // Re-uploading identical bytes for the same person is a duplicate, not a
    // second document. Scoped to live rows so a deleted file can be re-added.
    uniqueIndex('employee_documents_checksum_uq')
      .on(t.employeeId, t.checksumSha256)
      .where(sql`${t.checksumSha256} is not null and ${t.deletedAt} is null`),
  ],
);

/**
 * ── Attendance ───────────────────────────────────────────────────────────────
 *
 * One row per person per day, and the unique index makes that literal: marking
 * the same day twice updates rather than duplicates, so a day can never hold
 * two contradictory answers.
 *
 * Non-working days are recorded rather than left blank. A missing row is
 * ambiguous — nobody marked it, or nobody was expected in? — and payroll has to
 * tell those apart to work out how many days were actually payable.
 */
export const employeeAttendance = pgTable(
  'employee_attendance',
  {
    id: primaryId(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),

    /** The day being marked, in the office's own timezone. */
    onDate: date('on_date', { mode: 'string' }).notNull(),
    status: varchar('status', { length: 30 }).notNull(),

    /** Wall-clock times as typed. Null when only the status was recorded. */
    checkInAt: timestamp('check_in_at', { withTimezone: true, mode: 'date' }),
    checkOutAt: timestamp('check_out_at', { withTimezone: true, mode: 'date' }),
    workedMinutes: integer('worked_minutes'),

    remarks: text('remarks'),

    markedByUserId: uuid('marked_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Snapshotted so the register still reads after the marker leaves. */
    markedByName: varchar('marked_by_name', { length: 150 }),

    ...timestamps(),
  },
  (t) => [
    uniqueIndex('employee_attendance_day_uq').on(t.employeeId, t.onDate),
    index('employee_attendance_date_idx').on(t.onDate),
    index('employee_attendance_status_idx').on(t.employeeId, t.status),
  ],
);

/**
 * ── Leave ────────────────────────────────────────────────────────────────────
 *
 * A request, and the decision taken on it. Both live on one row because the
 * decision is only ever about one request, and splitting them would make
 * "approved but by whom?" a join nobody remembers to write.
 *
 * `days` is stored rather than derived from the dates: half-days exist, and a
 * public holiday inside a range should not be charged to the employee's
 * balance. Whoever files the request states the number and it is what payroll
 * reads.
 */
export const employeeLeaveRequests = pgTable(
  'employee_leave_requests',
  {
    id: primaryId(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),

    leaveType: varchar('leave_type', { length: 30 }).notNull(),
    fromDate: date('from_date', { mode: 'string' }).notNull(),
    toDate: date('to_date', { mode: 'string' }).notNull(),
    /** Working days claimed. Halves are legitimate, hence not an integer. */
    days: numeric('days', { precision: 5, scale: 1 }).notNull(),
    reason: text('reason').notNull(),

    status: varchar('status', { length: 20 }).notNull().default('pending'),
    decidedByUserId: uuid('decided_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    decidedByName: varchar('decided_by_name', { length: 150 }),
    decidedAt: timestamp('decided_at', { withTimezone: true, mode: 'date' }),
    /** Why it was refused, or any condition attached to an approval. */
    decisionNote: text('decision_note'),

    appliedByUserId: uuid('applied_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    appliedByName: varchar('applied_by_name', { length: 150 }),

    ...timestamps(),
  },
  (t) => [
    index('employee_leave_employee_idx').on(t.employeeId, t.fromDate),
    index('employee_leave_status_idx').on(t.status, t.fromDate),
  ],
);

/**
 * ── Payslips ─────────────────────────────────────────────────────────────────
 *
 * Every figure is copied onto the row at generation and never recomputed.
 *
 * That is the whole design. A payslip is a statement of what somebody was paid
 * in a particular month; deriving it on read means a salary revision in
 * September silently rewrites what March says, and the one document an employee
 * keeps for a loan application stops matching the one the system prints. The
 * salary, the day counts and the deductions are all frozen here.
 */
export const employeePayslips = pgTable(
  'employee_payslips',
  {
    id: primaryId(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),

    /** 1–12 and a four-digit year, rather than a date, because a payslip is a period. */
    periodMonth: integer('period_month').notNull(),
    periodYear: integer('period_year').notNull(),
    /** NBR/PS/2026-27/00042 — quoted by the employee and by accounts. */
    payslipNumber: varchar('payslip_number', { length: 60 }).notNull(),

    /** The salary as it stood when this was generated. */
    monthlySalary: numeric('monthly_salary', { precision: 12, scale: 2 }).notNull(),

    /** How the month actually went, frozen alongside the money. */
    workingDays: numeric('working_days', { precision: 5, scale: 1 }).notNull(),
    payableDays: numeric('payable_days', { precision: 5, scale: 1 }).notNull(),
    lopDays: numeric('lop_days', { precision: 5, scale: 1 }).notNull().default('0.0'),

    grossPay: numeric('gross_pay', { precision: 12, scale: 2 }).notNull(),
    totalDeductions: numeric('total_deductions', { precision: 12, scale: 2 })
      .notNull()
      .default('0.00'),
    netPay: numeric('net_pay', { precision: 12, scale: 2 }).notNull(),

    /**
     * The named lines, as `[{ label, amount }]`.
     *
     * JSON rather than two more tables: the components differ per organisation
     * and change over time, and a payslip only ever reads them back as printed
     * rows. Nothing queries an individual allowance.
     */
    earnings: jsonb('earnings').$type<Array<{ label: string; amount: string }>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    deductions: jsonb('deductions').$type<Array<{ label: string; amount: string }>>()
      .notNull()
      .default(sql`'[]'::jsonb`),

    status: varchar('status', { length: 20 }).notNull().default('issued'),
    remarks: text('remarks'),

    generatedByUserId: uuid('generated_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    generatedByName: varchar('generated_by_name', { length: 150 }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('employee_payslips_number_uq').on(t.payslipNumber),
    // One payslip per person per month. A correction cancels and re-issues
    // rather than quietly producing a second slip for the same period.
    uniqueIndex('employee_payslips_period_uq')
      .on(t.employeeId, t.periodYear, t.periodMonth)
      .where(sql`${t.status} <> 'cancelled'`),
    index('employee_payslips_employee_idx').on(t.employeeId, t.periodYear, t.periodMonth),
  ],
);

export const employeeAttendanceRelations = relations(employeeAttendance, ({ one }) => ({
  employee: one(employees, {
    fields: [employeeAttendance.employeeId],
    references: [employees.id],
  }),
}));

export const employeeLeaveRequestsRelations = relations(employeeLeaveRequests, ({ one }) => ({
  employee: one(employees, {
    fields: [employeeLeaveRequests.employeeId],
    references: [employees.id],
  }),
}));

export const employeePayslipsRelations = relations(employeePayslips, ({ one }) => ({
  employee: one(employees, {
    fields: [employeePayslips.employeeId],
    references: [employees.id],
  }),
}));

export const employeesRelations = relations(employees, ({ one, many }) => ({
  account: one(users, { fields: [employees.userId], references: [users.id] }),
  reportsTo: one(employees, {
    fields: [employees.reportsToEmployeeId],
    references: [employees.id],
    relationName: 'reporting_line',
  }),
  reports: many(employees, { relationName: 'reporting_line' }),
  documents: many(employeeDocuments),
}));

export const employeeDocumentsRelations = relations(employeeDocuments, ({ one }) => ({
  employee: one(employees, {
    fields: [employeeDocuments.employeeId],
    references: [employees.id],
  }),
  uploadedBy: one(users, {
    fields: [employeeDocuments.uploadedByUserId],
    references: [users.id],
  }),
}));
