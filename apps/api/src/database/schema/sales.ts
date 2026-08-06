import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
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

export const employeesRelations = relations(employees, ({ one, many }) => ({
  account: one(users, { fields: [employees.userId], references: [users.id] }),
  reportsTo: one(employees, {
    fields: [employees.reportsToEmployeeId],
    references: [employees.id],
    relationName: 'reporting_line',
  }),
  reports: many(employees, { relationName: 'reporting_line' }),
}));
