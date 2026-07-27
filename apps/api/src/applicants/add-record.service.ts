import { Inject, Injectable } from '@nestjs/common';
import {
  formatRecordId,
  RECORD_STATUS,
  TIMELINE_EVENT,
  type ApplicationSource,
  type RecordStatus,
} from '@nbr/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { AUDIT, AuditService } from '../audit/audit.service';
import { BlacklistBlockedError, ForbiddenError, NotFoundError } from '../common/errors';
import { requireActor } from '../common/request-context';
import type { Database } from '../database/client';
import { DB } from '../database/database.tokens';
import * as schema from '../database/schema';
import { CacheService, CacheTag } from '../redis/cache.service';
import { TimelineService } from '../timeline/timeline.service';

export interface AddRecordInput {
  readonly source: ApplicationSource;
  readonly assignedToUserId?: string | undefined;
  readonly initialStatus: RecordStatus;
  readonly internalRemarks?: string | undefined;
  readonly achievement: {
    readonly recordTitle: string;
    readonly categoryId: string;
    readonly recordType: string;
    readonly description?: string | undefined;
    readonly achievementDate?: Date | undefined;
    readonly location?: string | undefined;
    readonly participantCount: number;
  };
  readonly override?: boolean;
  readonly overrideReason?: string | undefined;
}

/**
 * Add a further record to an existing applicant (§4).
 *
 * "If the same person applies again in future, a new person profile should NOT
 * be created. Instead: Person → Record #1 → Record #2 → Record #3."
 *
 * This is the endpoint that makes that rule usable rather than merely
 * expressible. Without it, staff faced with a returning applicant would have no
 * option but to create a second profile — which is exactly what the whole
 * duplicate-detection layer exists to prevent.
 */
@Injectable()
export class AddRecordService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly timeline: TimelineService,
    private readonly audit: AuditService,
    private readonly cache: CacheService,
  ) {}

  async addRecord(
    applicantId: string,
    input: AddRecordInput,
  ): Promise<{ recordId: string; recordCode: string }> {
    const actor = requireActor();

    const [applicant] = await this.db
      .select({
        id: schema.applicants.id,
        applicantCode: schema.applicants.applicantCode,
        fullName: schema.applicants.fullName,
        isBlacklisted: schema.applicants.isBlacklisted,
        erasedAt: schema.applicants.erasedAt,
      })
      .from(schema.applicants)
      .where(and(eq(schema.applicants.id, applicantId), isNull(schema.applicants.deletedAt)))
      .limit(1);

    if (!applicant) throw new NotFoundError('Applicant');

    // A profile whose personal data was erased under DPDP §12 has no lawful
    // basis to carry a new application — the applicant would have to re-apply
    // and give consent afresh.
    if (applicant.erasedAt) {
      throw new ForbiddenError(
        'This profile’s personal data was erased at the applicant’s request. A new application requires a fresh submission and consent.',
      );
    }

    // §19 — the blacklist blocks new applications, not just new profiles.
    if (applicant.isBlacklisted) {
      const canOverride = actor.isSuperAdmin || actor.permissions.has('blacklist:override');
      if (!input.override || !canOverride) {
        const [blacklist] = await this.db
          .select({
            kind: schema.blacklists.kind,
            reason: schema.blacklists.reason,
            reasonDetail: schema.blacklists.reasonDetail,
          })
          .from(schema.blacklists)
          .where(
            and(eq(schema.blacklists.applicantId, applicantId), isNull(schema.blacklists.liftedAt)),
          )
          .limit(1);

        throw new BlacklistBlockedError({ blacklist: blacklist ?? null });
      }
    }

    return this.db.transaction(async (tx) => {
      const result = await tx.execute<{ nextval: string }>(
        sql`SELECT nextval('record_code_seq')::text AS nextval`,
      );
      const sequence = Number((result as unknown as Array<{ nextval: string }>)[0]!.nextval);
      const recordCode = formatRecordId(sequence);

      const [record] = await tx
        .insert(schema.records)
        .values({
          recordCode,
          applicantId,
          status: input.initialStatus,
          source: input.source,
          assignedToUserId: input.assignedToUserId ?? null,
          internalRemarks: input.internalRemarks ?? null,
          createdByUserId: actor.userId,
        })
        .returning({ id: schema.records.id });

      const recordId = record!.id;

      await tx.insert(schema.achievements).values({
        recordId,
        recordTitle: input.achievement.recordTitle,
        categoryId: input.achievement.categoryId,
        recordType: input.achievement.recordType,
        description: input.achievement.description ?? null,
        achievementDate: input.achievement.achievementDate
          ? input.achievement.achievementDate.toISOString().slice(0, 10)
          : null,
        location: input.achievement.location ?? null,
        participantCount: input.achievement.participantCount,
      });

      // Denormalised counter drives the profile header and the list view.
      await tx
        .update(schema.applicants)
        .set({ recordCount: sql`${schema.applicants.recordCount} + 1` })
        .where(eq(schema.applicants.id, applicantId));

      await this.timeline.write(
        {
          applicantId,
          recordId,
          eventType: TIMELINE_EVENT.RECORD_CREATED,
          summary: `New record opened — "${input.achievement.recordTitle}"`,
          meta: {
            recordCode,
            source: input.source,
            // Makes it obvious on the timeline that this is a returning
            // applicant rather than a first-time one.
            isAdditionalRecord: true,
          },
        },
        tx,
      );

      await this.audit.record(
        {
          action: AUDIT.RECORD_CREATED,
          entityType: 'record',
          entityId: recordId,
          entityLabel: `${recordCode} — ${input.achievement.recordTitle}`,
          meta: {
            applicantCode: applicant.applicantCode,
            additionalRecord: true,
            override: Boolean(input.override),
            overrideReason: input.overrideReason ?? null,
          },
        },
        tx,
      );

      await this.cache.invalidateTags(
        CacheTag.applicant(applicantId),
        CacheTag.applicantList(),
        CacheTag.dashboard(),
      );

      return { recordId, recordCode };
    });
  }

  /**
   * Certificate history across every record on a profile (§10).
   *
   * "Old certificates should never be deleted. Version history must remain
   * available." A returning applicant accumulates one certificate per record,
   * each with its own immutable version chain — this returns the lot, which is
   * what makes the profile a genuine lifetime file.
   */
  async getCertificateHistory(applicantId: string) {
    const rows = await this.db
      .select({
        certificateId: schema.certificates.id,
        recordId: schema.certificates.recordId,
        recordCode: schema.records.recordCode,
        recordTitle: schema.achievements.recordTitle,
        certificateNumber: schema.certificates.certificateNumber,
        currentVersion: schema.certificates.currentVersion,
        issueDate: schema.certificates.issueDate,
        versionCount: sql<number>`(
          SELECT count(*)::int FROM certificate_versions cv
           WHERE cv.certificate_id = ${schema.certificates.id}
        )`,
      })
      .from(schema.certificates)
      .innerJoin(schema.records, eq(schema.certificates.recordId, schema.records.id))
      .leftJoin(schema.achievements, eq(schema.achievements.recordId, schema.records.id))
      .where(eq(schema.certificates.applicantId, applicantId))
      .orderBy(sql`${schema.certificates.issueDate} DESC NULLS LAST`);

    return rows;
  }
}
