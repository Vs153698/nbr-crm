import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, primaryId, timestamps } from './_shared';
import { applicants } from './applicants';
import { users } from './identity';
import { records } from './records';

/** §9 Payment packages. Editable from Settings (§26). */
export const packages = pgTable(
  'packages',
  {
    id: primaryId(),
    name: varchar('name', { length: 120 }).notNull(),
    description: text('description'),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    gstPercent: numeric('gst_percent', { precision: 5, scale: 2 }).notNull().default('18.00'),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),

    /**
     * The public website's own code for this package, when it mirrors one.
     *
     * Set by the package sync. Its whole purpose is that a payment recorded
     * here pushes back carrying the exact code the website's payments table
     * expects, instead of being guessed at from the amount. Null for packages
     * that only exist in the CRM — those still fall back to the website's
     * name-and-amount matching.
     */
    legacyCode: varchar('legacy_code', { length: 60 }),

    /**
     * The website's `payment_plans.id` for this package.
     *
     * The code alone is not a stable identity: the website's payments table
     * constrains `plan` to three literals, so a renamed or re-priced plan keeps
     * the same code and the sync cannot tell it apart from a different plan
     * that reused it. Carrying the id means a payment pushed from here names
     * the exact row the website priced, and re-running the sync updates that
     * row rather than creating a second package beside it.
     *
     * Null for CRM-only packages, and for anything mirrored before this column
     * existed — the code stays the fallback.
     */
    legacyPlanId: uuid('legacy_plan_id'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('packages_name_uq').on(t.name),
    uniqueIndex('packages_legacy_code_uq')
      .on(t.legacyCode)
      .where(sql`${t.legacyCode} is not null`),
  ],
);

/**
 * ── Payment plan (§9) ────────────────────────────────────────────────────────
 *
 * One plan per record. Money is NUMERIC(12,2) — never a float — and
 * `finalAmount` is validated by a CHECK constraint against
 * `amount - discount + gstAmount` so the invoice total can never silently
 * disagree with its own line items.
 *
 * `status` is *derived* from SUM(transactions) vs finalAmount by the service
 * layer; it is stored only so list queries don't need an aggregate per row.
 */
