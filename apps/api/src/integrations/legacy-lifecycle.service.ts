import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DELIVERY_STATUS,
  LEGACY_STAGE_RANK,
  LEGACY_STAGE_TO_STATUS,
  PAYMENT_MODE,
  PAYMENT_STATUS,
  TIMELINE_EVENT,
  toPaise,
  toRupees,
  type LegacyStage,
  type NbrWebhookApplication,
  type PaymentMode,
  type RecordStatus,
} from '@nbr/shared';
import { and, eq, sql } from 'drizzle-orm';
import { INTEGRATION_ACTOR_NAME } from '../common/request-context';
import type { Database } from '../database/client';
import { DB } from '../database/database.tokens';
import * as schema from '../database/schema';
import { TimelineService } from '../timeline/timeline.service';

/** Payment modes the legacy system can send, mapped onto ours. */
const LEGACY_MODE_MAP: Readonly<Record<string, PaymentMode>> = {
  upi: PAYMENT_MODE.UPI,
  bank_transfer: PAYMENT_MODE.BANK_TRANSFER,
  neft: PAYMENT_MODE.BANK_TRANSFER,
  rtgs: PAYMENT_MODE.BANK_TRANSFER,
  dd: PAYMENT_MODE.CHEQUE,
  cheque: PAYMENT_MODE.CHEQUE,
  cash: PAYMENT_MODE.CASH,
  razorpay: PAYMENT_MODE.RAZORPAY,
  other: PAYMENT_MODE.OTHER,
};

/** Legacy dispatch statuses mapped onto the CRM's delivery vocabulary. */
const LEGACY_DELIVERY_MAP: Readonly<Record<string, string>> = {
  pending: DELIVERY_STATUS.NOT_DISPATCHED,
  preparing: DELIVERY_STATUS.PACKED,
  dispatched: DELIVERY_STATUS.DISPATCHED,
  delivered: DELIVERY_STATUS.DELIVERED,
};

/** Package name used when the legacy plan has no counterpart in our catalogue. */
const IMPORTED_PACKAGE_PREFIX = 'Website';

export interface ApplyResult {
  readonly statusChanged: boolean;
  readonly paymentApplied: boolean;
  readonly certificateApplied: boolean;
  readonly dispatchApplied: boolean;
}

/**
 * Applies the lifecycle blocks of a legacy snapshot onto a CRM record.
 *
 * Every method here is idempotent against the same input, because the legacy
 * system sends a full snapshot on every event and the same snapshot may arrive
 * more than once — a retry, a replay from the operations screen, or a backfill
 * run over applications that were already synced.
 *
 * The rule throughout is **merge forward, never backward**. A snapshot can add
 * a payment the CRM did not know about, or move a record from Payment Received
 * to Dispatched. It cannot un-issue a certificate or drag a completed record
 * back to Selected, because the most likely cause of a backwards-looking
 * snapshot is a late delivery rather than a real reversal.
 */
@Injectable()
export class LegacyLifecycleService {
  private readonly logger = new Logger(LegacyLifecycleService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly timeline: TimelineService,
  ) {}

  /**
   * Apply every lifecycle block present in the payload.
   *
   * `tx` is required: the caller runs this inside the same transaction that
   * created or located the record, so a half-applied snapshot cannot survive.
   */
  async apply(
    tx: Database,
    input: {
      recordId: string;
      applicantId: string;
      currentStatus: RecordStatus;
      payload: NbrWebhookApplication;
    },
  ): Promise<ApplyResult> {
    const { recordId, applicantId, payload } = input;

    const paymentApplied = await this.applyPayment(tx, recordId, applicantId, payload);
    const certificateApplied = await this.applyCertificate(tx, recordId, applicantId, payload);
    const dispatchApplied = await this.applyDispatch(tx, recordId, applicantId, payload);
    const statusChanged = await this.applyStatus(tx, recordId, applicantId, input.currentStatus, payload);

    return { statusChanged, paymentApplied, certificateApplied, dispatchApplied };
  }

