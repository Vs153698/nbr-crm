import { Inject, Injectable } from '@nestjs/common';
import {
  CERTIFICATE_VERIFICATION,
  COMMUNICATION_STATUS,
  deriveClientProgress,
  EVIDENCE_KIND,
  PAYMENT_STATUS,
  RECORD_STATUS,
  TEMPLATE_CODE,
  TIMELINE_EVENT,
  type ClientProgress,
} from '@nbr/shared';
import { and, asc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import { NotFoundError } from '../common/errors';
import type { Database } from '../database/client';
import { DB } from '../database/database.tokens';
import * as schema from '../database/schema';

/**
 * The eleven-stage progress badge NBR reports to its client.
 *
 * A read-only projection, and nothing else. It writes nothing, no transition
 * consults it, and the record's own stepper is untouched — this exists purely
 * so an operator opening an application can see, in the client's vocabulary,
 * how far it has genuinely got.
 *
 * Every stage is answered from a dated fact somewhere in the database rather
 * than from the record's status, because status says where a record *is* and
 * the client is asking what has *happened*. The two come apart constantly: a
 * record at Dispatch Pending has been approved, paid for and certified, and a
 * record at Fees Received may never have been sent a reminder because it was
 * paid before anyone chased it.
 *
 * Where a stage needs an employee to act, the fact it reads is the act itself —
 * the certificate's sign-off, the courier's dispatch date — so nothing here can
 * tick a box on the strength of a record having drifted into a stage.
 */
@Injectable()
export class ClientProgressService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async forRecord(recordId: string): Promise<ClientProgress> {
    const [record] = await this.db
      .select({
        id: schema.records.id,
        applicationDate: schema.records.applicationDate,
        createdAt: schema.records.createdAt,
      })
      .from(schema.records)
      .where(eq(schema.records.id, recordId))
      .limit(1);

    if (!record) throw new NotFoundError('Record');

    const [
      reviewStartedAt,
      evaluationCompletedAt,
      approvedAt,
      reminderSentAt,
      feesReceivedAt,
      certificateVerifiedAt,
      dispatch,
      photoUploadedAt,
    ] = await Promise.all([
      this.firstEntryInto(recordId, RECORD_STATUS.UNDER_REVIEW),
      this.firstEntryInto(recordId, RECORD_STATUS.VERIFICATION_PENDING),
      this.firstEntryInto(recordId, RECORD_STATUS.SELECTED),
      this.reminderSentAt(recordId),
      this.feesReceivedAt(recordId),
      this.certificateVerifiedAt(recordId),
      this.dispatchDates(recordId),
      this.photoUploadedAt(recordId),
    ]);

    // Ordered after the dispatch lookup because "received" means received
    // *back* — a photo that predates delivery is the applicant's ID photo from
    // the application, not the one taken with their award.
    const photoReceivedAt = await this.photoReceivedAt(recordId, dispatch.deliveredAt);

    return deriveClientProgress({
      // The application exists, so it was submitted. `applicationDate` is what
      // the applicant would call the date they applied; `createdAt` is the
      // fallback for a record typed in later.
      submittedAt: (record.applicationDate ?? record.createdAt).toISOString(),
      reviewStartedAt,
      evaluationCompletedAt,
      approvedAt,
      reminderSentAt,
      feesReceivedAt,
      certificateVerifiedAt,
      dispatchedAt: dispatch.dispatchedAt,
      deliveredAt: dispatch.deliveredAt,
      photoReceivedAt,
      photoUploadedAt,
    });
  }

  /**
   * When the record first entered a status, from the timeline.
   *
   * The timeline rather than the record: `records` holds only where it is now,
   * so a record that has moved on would report every earlier stage as never
   * having happened. The timeline is append-only by database trigger, which is
   * what makes it safe to treat as the history of record.
   *
   * `first`, not last — a record reopened and re-approved was still approved
   * the first time, and the client is asking when the milestone was reached.
   */
  private async firstEntryInto(recordId: string, status: string): Promise<string | null> {
    const [row] = await this.db
      .select({ occurredAt: schema.timelineEvents.occurredAt })
      .from(schema.timelineEvents)
      .where(
        and(
          eq(schema.timelineEvents.recordId, recordId),
          eq(schema.timelineEvents.eventType, TIMELINE_EVENT.STATUS_CHANGED),
          sql`${schema.timelineEvents.meta}->>'to' = ${status}`,
        ),
      )
      .orderBy(asc(schema.timelineEvents.occurredAt))
      .limit(1);

    return row?.occurredAt.toISOString() ?? null;
  }

  /**
   * A payment reminder that actually left the building.
   *
   * Read from the communication log, not from `payments.reminder_count`: the
   * counter is incremented by the scheduler when it *decides* to chase someone,
   * whereas the log records whether the message was accepted for delivery. A
   * reminder that failed at SMTP is not a reminder the applicant received, and
   * reporting it as sent is the kind of small lie this badge exists to avoid.
   */
  private async reminderSentAt(recordId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ sentAt: schema.communications.sentAt, queuedAt: schema.communications.queuedAt })
      .from(schema.communications)
      .where(
        and(
          eq(schema.communications.recordId, recordId),
          eq(schema.communications.templateCode, TEMPLATE_CODE.PAYMENT_REMINDER),
          inArray(schema.communications.status, [
            COMMUNICATION_STATUS.SENT,
            COMMUNICATION_STATUS.DELIVERED,
            // Staff confirming they sent the WhatsApp by hand. An explicit
            // human statement, which is stronger evidence than a queue row.
            COMMUNICATION_STATUS.MARKED_SENT,
          ]),
        ),
      )
      .orderBy(asc(schema.communications.createdAt))
      .limit(1);

    if (!row) return null;
    return (row.sentAt ?? row.queuedAt)?.toISOString() ?? null;
  }

  /** Settled in full — a partial payment is not "fees received". */
  private async feesReceivedAt(recordId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ settledAt: schema.payments.settledAt })
      .from(schema.payments)
      .where(
        and(
          eq(schema.payments.recordId, recordId),
          eq(schema.payments.status, PAYMENT_STATUS.PAID),
          isNotNull(schema.payments.settledAt),
        ),
      )
      .orderBy(asc(schema.payments.settledAt))
      .limit(1);

    return row?.settledAt?.toISOString() ?? null;
  }

  /**
   * The employee's certificate sign-off.
   *
   * Not "a certificate row exists" — the NBR website mints a certificate number
   * of its own the moment a fee settles, and that row carries no file and no
   * approval. `verified_at` is written only by `CertificatesService.verify`,
   * which requires an uploaded version behind it.
   */
  private async certificateVerifiedAt(recordId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ verifiedAt: schema.certificates.verifiedAt })
      .from(schema.certificates)
      .where(
        and(
          eq(schema.certificates.recordId, recordId),
          eq(schema.certificates.verificationStatus, CERTIFICATE_VERIFICATION.VERIFIED),
        ),
      )
      .limit(1);

    return row?.verifiedAt?.toISOString() ?? null;
  }

  /** Courier dates, from the current dispatch row. */
  private async dispatchDates(
    recordId: string,
  ): Promise<{ dispatchedAt: string | null; deliveredAt: string | null }> {
    const [row] = await this.db
      .select({
        dispatchedOn: schema.dispatches.dispatchedOn,
        deliveredOn: schema.dispatches.deliveredOn,
      })
      .from(schema.dispatches)
      .where(and(eq(schema.dispatches.recordId, recordId), eq(schema.dispatches.isCurrent, true)))
      .limit(1);

    return {
      dispatchedAt: row?.dispatchedOn?.toISOString() ?? null,
      deliveredAt: row?.deliveredOn?.toISOString() ?? null,
    };
  }

  /**
   * A photo of the applicant with their award, sent back after delivery.
   *
   * The cut-off is what makes this meaningful. Applications routinely carry
   * photos from the day they were filed — an ID photo, a picture of the record
   * attempt — and counting those would mark this stage complete for almost
   * every application the moment it arrived. Only a photo added *after* the kit
   * was delivered can be the one taken with it.
   *
   * Consequently this returns null until the kit is delivered, which is
   * correct: the stage cannot have happened yet.
   */
  private async photoReceivedAt(
    recordId: string,
    deliveredAt: string | null,
  ): Promise<string | null> {
    if (!deliveredAt) return null;

    const [row] = await this.db
      .select({ createdAt: schema.evidenceFiles.createdAt })
      .from(schema.evidenceFiles)
      .where(
        and(
          eq(schema.evidenceFiles.recordId, recordId),
          eq(schema.evidenceFiles.kind, EVIDENCE_KIND.PHOTO),
          // `gte` rather than a raw fragment: the driver binds a Date through
          // the column's own type, where a template literal hands it the raw
          // object and throws.
          gte(schema.evidenceFiles.createdAt, new Date(deliveredAt)),
        ),
      )
      .orderBy(asc(schema.evidenceFiles.createdAt))
      .limit(1);

    return row?.createdAt.toISOString() ?? null;
  }

  /** Published — a publication entry is the photo having gone out. */
  private async photoUploadedAt(recordId: string): Promise<string | null> {
    const [row] = await this.db
      .select({
        publishedOn: schema.publications.publishedOn,
        createdAt: schema.publications.createdAt,
      })
      .from(schema.publications)
      .where(eq(schema.publications.recordId, recordId))
      .orderBy(asc(schema.publications.createdAt))
      .limit(1);

    if (!row) return null;
    return (row.publishedOn ?? row.createdAt).toISOString();
  }
}