export const payments = pgTable(
  'payments',
  {
    id: primaryId(),
    recordId: uuid('record_id')
      .notNull()
      .references(() => records.id, { onDelete: 'restrict' }),
    applicantId: uuid('applicant_id')
      .notNull()
      .references(() => applicants.id, { onDelete: 'restrict' }),

    packageId: uuid('package_id').references(() => packages.id, { onDelete: 'set null' }),
    /** Snapshotted: renaming a package must not rewrite historical invoices. */
    packageName: varchar('package_name', { length: 120 }).notNull(),

    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    discount: numeric('discount', { precision: 12, scale: 2 }).notNull().default('0.00'),
    taxableValue: numeric('taxable_value', { precision: 12, scale: 2 }).notNull(),
    gstPercent: numeric('gst_percent', { precision: 5, scale: 2 }).notNull().default('18.00'),
    gstAmount: numeric('gst_amount', { precision: 12, scale: 2 }).notNull(),
    finalAmount: numeric('final_amount', { precision: 12, scale: 2 }).notNull(),

    /** Maintained inside the same transaction as every transaction insert. */
    amountPaid: numeric('amount_paid', { precision: 12, scale: 2 }).notNull().default('0.00'),
    status: varchar('status', { length: 30 }).notNull().default('pending'),

    dueDate: timestamp('due_date', { withTimezone: true, mode: 'date' }),
    settledAt: timestamp('settled_at', { withTimezone: true, mode: 'date' }),
    /** §11 stage 5 — the panel shows a reminder counter. */
    reminderCount: integer('reminder_count').notNull().default(0),
    lastReminderAt: timestamp('last_reminder_at', { withTimezone: true, mode: 'date' }),

    notes: text('notes'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('payments_record_uq').on(t.recordId),
    index('payments_applicant_idx').on(t.applicantId),
    index('payments_status_due_idx').on(t.status, t.dueDate),
    // Hot queue: overdue payments for the notifications job and the §24 report.
    index('payments_overdue_idx')
      .on(t.dueDate)
      .where(sql`${t.status} in ('pending', 'partial')`),
    index('payments_settled_idx')
      .on(t.settledAt)
      .where(sql`${t.settledAt} is not null`),
  ],
);

/**
 * Individual receipts against a plan (§9 "Support partial and multiple
 * payments"). Append-only in practice: a mistaken entry is reversed with a
 * negative-amount correction row carrying a reason, never edited away.
 */
export const paymentTransactions = pgTable(
  'payment_transactions',
  {
    id: primaryId(),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id, { onDelete: 'restrict' }),
    recordId: uuid('record_id')
      .notNull()
      .references(() => records.id, { onDelete: 'restrict' }),

    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    paidOn: timestamp('paid_on', { withTimezone: true, mode: 'date' }).notNull(),
    mode: varchar('mode', { length: 30 }).notNull(),
    transactionRef: varchar('transaction_ref', { length: 120 }),
    receiptKey: varchar('receipt_key', { length: 500 }),
    remarks: text('remarks'),

    /** True for a reversal row. */
    isReversal: boolean('is_reversal').notNull().default(false),
    reversesTransactionId: uuid('reverses_transaction_id'),

    /** Makes a double-submitted payment form record exactly one payment. */
    idempotencyKey: varchar('idempotency_key', { length: 120 }),

    recordedByUserId: uuid('recorded_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
  },
  (t) => [
    index('payment_transactions_payment_idx').on(t.paymentId, t.paidOn),
    index('payment_transactions_record_idx').on(t.recordId),
    index('payment_transactions_paid_on_idx').on(t.paidOn),
    uniqueIndex('payment_transactions_idempotency_uq')
      .on(t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
    uniqueIndex('payment_transactions_ref_uq')
      .on(t.paymentId, t.transactionRef)
      .where(sql`${t.transactionRef} is not null`),
  ],
);

/** §9 Invoice numbering, financial-year scoped: NBR/INV/2026-27/00042. */
export const invoices = pgTable(
  'invoices',
  {
    id: primaryId(),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id, { onDelete: 'restrict' }),
    recordId: uuid('record_id')
      .notNull()
      .references(() => records.id, { onDelete: 'restrict' }),
    invoiceNumber: varchar('invoice_number', { length: 60 }).notNull(),
    financialYear: varchar('financial_year', { length: 10 }).notNull(),
    issuedOn: timestamp('issued_on', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    /** Every figure frozen at issue time — a later package price change must
     *  not retroactively alter a document already sent to an applicant. */
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    discount: numeric('discount', { precision: 12, scale: 2 }).notNull(),
    gstAmount: numeric('gst_amount', { precision: 12, scale: 2 }).notNull(),
    finalAmount: numeric('final_amount', { precision: 12, scale: 2 }).notNull(),
    pdfKey: varchar('pdf_key', { length: 500 }),
    /** cancelled invoices keep their number; a credit note replaces them. */
    cancelledAt: timestamp('cancelled_at', { withTimezone: true, mode: 'date' }),
    cancelReason: text('cancel_reason'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('invoices_number_uq').on(t.invoiceNumber),
    index('invoices_payment_idx').on(t.paymentId),
    index('invoices_fy_idx').on(t.financialYear, t.issuedOn),
  ],
);

export const paymentsRelations = relations(payments, ({ one, many }) => ({
  record: one(records, { fields: [payments.recordId], references: [records.id] }),
  package: one(packages, { fields: [payments.packageId], references: [packages.id] }),
  transactions: many(paymentTransactions),
  invoices: many(invoices),
}));

export const paymentTransactionsRelations = relations(paymentTransactions, ({ one }) => ({
  payment: one(payments, { fields: [paymentTransactions.paymentId], references: [payments.id] }),
  recordedBy: one(users, {
    fields: [paymentTransactions.recordedByUserId],
    references: [users.id],
  }),
}));

export const invoicesRelations = relations(invoices, ({ one }) => ({
  payment: one(payments, { fields: [invoices.paymentId], references: [payments.id] }),
}));
