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
import {
  BlacklistBlockedError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../common/errors';
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

  /**
   * Back-entry of a record NBR awarded before this system existed. Supplying
   * the holder's existing number is what makes the entry historical — see
   * `addRecordSchema`, which relaxes the intake status rules on the same signal.
   */
  readonly existingRecordCode?: string | undefined;
  readonly existingCertificateNumber?: string | undefined;
  readonly originallyAwardedOn?: Date | undefined;
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

    const backEntryCode = input.existingRecordCode?.trim().toUpperCase();

    // Checked before the transaction so the caller gets a field-level error
    // rather than a unique-violation surfacing as a 500.
    if (backEntryCode) {
      const [clash] = await this.db
        .select({ id: schema.records.id })
        .from(schema.records)
        .where(eq(schema.records.recordCode, backEntryCode))
        .limit(1);

      if (clash) {
        throw new ValidationError({
          existingRecordCode: [`${backEntryCode} is already in use by another record.`],
        });
      }
    }

    return this.db.transaction(async (tx) => {
      let recordCode: string;

      if (backEntryCode) {
        // Their own number, carried across verbatim. The sequence is left
        // alone: burning a number for a record that will never use it would
        // put a permanent gap in the new-record series.
        recordCode = backEntryCode;
      } else {
        const result = await tx.execute<{ nextval: string }>(
          sql`SELECT nextval('record_code_seq')::text AS nextval`,
        );
        const sequence = Number((result as unknown as Array<{ nextval: string }>)[0]!.nextval);
        recordCode = formatRecordId(sequence);
      }

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

      // A certificate the holder already has. Registered so the profile shows
      // the number they will quote on the phone, and so a reissue versions from
      // it rather than starting again at v1.
      if (backEntryCode && input.existingCertificateNumber) {
        await tx.insert(schema.certificates).values({
          recordId,
          applicantId,
          certificateNumber: input.existingCertificateNumber.trim(),
          issueDate: input.originallyAwardedOn ?? null,
        });

        await tx
          .update(schema.records)
          .set({ hasCertificate: true })
          .where(eq(schema.records.id, recordId));
      }

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
          summary: backEntryCode
            ? `Existing record ${recordCode} entered — "${input.achievement.recordTitle}"`
            : `New record opened — "${input.achievement.recordTitle}"`,
          meta: {
            recordCode,
            source: input.source,
            // Makes it obvious on the timeline that this is a returning
            // applicant rather than a first-time one.
            isAdditionalRecord: true,
            // A back-entry describes something NBR already did. Without this the
            // timeline would read as though the award happened today.
            backEntry: Boolean(backEntryCode),
            originallyAwardedOn: input.originallyAwardedOn?.toISOString() ?? null,
            existingCertificateNumber: input.existingCertificateNumber ?? null,
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
            backEntry: Boolean(backEntryCode),
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
