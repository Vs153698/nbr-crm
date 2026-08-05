import { Inject, Injectable } from '@nestjs/common';
import {
  computePaymentPlan,
  financialYearOf,
  formatInvoiceNumber,
  PAYMENT_STATUS,
  settle,
  TIMELINE_EVENT,
  toPaise,
  toRupees,
  type PaymentStatus,
} from '@nbr/shared';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { AUDIT, AuditService } from '../audit/audit.service';
import { ConflictError, NotFoundError, ValidationError } from '../common/errors';
import { requireActor } from '../common/request-context';
import type { Database } from '../database/client';
import { DB } from '../database/database.tokens';
import * as schema from '../database/schema';
import { LegacyPushService } from '../integrations/legacy-push.service';
import { CacheService, CacheTag } from '../redis/cache.service';
import { TimelineService } from '../timeline/timeline.service';

export interface PaymentSummary {
  readonly id: string;
  readonly packageName: string;
  readonly amount: string;
  readonly discount: string;
  readonly taxableValue: string;
  readonly gstPercent: string;
  readonly gstAmount: string;
  readonly finalAmount: string;
  readonly amountPaid: string;
  readonly balanceDue: string;
  readonly status: PaymentStatus;
  readonly dueDate: string | null;
  readonly daysRemaining: number | null;
  readonly overdue: boolean;
  readonly reminderCount: number;
  readonly settledAt: string | null;
  readonly transactions: ReadonlyArray<{
    id: string;
    amount: string;
    paidOn: string;
    mode: string;
    transactionRef: string | null;
    remarks: string | null;
    isReversal: boolean;
    recordedByName: string | null;
  }>;
  readonly invoices: ReadonlyArray<{
    id: string;
    invoiceNumber: string;
    issuedOn: string;
    finalAmount: string;
    cancelledAt: string | null;
  }>;
}

/**
 * Payments (§9, P2-01).
 *
 * Two rules drive every method here:
 *
 *  • **The money is computed, never trusted.** The client sends a package and a
 *    discount; the server derives taxable value, GST and the final amount using
 *    the same integer-paise helper the browser used, and the database CHECK
 *    constraints reject the row if they disagree. A tampered payload cannot
 *    produce a wrong invoice.
 *  • **Status is derived from the transactions.** `payments.status` exists only
 *    so list queries avoid an aggregate per row; it is recomputed from
 *    SUM(transactions) inside the same transaction as every insert, so it can
 *    never drift from the money that actually arrived.
 */
