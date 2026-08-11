import { Inject, Injectable } from '@nestjs/common';
import {
  ageInYears,
  CHILD_AGE_THRESHOLD_YEARS,
  formatApplicantId,
  formatRecordId,
  normaliseEmail,
  normaliseMobile,
  normaliseName,
  PURPOSE_META,
  RECORD_STATUS,
  TIMELINE_EVENT,
  type CreateApplicantInput,
  type DuplicateMatch,
} from '@nbr/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { AUDIT, AuditService, buildDiff } from '../audit/audit.service';
import {
  BlacklistBlockedError,
  DuplicateApplicantError,
  ForbiddenError,
  NotFoundError,
  StaleWriteError,
  ValidationError,
} from '../common/errors';
import { requireActor } from '../common/request-context';
import type { Database } from '../database/client';
import { DB } from '../database/database.tokens';
import * as schema from '../database/schema';
import { PiiService } from '../privacy/pii.service';
import { CacheService, CacheTag } from '../redis/cache.service';
import { TimelineService } from '../timeline/timeline.service';
import { DuplicateService } from './duplicate.service';

export interface CreateApplicantResult {
  readonly applicantId: string;
  readonly applicantCode: string;
  readonly recordId: string;
  readonly recordCode: string;
  readonly duplicateWarnings: readonly DuplicateMatch[];
}

/**
 * Master applicant profile (§4, P1-08).
 *
 * The invariant this service defends: one person = one `applicants` row,
 * forever. Every creation path runs duplicate detection first, and a strong
 * match requires the caller to make an explicit choice — add a record to the
 * existing profile, or override with a reason that lands in the audit log.
 */
