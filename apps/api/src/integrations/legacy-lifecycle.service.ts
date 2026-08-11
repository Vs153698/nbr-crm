import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CERTIFICATE_VERIFICATION,
  DELIVERY_STATUS,
  isLegacyDecisionStage,
  LEGACY_STAGE,
  LEGACY_STAGE_RANK,
  LEGACY_STAGE_TO_STATUS,
  PAYMENT_MODE,
  PAYMENT_STATUS,
  RECORD_STATUS,
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

/**
 * Where Certificate Verification sits on the website's ladder.
 *
 * It has no legacy stage of its own — it is a step the CRM adds — so it cannot
 * be looked up in `LEGACY_STAGE_RANK`. It falls between fees received and the
 * website's automatic certificate issue, which is exactly what the half-step
 * expresses: past payment, short of anything the website did on its own.
 */
const CERTIFICATE_VERIFICATION_RANK = LEGACY_STAGE_RANK[LEGACY_STAGE.PAYMENT_RECEIVED] + 0.5;

/**
 * Where the CRM's own stages sit on the website's ladder.
 *
 * The website has five steps; the CRM's pipeline has eight, and the extra ones
 * are real places a record can be sitting when a snapshot lands. Ranking them
 * as `null` — "off the ladder, nothing to compare" — made the forward-only
 * guard skip entirely, so a late or replayed snapshot describing an *earlier*
 * stage was written straight over them. A record in Certificate Verification
 * could be dragged back to Selection Sent by a stale `approved` snapshot, and
 * one in Publication back to Delivered.
 *
 * Half-steps because these sit *between* two website stages rather than
 * replacing either.
 */