@Injectable()
export class PaymentsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly timeline: TimelineService,
    private readonly audit: AuditService,
    private readonly cache: CacheService,
    private readonly legacy: LegacyPushService,
  ) {}

  /** §11 stage 4 — "Set Payment Deadline". Creates or replaces the plan. */
  async createPlan(input: {
    recordId: string;
    packageId?: string;
    packageName: string;
    amount: string;
    gstPercent: string;
    discount: string;
    dueDate?: Date;
    notes?: string;
  }): Promise<{ paymentId: string; finalAmount: string }> {
    const actor = requireActor();

    const record = await this.loadRecord(input.recordId);

    // Derived server-side. The client's arithmetic is a convenience for the
    // form preview and is never persisted.
    const plan = computePaymentPlan({
      amount: input.amount,
      gstPercent: input.gstPercent,
      discount: input.discount,
    });

    const [existing] = await this.db
      .select({ id: schema.payments.id, amountPaid: schema.payments.amountPaid })
      .from(schema.payments)
      .where(eq(schema.payments.recordId, input.recordId))
      .limit(1);

    // Re-pricing after money has arrived would strand the payments already
    // recorded — the amount owed must never drop below what was collected.
    if (existing && toPaise(existing.amountPaid) > toPaise(plan.finalAmount)) {
      throw new ConflictError(
        'PLAN_BELOW_PAID',
        `₹${existing.amountPaid} has already been received against this record. The new total of ₹${plan.finalAmount} would be less than that — record a refund instead.`,
      );
    }

    const paymentId = await this.db.transaction(async (tx) => {
      const values = {
        recordId: input.recordId,
        applicantId: record.applicantId,
        packageId: input.packageId ?? null,
        packageName: input.packageName,
        amount: plan.amount,
        discount: plan.discount,
        taxableValue: plan.taxableValue,
        gstPercent: plan.gstPercent,
        gstAmount: plan.gstAmount,
        finalAmount: plan.finalAmount,
        dueDate: input.dueDate ?? null,
        notes: input.notes ?? null,
        createdByUserId: actor.userId,
      };

      const [row] = await tx
        .insert(schema.payments)
        .values(values)
        .onConflictDoUpdate({ target: schema.payments.recordId, set: values })
        .returning({ id: schema.payments.id });

      const id = row!.id;
      await this.recomputeStatus(tx, id);

      await this.timeline.write(
        {
          applicantId: record.applicantId,
          recordId: input.recordId,
          eventType: TIMELINE_EVENT.PAYMENT_PLAN_CREATED,
          summary: `Payment raised — ${input.packageName}, ₹${plan.finalAmount}`,
          meta: {
            packageName: input.packageName,
            finalAmount: plan.finalAmount,
            dueDate: input.dueDate?.toISOString() ?? null,
          },
        },
        tx,
      );

      await this.audit.record(
        {
          action: AUDIT.PAYMENT_PLAN_CREATED,
          entityType: 'payment',
          entityId: id,
          entityLabel: `${record.recordCode} — ${input.packageName}`,
          meta: { ...plan, dueDate: input.dueDate?.toISOString() ?? null },
        },
        tx,
      );

      return id;
    });

    await this.bust(input.recordId, record.applicantId);
    return { paymentId, finalAmount: plan.finalAmount };
  }

  /**
   * M-03 Record Payment. Supports partial and multiple payments (§9).
   *
   * `idempotencyKey` makes a double-submitted form record one payment — the
   * unique index means the second attempt collides rather than double-charging
   * the applicant's ledger.
   */
  async recordTransaction(input: {
    paymentId: string;
    amount: string;
    paidOn: Date;
    mode: string;
    transactionRef?: string;
    receiptKey?: string;
    remarks?: string;
    idempotencyKey?: string;
  }): Promise<{ transactionId: string; settlement: ReturnType<typeof settle> }> {
    const actor = requireActor();

    const [payment] = await this.db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, input.paymentId))
      .limit(1);

    if (!payment) throw new NotFoundError('Payment');

    const record = await this.loadRecord(payment.recordId);

    // Reject an overpayment up front with a clear message rather than letting
    // the CHECK constraint surface as a generic database error.
    const balancePaise = toPaise(payment.finalAmount) - toPaise(payment.amountPaid);
    if (toPaise(input.amount) > balancePaise) {
      throw new ValidationError({
        amount: [
          `That is more than the ₹${toRupees(balancePaise)} outstanding. Record the exact balance, or raise the package amount first.`,
        ],
      });
    }

    const result = await this.db.transaction(async (tx) => {
      const [transaction] = await tx
        .insert(schema.paymentTransactions)
        .values({
          paymentId: input.paymentId,
          recordId: payment.recordId,
          amount: input.amount,
          paidOn: input.paidOn,
          mode: input.mode,
          transactionRef: input.transactionRef ?? null,
          receiptKey: input.receiptKey ?? null,
          remarks: input.remarks ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
          recordedByUserId: actor.userId,
        })
        .returning({ id: schema.paymentTransactions.id });

      const settlement = await this.recomputeStatus(tx, input.paymentId);

      await this.timeline.write(
        {
          applicantId: payment.applicantId,
          recordId: payment.recordId,
          eventType: settlement.isSettled
            ? TIMELINE_EVENT.PAYMENT_SETTLED
            : TIMELINE_EVENT.PAYMENT_RECORDED,
          summary: settlement.isSettled
            ? `Payment complete — ₹${settlement.amountPaid} received in full`
            : `Payment received — ₹${input.amount} (₹${settlement.balanceDue} still due)`,
          meta: {
            amount: input.amount,
            mode: input.mode,
            transactionRef: input.transactionRef ?? null,
            balanceDue: settlement.balanceDue,
          },
        },
        tx,
      );

      await this.audit.record(
        {
          action: AUDIT.PAYMENT_RECORDED,
          entityType: 'payment',
          entityId: input.paymentId,
          entityLabel: `${record.recordCode} — ₹${input.amount}`,
          meta: { mode: input.mode, transactionRef: input.transactionRef ?? null },
        },
        tx,
      );

      return { transactionId: transaction!.id, settlement };
    });

    await this.bust(payment.recordId, payment.applicantId);

    // Mirror the receipt onto the public site so its applicant portal, its
    // invoice and its dispatch queue agree with ours. A no-op for records that
    // only exist here, and for a receipt that came from there in the first
    // place. Detached: the operator has already been answered.
    void this.legacy.pushPayment(payment.recordId, {
      plan: payment.packageName,
      // Resolves to the website's own plan code when this package mirrors one,
      // so the push carries the exact code rather than a name to be matched.
      packageId: payment.packageId,
      amountPaise: toPaise(input.amount),
      method: input.mode,
      referenceNumber: input.transactionRef ?? `CRM-${result.transactionId}`,
      notes: input.remarks,
    });

    return result;
  }

  /**
   * Reverse a mistaken entry.
   *
   * Appends a negative-amount row rather than deleting the original, so the
   * ledger shows both the error and its correction. `payment_transactions` has
   * a CHECK constraint that only a reversal may carry a negative amount.
   */
  async reverseTransaction(
    transactionId: string,
    reason: string,
  ): Promise<{ reversalId: string }> {
    const actor = requireActor();

    const [original] = await this.db
      .select()
      .from(schema.paymentTransactions)
      .where(eq(schema.paymentTransactions.id, transactionId))
      .limit(1);

    if (!original) throw new NotFoundError('Transaction');
    if (original.isReversal) {
      throw new ConflictError('ALREADY_REVERSAL', 'A reversal cannot itself be reversed.');
    }

    const [alreadyReversed] = await this.db
      .select({ id: schema.paymentTransactions.id })
      .from(schema.paymentTransactions)
      .where(eq(schema.paymentTransactions.reversesTransactionId, transactionId))
      .limit(1);

    if (alreadyReversed) {
      throw new ConflictError('ALREADY_REVERSED', 'This payment has already been reversed.');
    }

    const payment = await this.db
      .select({ applicantId: schema.payments.applicantId, recordId: schema.payments.recordId })
      .from(schema.payments)
      .where(eq(schema.payments.id, original.paymentId))
      .limit(1);

    const context = payment[0];
    if (!context) throw new NotFoundError('Payment');

    const reversalId = await this.db.transaction(async (tx) => {
      const [reversal] = await tx
        .insert(schema.paymentTransactions)
        .values({
          paymentId: original.paymentId,
          recordId: original.recordId,
          amount: toRupees(-toPaise(original.amount)),
          paidOn: new Date(),
          mode: original.mode,
          transactionRef: original.transactionRef,
          remarks: reason,
          isReversal: true,
          reversesTransactionId: transactionId,
          recordedByUserId: actor.userId,
        })
        .returning({ id: schema.paymentTransactions.id });

      await this.recomputeStatus(tx, original.paymentId);

      await this.timeline.write(
        {
          applicantId: context.applicantId,
          recordId: context.recordId,
          eventType: TIMELINE_EVENT.PAYMENT_RECORDED,
          summary: `Payment reversed — ₹${original.amount}`,
          meta: { reason, reversedTransactionId: transactionId },
        },
        tx,
      );

      await this.audit.record(
        {
          action: AUDIT.PAYMENT_REVERSED,
          entityType: 'payment',
          entityId: original.paymentId,
          entityLabel: `₹${original.amount} reversed`,
          meta: { reason, transactionId },
        },
        tx,
      );

      return reversal!.id;
    });

    await this.bust(context.recordId, context.applicantId);
    return { reversalId };
  }

  /**
   * Allocate an invoice number and freeze the figures.
   *
   * Every amount is copied onto the invoice rather than referenced, because a
   * later package price change must not retroactively alter a document already
   * sent to an applicant.
   */
  async generateInvoice(paymentId: string): Promise<{ invoiceNumber: string; invoiceId: string }> {
    const actor = requireActor();

    const [payment] = await this.db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, paymentId))
      .limit(1);

    if (!payment) throw new NotFoundError('Payment');

    const [existing] = await this.db
      .select({ id: schema.invoices.id, invoiceNumber: schema.invoices.invoiceNumber })
      .from(schema.invoices)
      .where(and(eq(schema.invoices.paymentId, paymentId), isNull(schema.invoices.cancelledAt)))
      .limit(1);

    if (existing) {
      return { invoiceId: existing.id, invoiceNumber: existing.invoiceNumber };
    }

    const record = await this.loadRecord(payment.recordId);
    const financialYear = financialYearOf();

    return this.db.transaction(async (tx) => {
      // next_in_series locks the counter row, so two concurrent issues cannot
      // take the same number.
      const result = await tx.execute<{ next_in_series: number }>(
        sql`SELECT next_in_series('invoice', ${financialYear}) AS next_in_series`,
      );
      const sequence = Number(
        (result as unknown as Array<{ next_in_series: number }>)[0]!.next_in_series,
      );
      const invoiceNumber = formatInvoiceNumber(financialYear, sequence);

      const [invoice] = await tx
        .insert(schema.invoices)
        .values({
          paymentId,
          recordId: payment.recordId,
          invoiceNumber,
          financialYear,
          amount: payment.amount,
          discount: payment.discount,
          gstAmount: payment.gstAmount,
          finalAmount: payment.finalAmount,
          createdByUserId: actor.userId,
        })
        .returning({ id: schema.invoices.id });

      await this.timeline.write(
        {
          applicantId: payment.applicantId,
          recordId: payment.recordId,
          eventType: TIMELINE_EVENT.INVOICE_GENERATED,
          summary: `Invoice ${invoiceNumber} generated — ₹${payment.finalAmount}`,
          meta: { invoiceNumber, finalAmount: payment.finalAmount },
        },
        tx,
      );

      await this.audit.record(
        {
          action: AUDIT.INVOICE_GENERATED,
          entityType: 'invoice',
          entityId: invoice!.id,
          entityLabel: `${invoiceNumber} — ${record.recordCode}`,
        },
        tx,
      );

      return { invoiceId: invoice!.id, invoiceNumber };
    });
  }

  /** Counts a reminder send, for the §11 stage-5 reminder counter. */
  async noteReminderSent(paymentId: string): Promise<void> {
    await this.db
      .update(schema.payments)
      .set({
        reminderCount: sql`${schema.payments.reminderCount} + 1`,
        lastReminderAt: new Date(),
      })
      .where(eq(schema.payments.id, paymentId));
  }

  async getByRecord(recordId: string): Promise<PaymentSummary | null> {
    const [payment] = await this.db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.recordId, recordId))
      .limit(1);

    if (!payment) return null;

    const [transactions, invoices] = await Promise.all([
      this.db
        .select({
          id: schema.paymentTransactions.id,
          amount: schema.paymentTransactions.amount,
          paidOn: schema.paymentTransactions.paidOn,
          mode: schema.paymentTransactions.mode,
          transactionRef: schema.paymentTransactions.transactionRef,
          remarks: schema.paymentTransactions.remarks,
          isReversal: schema.paymentTransactions.isReversal,
          recordedByName: schema.users.fullName,
        })
        .from(schema.paymentTransactions)
        .leftJoin(schema.users, eq(schema.paymentTransactions.recordedByUserId, schema.users.id))
        .where(eq(schema.paymentTransactions.paymentId, payment.id))
        .orderBy(desc(schema.paymentTransactions.paidOn)),

      this.db
        .select({
          id: schema.invoices.id,
          invoiceNumber: schema.invoices.invoiceNumber,
          issuedOn: schema.invoices.issuedOn,
          finalAmount: schema.invoices.finalAmount,
          cancelledAt: schema.invoices.cancelledAt,
        })
        .from(schema.invoices)
        .where(eq(schema.invoices.paymentId, payment.id))
        .orderBy(desc(schema.invoices.issuedOn)),
    ]);

    const balancePaise = toPaise(payment.finalAmount) - toPaise(payment.amountPaid);
    const daysRemaining = payment.dueDate
      ? Math.ceil((payment.dueDate.getTime() - Date.now()) / 86_400_000)
      : null;

    return {
      id: payment.id,
      packageName: payment.packageName,
      amount: payment.amount,
      discount: payment.discount,
      taxableValue: payment.taxableValue,
      gstPercent: payment.gstPercent,
      gstAmount: payment.gstAmount,
      finalAmount: payment.finalAmount,
      amountPaid: payment.amountPaid,
      balanceDue: toRupees(Math.max(balancePaise, 0)),
      status: payment.status as PaymentStatus,
      dueDate: payment.dueDate?.toISOString() ?? null,
      daysRemaining,
      overdue: daysRemaining !== null && daysRemaining < 0 && balancePaise > 0,
      reminderCount: payment.reminderCount,
      settledAt: payment.settledAt?.toISOString() ?? null,
      transactions: transactions.map((t) => ({ ...t, paidOn: t.paidOn.toISOString() })),
      invoices: invoices.map((i) => ({
        ...i,
        issuedOn: i.issuedOn.toISOString(),
        cancelledAt: i.cancelledAt?.toISOString() ?? null,
      })),
    };
  }

  /**
   * Recompute `amountPaid` and `status` from the transaction rows.
   *
   * Always called inside the caller's transaction, so the denormalised columns
   * and the ledger they summarise are committed together or not at all.
   */
  private async recomputeStatus(tx: Database, paymentId: string) {
    const [payment] = await tx
      .select({
        finalAmount: schema.payments.finalAmount,
        recordId: schema.payments.recordId,
      })
      .from(schema.payments)
      .where(eq(schema.payments.id, paymentId))
      .limit(1);

    if (!payment) throw new NotFoundError('Payment');

    const rows = await tx
      .select({ amount: schema.paymentTransactions.amount })
      .from(schema.paymentTransactions)
      .where(eq(schema.paymentTransactions.paymentId, paymentId));

    const settlement = settle({
      finalAmount: payment.finalAmount,
      transactions: rows.map((row) => row.amount),
    });

    const status: PaymentStatus = settlement.isSettled
      ? PAYMENT_STATUS.PAID
      : settlement.isPartial
        ? PAYMENT_STATUS.PARTIAL
        : PAYMENT_STATUS.PENDING;

    await tx
      .update(schema.payments)
      .set({
        amountPaid: settlement.amountPaid,
        status,
        settledAt: settlement.isSettled ? new Date() : null,
      })
      .where(eq(schema.payments.id, paymentId));

    // Mirrored onto the record so the applicant list renders its Payment
    // column without joining.
    await tx
      .update(schema.records)
      .set({ paymentStatus: status })
      .where(eq(schema.records.id, payment.recordId));

    return settlement;
  }

  private async loadRecord(recordId: string) {
    const [record] = await this.db
      .select({
        id: schema.records.id,
        recordCode: schema.records.recordCode,
        applicantId: schema.records.applicantId,
      })
      .from(schema.records)
      .where(and(eq(schema.records.id, recordId), isNull(schema.records.deletedAt)))
      .limit(1);

    if (!record) throw new NotFoundError('Record');
    return record;
  }

  private async bust(recordId: string, applicantId: string) {
    await this.cache.invalidateTags(
      CacheTag.record(recordId),
      CacheTag.applicant(applicantId),
      CacheTag.applicantList(),
      CacheTag.dashboard(),
      CacheTag.reports(),
    );
  }
}