@Injectable()
export class ApplicantsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly duplicates: DuplicateService,
    private readonly pii: PiiService,
    private readonly timeline: TimelineService,
    private readonly audit: AuditService,
    private readonly cache: CacheService,
  ) {}

  /**
   * Create an applicant and their first record in one transaction (W-05).
   *
   * Either the whole profile exists or none of it does — a half-created
   * applicant with no record is an orphan that nothing in the UI can reach.
   */
  async create(input: CreateApplicantInput): Promise<CreateApplicantResult> {
    const actor = requireActor();

    // ── Duplicate + blacklist gate (§18, §19) ─────────────────────────────
    const matches = await this.duplicates.check({
      mobile: input.applicant.mobile,
      email: input.applicant.email,
      fullName: input.applicant.fullName,
      dateOfBirth: input.applicant.dateOfBirth,
      aadhaarNumber: input.identifiers?.aadhaarNumber,
      passportNumber: input.identifiers?.passportNumber,
    });

    const blacklisted = matches.filter((m) => m.isBlacklisted);
    if (blacklisted.length > 0) {
      // A blacklisted applicant cannot open a new record at all without an
      // Admin override — this is the hard block in §19, not a warning.
      const canOverride = actor.isSuperAdmin || actor.permissions.has('blacklist:override');
      if (!input.overrideDuplicate || !canOverride) {
        throw new BlacklistBlockedError({ matches: blacklisted });
      }
    }

    if (DuplicateService.isBlocking(matches) && !input.overrideDuplicate) {
      throw new DuplicateApplicantError(matches);
    }

    if (input.overrideDuplicate && matches.length > 0) {
      await this.audit.record({
        action: AUDIT.BLACKLIST_OVERRIDDEN,
        entityType: 'applicant',
        entityLabel: input.applicant.fullName,
        meta: {
          reason: input.overrideReason ?? null,
          matched: matches.map((m) => m.applicantCode),
        },
      });
    }

    const dob = input.applicant.dateOfBirth;
    const isMinor = dob ? ageInYears(dob) < CHILD_AGE_THRESHOLD_YEARS : false;

    // DPDP §9 — a child's personal data may only be processed with verifiable
    // parental consent. Refuse the create rather than storing it and hoping
    // someone collects the consent later.
    if (isMinor && !input.consent?.guardianName) {
      throw new ForbiddenError(
        'This applicant is under 18. Record the parent or guardian who is giving consent before saving (DPDP Act §9).',
      );
    }

    // Back-entry of a record NBR awarded before this system existed. Checked
    // before the transaction so a clash is a field error rather than a unique
    // violation surfacing as a 500.
    const backEntryCode = input.record.existingRecordCode?.trim().toUpperCase();
    if (backEntryCode) {
      const [clash] = await this.db
        .select({ id: schema.records.id })
        .from(schema.records)
        .where(eq(schema.records.recordCode, backEntryCode))
        .limit(1);

      if (clash) {
        throw new ValidationError({
          'record.existingRecordCode': [`${backEntryCode} is already in use by another record.`],
        });
      }
    }

    return this.db.transaction(async (tx) => {
      const applicantSeq = await nextSequence(tx, 'applicant_code_seq');
      // The sequence is only drawn when a number is actually being minted:
      // burning one for a back-entry would leave a permanent gap in the series.
      const recordCode = backEntryCode ?? formatRecordId(await nextSequence(tx, 'record_code_seq'));

      const [applicant] = await tx
        .insert(schema.applicants)
        .values({
          applicantCode: formatApplicantId(applicantSeq),
          fullName: input.applicant.fullName,
          fatherName: input.applicant.fatherName ?? null,
          motherName: input.applicant.motherName ?? null,
          dateOfBirth: dob ? dob.toISOString().slice(0, 10) : null,
          gender: input.applicant.gender ?? null,
          mobile: input.applicant.mobile,
          mobileNormalised: normaliseMobile(input.applicant.mobile),
          whatsapp: input.applicant.whatsapp ?? null,
          email: input.applicant.email,
          emailNormalised: normaliseEmail(input.applicant.email),
          addressLine: input.applicant.addressLine ?? null,
          city: input.applicant.city ?? null,
          state: input.applicant.state ?? null,
          country: input.applicant.country,
          pincode: input.applicant.pincode ?? null,
          nationality: input.applicant.nationality ?? null,
          photoKey: input.applicant.photoKey ?? null,
          nameNormalised: normaliseName(input.applicant.fullName),
          recordCount: 1,
          isMinorAtIntake: isMinor,
          createdByUserId: actor.userId,
        })
        .returning({ id: schema.applicants.id, code: schema.applicants.applicantCode });

      const applicantId = applicant!.id;

      // Government identifiers, encrypted before they touch the database.
      if (input.identifiers) {
        const encrypted = this.pii.buildEncryptedRow(input.identifiers);
        if (encrypted) {
          await tx
            .insert(schema.applicantIdentifiers)
            .values({ applicantId, ...encrypted } as never);
        }
      }

      const [record] = await tx
        .insert(schema.records)
        .values({
          recordCode,
          applicantId,
          status: input.record.initialStatus,
          source: input.record.source,
          assignedToUserId: input.record.assignedToUserId ?? null,
          internalRemarks: input.record.internalRemarks ?? null,
          createdByUserId: actor.userId,
        })
        .returning({ id: schema.records.id, code: schema.records.recordCode });

      const recordId = record!.id;

      // A certificate the holder already has, so the profile shows the number
      // they will quote rather than looking as though none was ever issued.
      if (backEntryCode && input.record.existingCertificateNumber) {
        await tx.insert(schema.certificates).values({
          recordId,
          applicantId,
          certificateNumber: input.record.existingCertificateNumber.trim(),
          issueDate: input.record.originallyAwardedOn ?? null,
        });

        await tx
          .update(schema.records)
          .set({ hasCertificate: true })
          .where(eq(schema.records.id, recordId));
      }

      await tx.insert(schema.achievements).values({
        recordId,
        recordTitle: input.record.achievement.recordTitle,
        categoryId: input.record.achievement.categoryId,
        recordType: input.record.achievement.recordType,
        description: input.record.achievement.description ?? null,
        achievementDate: input.record.achievement.achievementDate
          ? input.record.achievement.achievementDate.toISOString().slice(0, 10)
          : null,
        location: input.record.achievement.location ?? null,
        participantCount: input.record.achievement.participantCount,
      });

      // ── DPDP §6 consent ledger ──────────────────────────────────────────
      if (input.consent) {
        await tx.insert(schema.consentRecords).values(
          input.consent.purposes.map((purpose) => ({
            applicantId,
            recordId,
            purpose,
            state: 'granted',
            lawfulBasis: PURPOSE_META[purpose].basis,
            noticeVersion: input.consent!.noticeVersion,
            channel: input.consent!.channel,
            evidenceKey: input.consent!.evidenceKey ?? null,
            capturedNotes: null,
            guardianName: input.consent!.guardianName ?? null,
            guardianRelationship: input.consent!.guardianRelationship ?? null,
            guardianContact: input.consent!.guardianContact ?? null,
            isChildConsent: isMinor,
            recordedByUserId: actor.userId,
          })),
        );
      }

      // ── Timeline (§13) ──────────────────────────────────────────────────
      await this.timeline.writeMany(
        [
          {
            applicantId,
            recordId,
            eventType: TIMELINE_EVENT.APPLICANT_CREATED,
            summary: `Applicant profile created — ${input.applicant.fullName}`,
            meta: { applicantCode: applicant!.code },
          },
          {
            applicantId,
            recordId,
            eventType: TIMELINE_EVENT.RECORD_CREATED,
            summary: `Record opened — "${input.record.achievement.recordTitle}"`,
            meta: { recordCode: record!.code, source: input.record.source },
          },
          ...(input.consent
            ? [
                {
                  applicantId,
                  recordId,
                  eventType: TIMELINE_EVENT.CONSENT_RECORDED,
                  summary: `Consent recorded for ${input.consent.purposes.length} purpose(s) — notice v${input.consent.noticeVersion}`,
                  meta: { purposes: input.consent.purposes, channel: input.consent.channel },
                },
              ]
            : []),
        ],
        tx,
      );

      await this.audit.record(
        {
          action: AUDIT.APPLICANT_CREATED,
          entityType: 'applicant',
          entityId: applicantId,
          entityLabel: `${applicant!.code} — ${input.applicant.fullName}`,
          meta: { recordCode: record!.code, overrode: input.overrideDuplicate },
        },
        tx,
      );

      await this.cache.invalidateTags(CacheTag.dashboard(), CacheTag.applicantList());

      return {
        applicantId,
        applicantCode: applicant!.code,
        recordId,
        recordCode: record!.code,
        duplicateWarnings: matches,
      };
    });
  }

  /**
   * Update the master profile.
   *
   * `expectedUpdatedAt` implements the optimistic lock from §6 "Concurrency":
   * if someone else saved while this user had the form open, the write is
   * refused rather than silently overwriting their change.
   */
  async update(
    applicantId: string,
    input: {
      applicant: Partial<CreateApplicantInput['applicant']>;
      identifiers?: Partial<NonNullable<CreateApplicantInput['identifiers']>>;
      expectedUpdatedAt?: Date;
    },
  ): Promise<void> {
    const [existing] = await this.db
      .select()
      .from(schema.applicants)
      .where(and(eq(schema.applicants.id, applicantId), isNull(schema.applicants.deletedAt)))
      .limit(1);

    if (!existing) throw new NotFoundError('Applicant');

    if (
      input.expectedUpdatedAt &&
      existing.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()
    ) {
      throw new StaleWriteError('applicant');
    }

    const patch: Record<string, unknown> = { ...input.applicant };

    // Normalised columns are derived, never client-supplied — otherwise the
    // duplicate index could be bypassed by sending a mismatched pair.
    if (input.applicant.fullName) {
      patch.nameNormalised = normaliseName(input.applicant.fullName);
    }
    if (input.applicant.mobile) {
      patch.mobileNormalised = normaliseMobile(input.applicant.mobile);
    }
    if (input.applicant.email) {
      patch.emailNormalised = normaliseEmail(input.applicant.email);
    }
    if (input.applicant.dateOfBirth) {
      patch.dateOfBirth = input.applicant.dateOfBirth.toISOString().slice(0, 10);
    }

    await this.db.transaction(async (tx) => {
      await tx.update(schema.applicants).set(patch).where(eq(schema.applicants.id, applicantId));

      if (input.identifiers) {
        const encrypted = this.pii.buildEncryptedRow(input.identifiers);
        if (encrypted) {
          await tx
            .insert(schema.applicantIdentifiers)
            .values({ applicantId, ...encrypted } as never)
            .onConflictDoUpdate({
              target: schema.applicantIdentifiers.applicantId,
              set: encrypted as never,
            });
        }
      }

      await this.timeline.write(
        {
          applicantId,
          eventType: TIMELINE_EVENT.APPLICANT_UPDATED,
          summary: 'Applicant details updated',
          meta: { fields: Object.keys(input.applicant) },
        },
        tx,
      );

      await this.audit.record(
        {
          action: AUDIT.APPLICANT_UPDATED,
          entityType: 'applicant',
          entityId: applicantId,
          entityLabel: `${existing.applicantCode} — ${existing.fullName}`,
          changes: buildDiff(existing as unknown as Record<string, unknown>, patch),
        },
        tx,
      );
    });

    await this.cache.invalidateTags(CacheTag.applicant(applicantId), CacheTag.applicantList());
  }

  /**
   * The full profile payload behind the main working screen (H-06).
   *
   * Returned in one round trip on purpose: the profile header, six status
   * cards and every tab summary come from a single call, so opening an
   * applicant is one request rather than fourteen. Target p95 < 150 ms.
   */
  async getFull(applicantId: string): Promise<Record<string, unknown>> {
    const [applicant] = await this.db
      .select()
      .from(schema.applicants)
      .where(and(eq(schema.applicants.id, applicantId), isNull(schema.applicants.deletedAt)))
      .limit(1);

    if (!applicant) throw new NotFoundError('Applicant');

    const [records, flags, blacklists, identifiers] = await Promise.all([
      this.db
        .select({
          id: schema.records.id,
          recordCode: schema.records.recordCode,
          status: schema.records.status,
          source: schema.records.source,
          applicationDate: schema.records.applicationDate,
          assignedToUserId: schema.records.assignedToUserId,
          paymentStatus: schema.records.paymentStatus,
          deliveryStatus: schema.records.deliveryStatus,
          hasCertificate: schema.records.hasCertificate,
          hasPublication: schema.records.hasPublication,
          evidenceCount: schema.records.evidenceCount,
          lockedAt: schema.records.lockedAt,
          updatedAt: schema.records.updatedAt,
          recordTitle: schema.achievements.recordTitle,
          categoryId: schema.achievements.categoryId,
          recordType: schema.achievements.recordType,
          achievementDate: schema.achievements.achievementDate,
          location: schema.achievements.location,
          participantCount: schema.achievements.participantCount,
          // The applicant's words and NBR's, kept apart. Both travel so the
          // profile can show which is which rather than one merged title.
          description: schema.achievements.description,
          officialRecordTitle: schema.achievements.officialRecordTitle,
          approvedDescription: schema.achievements.approvedDescription,
          recognitionType: schema.achievements.recognitionType,
        })
        .from(schema.records)
        .leftJoin(schema.achievements, eq(schema.achievements.recordId, schema.records.id))
        .where(and(eq(schema.records.applicantId, applicantId), isNull(schema.records.deletedAt)))
        .orderBy(sql`${schema.records.createdAt} DESC`),

      this.db
        .select()
        .from(schema.applicantFlags)
        .where(
          and(
            eq(schema.applicantFlags.applicantId, applicantId),
            isNull(schema.applicantFlags.removedAt),
          ),
        ),

      this.db
        .select()
        .from(schema.blacklists)
        .where(
          and(eq(schema.blacklists.applicantId, applicantId), isNull(schema.blacklists.liftedAt)),
        ),

      this.pii.getMasked(applicantId),
    ]);

    return {
      applicant: {
        ...applicant,
        // The plaintext identifiers are never in this payload — only the
        // masked forms. Revealing one is a separate, permissioned, logged call.
        identifiers,
      },
      records,
      flags,
      blacklists,
    };
  }
}

/**
 * Allocate the next business ID from a Postgres sequence.
 *
 * A sequence rather than `MAX(code) + 1`: the latter races under concurrent
 * inserts and would eventually hand two applicants the same NBRAP number.
 */
async function nextSequence(tx: Database, sequence: string): Promise<number> {
  const result = await tx.execute<{ nextval: string }>(
    sql`SELECT nextval(${sequence})::text AS nextval`,
  );
  const row = (result as unknown as Array<{ nextval: string }>)[0];
  return Number(row!.nextval);
}
