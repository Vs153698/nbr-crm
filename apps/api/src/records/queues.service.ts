import { Inject, Injectable } from '@nestjs/common';
import { PAYMENT_STATUS, RECORD_STATUS } from '@nbr/shared';
import { and, asc, eq, inArray, isNull, type SQL } from 'drizzle-orm';
import type { Database } from '../database/client';
import { DB } from '../database/database.tokens';
import * as schema from '../database/schema';

/**
 * Operational work queues (§7 verification, §12 payments, §17 publications).
 *
 * Certificates and dispatch already have queues on their own services because
 * their filters involve those modules' own tables. These three read only from
 * `records`, so they live together and share one projection — the web app
 * renders all five through the same table component and would break on drift.
 *
 * Each query is ordered oldest-first: a queue sorted by anything else quietly
 * starves its own tail.
 */
@Injectable()
export class QueuesService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** §7 — applications waiting on document review. */
  async verification(limit = 100) {
    return this.project(
      inArray(schema.records.status, [
        RECORD_STATUS.UNDER_REVIEW,
        RECORD_STATUS.VERIFICATION_PENDING,
      ]),
      limit,
    );
  }

  /**
   * §12 — records with money outstanding.
   *
   * Driven by the denormalised `paymentStatus` rather than a sum over
   * transactions: that column is written in the same transaction as the ledger
   * row, so it cannot disagree, and it keeps the queue off a per-row aggregate.
   */
  async payments(limit = 100) {
    return this.project(
      inArray(schema.records.paymentStatus, [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.PARTIAL]),
      limit,
    );
  }

  /** §17 — records with a certificate issued but nothing published yet. */
  async publications(limit = 100) {
    return this.project(
      and(
        eq(schema.records.hasPublication, false),
        inArray(schema.records.status, [
          RECORD_STATUS.CERTIFICATE_UPLOADED,
          RECORD_STATUS.PUBLICATION,
        ]),
      ) as SQL,
      limit,
    );
  }

  private async project(where: SQL, limit: number) {
    return this.db
      .select({
        recordId: schema.records.id,
        recordCode: schema.records.recordCode,
        applicantId: schema.records.applicantId,
        applicantName: schema.applicants.fullName,
        recordTitle: schema.achievements.recordTitle,
        status: schema.records.status,
        paymentStatus: schema.records.paymentStatus,
        deliveryStatus: schema.records.deliveryStatus,
        city: schema.applicants.city,
        state: schema.applicants.state,
        pincode: schema.applicants.pincode,
        updatedAt: schema.records.updatedAt,
      })
      .from(schema.records)
      .innerJoin(schema.applicants, eq(schema.records.applicantId, schema.applicants.id))
      .leftJoin(schema.achievements, eq(schema.achievements.recordId, schema.records.id))
      .where(and(isNull(schema.records.deletedAt), where))
      .orderBy(asc(schema.records.updatedAt))
      .limit(Math.min(limit, 200));
  }
}