  /**
   * Mirror the legacy payment as a plan plus one settled transaction.
   *
   * The legacy system charges a flat plan price with no separate GST line, so
   * the plan is recorded at 0% GST with `finalAmount` equal to the amount
   * actually collected. Inventing an 18% split here would make the CRM's
   * revenue report disagree with the invoices the applicant actually holds.
   */
  private async applyPayment(
    tx: Database,
    recordId: string,
    applicantId: string,
    payload: NbrWebhookApplication,
  ): Promise<boolean> {
    const legacy = payload.payment;
    if (!legacy || legacy.status !== 'paid') return false;

    const amount = legacy.amount ?? toRupees(legacy.amountPaise ?? 0);
    if (toPaise(amount) <= 0) return false;

    const packageName = legacy.plan
      ? `${IMPORTED_PACKAGE_PREFIX} — ${legacy.plan}`
      : `${IMPORTED_PACKAGE_PREFIX} plan`;

    const [existing] = await tx
      .select({ id: schema.payments.id, amountPaid: schema.payments.amountPaid })
      .from(schema.payments)
      .where(eq(schema.payments.recordId, recordId))
      .limit(1);

    let paymentId: string;

    if (existing) {
      paymentId = existing.id;
    } else {
      const [created] = await tx
        .insert(schema.payments)
        .values({
          recordId,
          applicantId,
          packageName,
          amount,
          discount: '0.00',
          taxableValue: amount,
          gstPercent: '0.00',
          gstAmount: '0.00',
          finalAmount: amount,
          amountPaid: '0.00',
          status: PAYMENT_STATUS.PENDING,
          dueDate: legacy.deadline ?? null,
          notes: legacy.notes ?? 'Collected on the NBR website.',
        })
        .returning({ id: schema.payments.id });

      paymentId = created!.id;
    }

    // The legacy payment id is the idempotency key, so the same receipt cannot
    // be banked twice however many times its snapshot arrives.
    const idempotencyKey = `legacy:${legacy.externalId ?? payload.externalId}`;

    // Checked with a SELECT rather than ON CONFLICT: the unique index on
    // idempotency_key is partial (`WHERE ... IS NOT NULL`), and Postgres will
    // not accept a partial index as a conflict arbiter unless the statement
    // repeats its predicate — which this Drizzle version cannot express.
    //
    // Safe here because we are already inside the import transaction and
    // imports for one record are serialised by the event queue. The partial
    // index still stands behind it as the real guarantee: a concurrent double
    // insert raises a unique violation and rolls the import back rather than
    // banking the money twice.
    const [alreadyBanked] = await tx
      .select({ id: schema.paymentTransactions.id })
      .from(schema.paymentTransactions)
      .where(eq(schema.paymentTransactions.idempotencyKey, idempotencyKey))
      .limit(1);

    if (alreadyBanked) return false;

    await tx.insert(schema.paymentTransactions).values({
      paymentId,
      recordId,
      amount,
      paidOn: legacy.paidAt ?? new Date(),
      mode: LEGACY_MODE_MAP[legacy.method ?? ''] ?? PAYMENT_MODE.OTHER,
      transactionRef: legacy.referenceNumber ?? null,
      remarks: 'Recorded on the NBR website',
      idempotencyKey,
    });

    await tx
      .update(schema.payments)
      .set({
        amountPaid: amount,
        status: PAYMENT_STATUS.PAID,
        settledAt: legacy.paidAt ?? new Date(),
      })
      .where(eq(schema.payments.id, paymentId));

    await tx
      .update(schema.records)
      .set({ paymentStatus: PAYMENT_STATUS.PAID })
      .where(eq(schema.records.id, recordId));

    await this.timeline.writeMany(
      [
        {
          applicantId,
          recordId,
          eventType: TIMELINE_EVENT.PAYMENT_RECORDED,
          summary: `Payment of ₹${amount} received on the NBR website`,
          meta: {
            method: legacy.method ?? null,
            reference: legacy.referenceNumber ?? null,
            invoiceUrl: legacy.invoiceUrl ?? null,
          },
          actorKind: 'integration' as const,
          actorName: INTEGRATION_ACTOR_NAME,
        },
      ],
      tx,
    );

    return true;
  }

