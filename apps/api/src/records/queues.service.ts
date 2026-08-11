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

  /**
   * §Pipeline 1 — applications that have arrived and not been picked up.
   *
   * The front of the pipeline had no list of its own, so the only way to find
   * an application nobody had started was to filter the applicant table by
   * hand. A queue that exists for every other stage but not the first one is
   * the one most likely to grow a backlog unnoticed, because nothing surfaces
   * it until somebody goes looking.
   */
  async newApplications(limit = 100) {
    return this.project(
      inArray(schema.records.status, [RECORD_STATUS.APPLICATION_SUBMITTED]),
      limit,
    );
  }

  /**
   * §7 — applications whose documents are still being checked.
   *
   * Approval Pending used to be counted here, which merged two queues with two
   * different owners: a verifier looking for work to do, and an approver
   * looking for decisions to take. A record already verified would still appear
   * on the verification list, so nobody could tell what was actually
   * outstanding on either side.
   */
  async verification(limit = 100) {
    return this.project(inArray(schema.records.status, [RECORD_STATUS.UNDER_REVIEW]), limit);
  }

  /** §Pipeline 3 — verified, waiting on an approve/reject decision. */
  async approvals(limit = 100) {
    return this.project(
      inArray(schema.records.status, [RECORD_STATUS.VERIFICATION_PENDING]),
      limit,
    );
  }

  /**
   * §Pipeline 4 — approved, and waiting on the payment being raised.
   *
   * The stage where the selection letter goes out and the invoice follows. A
   * record can sit here for weeks having been approved and never written to,
   * which is exactly what this list is for — the profile's Next Steps panel
   * flags an unsent selection, but only once you already have the record open.
   */
  async selectionSent(limit = 100) {
    return this.project(inArray(schema.records.status, [RECORD_STATUS.SELECTED]), limit);
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

  /**
   * §17 — delivered records waiting to be written up.
   *
   * Publication follows delivery now, so the queue is the Publication stage and
   * nothing earlier. It used to include Certificate Completed, which put a
   * record in the publication queue while its certificate was still in the
   * office — the magazine entry could be written before the applicant had been
   * awarded anything.
   */
  async publications(limit = 100) {
    return this.project(
      and(
        eq(schema.records.hasPublication, false),
        inArray(schema.records.status, [RECORD_STATUS.PUBLICATION]),
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