const CRM_ONLY_STAGE_RANK: Readonly<Partial<Record<RecordStatus, number>>> = {
  // Invoice raised, money not in: past the approval, short of the receipt.
  [RECORD_STATUS.PAYMENT_PENDING]: LEGACY_STAGE_RANK[LEGACY_STAGE.APPROVED] + 0.5,
  // Fees in, certificate not yet signed off here.
  [RECORD_STATUS.CERTIFICATE_PENDING]: CERTIFICATE_VERIFICATION_RANK,
  // Past delivery — the website has no stage that goes this far.
  [RECORD_STATUS.PUBLICATION]: LEGACY_STAGE_RANK[LEGACY_STAGE.DELIVERED] + 0.5,
  // The end of the CRM's pipeline. Outranks every legacy stage.
  [RECORD_STATUS.COMPLETED]: Number.MAX_SAFE_INTEGER,
};

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

    // Resolve the plan against our own catalogue first. Since the packages are
    // mirrored from the website they carry its plan code, so "premium" lands on
    // the real Premium package — the one the Raise Payment dropdown offers and
    // the one revenue reports group by. The invented "Website — premium" name
    // below is the fallback for a plan we have not mirrored yet; leaving it as
    // the default would put a package name in the ledger that appears nowhere
    // else in the system.
    const [mirroredPackage] = legacy.plan
      ? await tx
          .select({ id: schema.packages.id, name: schema.packages.name })
          .from(schema.packages)
          .where(eq(schema.packages.legacyCode, legacy.plan))
          .limit(1)
      : [];

    const packageName =
      mirroredPackage?.name ??
      (legacy.plan
        ? `${IMPORTED_PACKAGE_PREFIX} — ${legacy.plan}`
        : `${IMPORTED_PACKAGE_PREFIX} plan`);

    const [existing] = await tx
      .select({ id: schema.payments.id, amountPaid: schema.payments.amountPaid })
      .from(schema.payments)
      .where(eq(schema.payments.recordId, recordId))
      .limit(1);

    let paymentId: string;

    if (existing) {
      paymentId = existing.id;

      // The CRM has already banked at least this much against the record, so
      // the snapshot is reporting money we put there ourselves — a payment the
      // CRM pushed out and the website is now echoing back on its next event.
      // Banking it again would double-count the revenue, and where the CRM set
      // a transaction reference it also trips the (payment_id, transaction_ref)
      // unique index, which fails the whole snapshot and silently strands the
      // dispatch or certificate change travelling alongside it.
      //
      // Merge forward, never backward: a snapshot may only ever add money the
      // CRM does not have yet.
      if (toPaise(existing.amountPaid ?? '0') >= toPaise(amount)) return false;
    } else {
      const [created] = await tx
        .insert(schema.payments)
        .values({
          recordId,
          applicantId,
          packageId: mirroredPackage?.id ?? null,
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

    // Second guard, on the reference rather than the key. The same receipt can
    // reach us under a different idempotency key — once as the CRM's own entry,
    // once as `legacy:<id>` when the website echoes it back — and the two keys
    // never match. `(payment_id, transaction_ref)` is uniquely indexed, so
    // without this the insert raises and takes the whole import down with it.
    if (legacy.referenceNumber) {
      const [sameReference] = await tx
        .select({ id: schema.paymentTransactions.id })
        .from(schema.paymentTransactions)
        .where(
          and(
            eq(schema.paymentTransactions.paymentId, paymentId),
            eq(schema.paymentTransactions.transactionRef, legacy.referenceNumber),
          ),
        )
        .limit(1);

      if (sameReference) return false;
    }

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
   * Record — but never adopt — the certificate the website issued.
   *
   * The website mints a certificate number of its own the moment a payment
   * settles. That is fine over there and it must keep happening: its public
   * verification page and the applicant's portal are built on it.
   *
   * What it must not do is finish the certificate stage here. The CRM's stage
   * is deliberately employee-controlled — a person prepares the certificate,
   * uploads it, and signs it off — and an auto-minted number arriving on a
   * webhook is none of those things. This method therefore:
   *
   *  • never overwrites a number the CRM allocated for a certificate somebody
   *    actually uploaded;
   *  • never sets `has_certificate`, which would make an empty row look like a
   *    file on record;
   *  • never touches `verification_status`, which only `verify` may set.
   *
   * The number is still stored, because it is genuinely useful: it is what an
   * applicant quotes, and what the website's verification page will answer to.
   * It just does not count as the CRM's certificate until an employee's upload
   * gives it a file and their sign-off makes it official.
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
      .select({
        id: schema.certificates.id,
        number: schema.certificates.certificateNumber,
        currentVersion: schema.certificates.currentVersion,
      })
      .from(schema.certificates)
      .where(eq(schema.certificates.recordId, recordId))
      .limit(1);

    // Does a real, uploaded certificate stand behind this row? If so its number
    // is the one on the PDF in the applicant's hands, and the website's
    // auto-minted string must not replace it.
    const [uploaded] = existing
      ? await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(schema.certificateVersions)
          .where(eq(schema.certificateVersions.certificateId, existing.id))
      : [];

    const hasUploadedFile = (uploaded?.count ?? 0) > 0;

    if (existing) {
      if (hasUploadedFile || existing.number === legacy.certificateId) {
        // Nothing to adopt. The mirror row already carries the website's number
        // for cross-reference, and `upsertMirror` keeps it current.
        return false;
      }

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
        // No file behind it yet, so the stage has not even started.
        verificationStatus: CERTIFICATE_VERIFICATION.AWAITING_UPLOAD,
        // Counts uploads, of which there are none. The first real upload is v1.
        currentVersion: 0,
      });
    }

    await this.timeline.writeMany(
      [
        {
          applicantId,
          recordId,
          eventType: TIMELINE_EVENT.CERTIFICATE_UPLOADED,
          summary: legacy.revoked
            ? `Certificate ${legacy.certificateId} revoked on the NBR website`
            : `Certificate number ${legacy.certificateId} allocated by the NBR website — upload and verify the certificate here to complete this stage`,
          meta: {
            certificateNumber: legacy.certificateId,
            verificationUrl: legacy.verificationUrl ?? null,
            revoked: legacy.revoked,
            revokeReason: legacy.revokeReason ?? null,
            /** Reference only — it did not complete the CRM's certificate stage. */
            adopted: false,
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

    let target = LEGACY_STAGE_TO_STATUS[stage];
    if (!target) return false;

    /**
     * The certificate stage is a gate the mirror cannot open.
     *
     * The website issues a certificate automatically on payment and then runs
     * ahead — certificate issued, dispatch pending, dispatched — so its
     * snapshots used to carry the CRM straight past Certificate Verification
     * on the strength of a document no employee had ever seen. That is exactly
     * the automatic completion this stage exists to prevent.
     *
     * So a snapshot may bring a record *up to* Certificate Verification and no
     * further until someone here has signed the certificate off. Everything
     * else in the snapshot still lands: the payment is banked, the courier and
     * tracking number are written, the certificate number is recorded. Only the
     * record's own status waits, and the timeline says why — so an operator
     * looking at a record whose parcel has already shipped can see that the
     * one outstanding thing is their sign-off.
     */
    let cappedAtCertificate = false;
    if (LEGACY_STAGE_RANK[stage] >= LEGACY_STAGE_RANK[LEGACY_STAGE.PAYMENT_RECEIVED]) {
      const verified = await this.hasVerifiedCertificate(tx, recordId);
      if (!verified) {
        /**
         * Fees received on the website lands the record in Certificate
         * Verification here, and goes no further until it is signed off.
         *
         * Both halves of that are the same rule seen from two sides. A record
         * paid for on the website belongs to the certificate team immediately,
         * exactly as one paid for here does — and the website, which issues a
         * certificate automatically the moment money lands and then runs on
         * through dispatch, must not be able to carry the CRM past a stage
         * whose entire purpose is that a person completes it.
         *
         * Everything else in the snapshot still lands: the payment is banked,
         * the courier and tracking number are written, the website's
         * certificate number is recorded. Only the record's own status waits,
         * and the timeline says why — so an operator looking at a record whose
         * parcel has already shipped can see that the one thing outstanding is
         * their sign-off.
         */
        target = RECORD_STATUS.CERTIFICATE_PENDING;
        cappedAtCertificate = true;
      }
    }

    if (target === currentStatus) return false;

    /**
     * The "only advance" rule applies between two points on the ladder, and
     * only there.
     *
     * A rejection or cancellation is a decision, not a step — it can be taken
     * from anywhere, including after approval, and comparing ranks would
     * silently discard it. Leaving one is equally deliberate: reopening a
     * rejected application on the website puts it back into evaluation, which
     * *is* a move backwards and must be allowed to land.
     */
    const decisionInvolved =
      isLegacyDecisionStage(stage) || this.isDecisionStatus(currentStatus);

    if (!decisionInvolved) {
      const currentRank = this.rankOf(currentStatus);
      // Rank the *target*, not the stage, when the certificate gate held the
      // move back. Comparing the website's own rank would let a "dispatched"
      // snapshot pass the forward-only check and then write Certificate
      // Verification onto a record that is already at Dispatch here — turning a
      // guard meant to hold a record still into one that drags it backwards.
      // Rank the *target*, not the website's stage, when the certificate gate
      // held the move back. Comparing the website's own rank would let a
      // "dispatched" snapshot pass the forward-only check and then write
      // Certificate Verification onto a record already at Dispatch here —
      // turning a guard meant to hold a record still into one that drags it
      // backwards.
      const targetRank = cappedAtCertificate
        ? CERTIFICATE_VERIFICATION_RANK
        : LEGACY_STAGE_RANK[stage];
      if (currentRank !== null && targetRank <= currentRank) return false;
    }

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
          summary: cappedAtCertificate
            ? `Status advanced to ${target.replace(/_/g, ' ')} — the NBR website reports "${stage.replace(/_/g, ' ')}", but the certificate has not been uploaded and verified here yet`
            : `Status advanced to ${target.replace(/_/g, ' ')} — mirrored from the NBR website`,
          meta: {
            from: currentStatus,
            to: target,
            legacyStage: stage,
            heldForCertificateVerification: cappedAtCertificate,
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
   * Has an employee here uploaded a certificate and signed it off?
   *
   * Both halves are checked deliberately. A `certificates` row on its own means
   * nothing — that is how the website's auto-minted number is stored — and a
   * `verified` status is only ever written by `CertificatesService.verify`,
   * which requires an uploaded version behind it.
   */
  private async hasVerifiedCertificate(tx: Database, recordId: string): Promise<boolean> {
    const [row] = await tx
      .select({ status: schema.certificates.verificationStatus })
      .from(schema.certificates)
      .where(eq(schema.certificates.recordId, recordId))
      .limit(1);

    return row?.status === CERTIFICATE_VERIFICATION.VERIFIED;
  }

  /** Statuses that represent a decision rather than a point on the ladder. */
  private isDecisionStatus(status: RecordStatus): boolean {
    return (
      status === RECORD_STATUS.REJECTED ||
      status === RECORD_STATUS.CLOSED ||
      status === RECORD_STATUS.ON_HOLD
    );
  }

  /**
   * Rank a CRM status on the same scale as the legacy stages.
   *
   * `null` for statuses off the ladder entirely. `applyStatus` never consults
   * this for a decision status — those are handled before the guard — so the
   * only `null` cases left are statuses this system has that the website has no
   * concept of, where there is nothing meaningful to compare.
   */
  private rankOf(status: RecordStatus): number | null {
    for (const [stage, mapped] of Object.entries(LEGACY_STAGE_TO_STATUS)) {
      if (isLegacyDecisionStage(stage as LegacyStage)) continue;
      if (mapped === status) return LEGACY_STAGE_RANK[stage as LegacyStage];
    }

    const crmOnly = CRM_ONLY_STAGE_RANK[status];
    return crmOnly ?? null;
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
      // Older website builds send the award only inside `extra`; read both so a
      // deployment that has not shipped the promoted block still badges.
      awardTitle:
        payload.award?.title ?? (typeof extra.awardTitle === 'string' ? extra.awardTitle : null),
      awardCategory: payload.award?.category ?? null,
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