  /**
   * Mirror the certificate the legacy system issued.
   *
   * No PDF is copied. The customer site both issues and verifies certificates,
   * and its verification page is the authoritative view — the CRM stores the
   * number and links across rather than holding a snapshot that could drift out
   * of date after a reissue.
   */
  private async applyCertificate(
    tx: Database,
    recordId: string,
    applicantId: string,
    payload: NbrWebhookApplication,
  ): Promise<boolean> {
    const legacy = payload.certificate;
    if (!legacy) return false;

    const [existing] = await tx
      .select({ id: schema.certificates.id, number: schema.certificates.certificateNumber })
      .from(schema.certificates)
      .where(eq(schema.certificates.recordId, recordId))
      .limit(1);

    if (existing) {
      if (existing.number === legacy.certificateId) return false;

      await tx
        .update(schema.certificates)
        .set({ certificateNumber: legacy.certificateId, issueDate: legacy.issuedAt ?? null })
        .where(eq(schema.certificates.id, existing.id));
    } else {
      await tx.insert(schema.certificates).values({
        recordId,
        applicantId,
        certificateNumber: legacy.certificateId,
        issueDate: legacy.issuedAt ?? null,
      });
    }

    await tx
      .update(schema.records)
      .set({ hasCertificate: !legacy.revoked })
      .where(eq(schema.records.id, recordId));

    await this.timeline.writeMany(
      [
        {
          applicantId,
          recordId,
          eventType: TIMELINE_EVENT.CERTIFICATE_UPLOADED,
          summary: legacy.revoked
            ? `Certificate ${legacy.certificateId} revoked on the NBR website`
            : `Certificate ${legacy.certificateId} issued on the NBR website`,
          meta: {
            certificateNumber: legacy.certificateId,
            verificationUrl: legacy.verificationUrl ?? null,
            revoked: legacy.revoked,
            revokeReason: legacy.revokeReason ?? null,
          },
          actorKind: 'integration' as const,
          actorName: INTEGRATION_ACTOR_NAME,
        },
      ],
      tx,
    );

    return true;
  }

  /** Mirror the courier row, so the CRM's Dispatch tab matches the website's. */
  private async applyDispatch(
    tx: Database,
    recordId: string,
    applicantId: string,
    payload: NbrWebhookApplication,
  ): Promise<boolean> {
    const legacy = payload.dispatch;
    if (!legacy) return false;

    const deliveryStatus = LEGACY_DELIVERY_MAP[legacy.status ?? ''] ?? DELIVERY_STATUS.NOT_DISPATCHED;

    // The legacy side has no courier name until someone fills it in, but the
    // column is NOT NULL — a placeholder keeps the row creatable so tracking
    // details can land on it the moment they exist.
    const courierPartner = legacy.courierName?.trim() || 'To be assigned';

    const [existing] = await tx
      .select({
        id: schema.dispatches.id,
        deliveryStatus: schema.dispatches.deliveryStatus,
        trackingNumber: schema.dispatches.trackingNumber,
      })
      .from(schema.dispatches)
      .where(and(eq(schema.dispatches.recordId, recordId), eq(schema.dispatches.isCurrent, true)))
      .limit(1);

    const unchanged =
      existing &&
      existing.deliveryStatus === deliveryStatus &&
      (existing.trackingNumber ?? null) === (legacy.trackingNumber ?? null);

    if (unchanged) return false;

    if (existing) {
      await tx
        .update(schema.dispatches)
        .set({
          courierPartner,
          trackingNumber: legacy.trackingNumber ?? null,
          trackingUrl: legacy.trackingUrl ?? null,
          deliveryStatus,
          dispatchedOn: legacy.dispatchedAt ?? null,
          deliveredOn: legacy.deliveredAt ?? null,
          remarks: legacy.notes ?? null,
        })
        .where(eq(schema.dispatches.id, existing.id));
    } else {
      await tx.insert(schema.dispatches).values({
        recordId,
        applicantId,
        courierPartner,
        trackingNumber: legacy.trackingNumber ?? null,
        trackingUrl: legacy.trackingUrl ?? null,
        deliveryStatus,
        dispatchedOn: legacy.dispatchedAt ?? null,
        deliveredOn: legacy.deliveredAt ?? null,
        remarks: legacy.notes ?? 'Created on the NBR website',
        isCurrent: true,
      });
    }

    await tx
      .update(schema.records)
      .set({ deliveryStatus })
      .where(eq(schema.records.id, recordId));

    await this.timeline.writeMany(
      [
        {
          applicantId,
          recordId,
          eventType:
            deliveryStatus === DELIVERY_STATUS.DELIVERED
              ? TIMELINE_EVENT.DISPATCH_DELIVERED
              : TIMELINE_EVENT.DISPATCH_UPDATED,
          summary: `Dispatch updated on the NBR website — ${deliveryStatus.replace(/_/g, ' ')}`,
          meta: {
            courier: legacy.courierName ?? null,
            trackingNumber: legacy.trackingNumber ?? null,
            trackingUrl: legacy.trackingUrl ?? null,
          },
          actorKind: 'integration' as const,
          actorName: INTEGRATION_ACTOR_NAME,
        },
      ],
      tx,
    );

    return true;
  }

  /**
   * Move the record's status to match the legacy stage — forward only.
   *
   * Written directly rather than through the workflow service on purpose. The
   * state machine's guards describe what a *human operator* may do next; a
   * mirror has no next step to choose, it is reporting what already happened
   * somewhere else. Forcing an import through the transition graph would mean
   * an application that jumped from approval to delivery on the website could
   * not be represented here at all.
   */
  private async applyStatus(
    tx: Database,
    recordId: string,
    applicantId: string,
    currentStatus: RecordStatus,
    payload: NbrWebhookApplication,
  ): Promise<boolean> {
    const stage = payload.stage as LegacyStage | undefined;
    if (!stage) return false;

    const target = LEGACY_STAGE_TO_STATUS[stage];
    if (!target || target === currentStatus) return false;

    // Only advance. A record an operator has already carried past this point in
    // the CRM must not be pulled back by a snapshot that is merely older.
    const currentRank = this.rankOf(currentStatus);
    const targetRank = LEGACY_STAGE_RANK[stage];
    if (currentRank !== null && targetRank <= currentRank) return false;

    await tx
      .update(schema.records)
      .set({ status: target })
      .where(eq(schema.records.id, recordId));

    await this.timeline.writeMany(
      [
        {
          applicantId,
          recordId,
          eventType: TIMELINE_EVENT.STATUS_CHANGED,
          summary: `Status advanced to ${target.replace(/_/g, ' ')} — mirrored from the NBR website`,
          meta: { from: currentStatus, to: target, legacyStage: stage },
          actorKind: 'integration' as const,
          actorName: INTEGRATION_ACTOR_NAME,
        },
      ],
      tx,
    );

    return true;
  }

  /**
   * Rank a CRM status on the same scale as the legacy stages.
   *
   * `null` for statuses off the mirrored path — Rejected, On Hold, Closed.
   * Those are decisions taken here, and a website snapshot should not overrule
   * them; returning `null` makes `applyStatus` leave them alone.
   */
  private rankOf(status: RecordStatus): number | null {
    for (const [stage, mapped] of Object.entries(LEGACY_STAGE_TO_STATUS)) {
      if (mapped === status) return LEGACY_STAGE_RANK[stage as LegacyStage];
    }

    // Past the end of the mirrored path — Completed outranks every legacy stage.
    if (status === 'completed') return Number.MAX_SAFE_INTEGER;
    return null;
  }

  /** Upsert the mirror row that links this record back to the legacy system. */
  async upsertMirror(
    tx: Database,
    input: {
      recordId: string;
      applicantId: string;
      payload: NbrWebhookApplication;
      inboundHash: string;
    },
  ): Promise<void> {
    const { payload } = input;
    const extra = (payload.extra ?? {}) as Record<string, unknown>;

    const values = {
      recordId: input.recordId,
      applicantId: input.applicantId,
      externalId: payload.externalId,
      legacyAppCode: typeof extra.appCode === 'string' ? extra.appCode : null,
      legacyStatus: typeof extra.legacyStatus === 'string' ? extra.legacyStatus : null,
      legacyStage: payload.stage ?? null,
      legacyUrl: payload.externalUrl ?? null,
      certificateNumber: payload.certificate?.certificateId ?? null,
      certificateUrl: payload.certificate?.verificationUrl ?? null,
      certificateRevoked: payload.certificate?.revoked ?? false,
      invoiceUrl: payload.payment?.invoiceUrl ?? null,
      awardeeSlug: payload.awardee?.slug ?? null,
      awardeeUrl: payload.awardee?.publicUrl ?? null,
      awardeePublished: payload.awardee?.isPublished ?? false,
      snapshot: payload as unknown as Record<string, unknown>,
      inboundHash: input.inboundHash,
      lastInboundAt: new Date(),
    };

    await tx
      .insert(schema.legacyMirror)
      .values(values)
      .onConflictDoUpdate({
        target: schema.legacyMirror.recordId,
        set: {
          ...values,
          updatedAt: sql`now()`,
        },
      });
  }
}
