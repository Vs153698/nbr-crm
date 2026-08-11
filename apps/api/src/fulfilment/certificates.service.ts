import { Inject, Injectable } from '@nestjs/common';
import {
  CERTIFICATE_VERIFICATION,
  financialYearOf,
  formatCertificateNumber,
  RECORD_STATUS,
  TIMELINE_EVENT,
  type CertificateVerification,
} from '@nbr/shared';
import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { AUDIT, AuditService } from '../audit/audit.service';
import { ConflictError, NotFoundError, ValidationError } from '../common/errors';
import { requireActor } from '../common/request-context';
import type { Database } from '../database/client';
import { DB } from '../database/database.tokens';
import * as schema from '../database/schema';
import { LegacyPushService } from '../integrations/legacy-push.service';
import { RecordAdvanceService } from '../records/auto-advance.service';
import { CacheService, CacheTag } from '../redis/cache.service';
import { StorageService } from '../storage/storage.service';
import { TimelineService } from '../timeline/timeline.service';

export interface CertificateView {
  readonly id: string;
  readonly certificateNumber: string | null;
  readonly recordNumber: string | null;
  readonly currentVersion: number;
  readonly issueDate: string | null;
  /** `awaiting_upload | pending_verification | verified`. */
  readonly verificationStatus: CertificateVerification;
  readonly verifiedAt: string | null;
  readonly verifiedByName: string | null;
  readonly verifiedVersion: number | null;
  readonly verificationNotes: string | null;
  /** True when the current version is the one that was signed off. */
  readonly isCurrentVersionVerified: boolean;
  readonly versions: ReadonlyArray<{
    id: string;
    version: number;
    certificateNumber: string | null;
    issueDate: string | null;
    versionReason: string | null;
    hasEditableFile: boolean;
    uploadedByName: string | null;
    createdAt: string;
    isCurrent: boolean;
    /** This exact version carries the sign-off, not merely the certificate. */
    isVerified: boolean;
  }>;
}

/**
 * Certificates (§10, P2-02).
 *
 * Nothing here generates a certificate. The designer produces the PDF, an
 * employee uploads it, and a **second, separate act** by an employee — the
 * sign-off in `verify` — is what makes it the official certificate and releases
 * the record to Dispatch. Splitting those two is the point: a file arriving is
 * not the same event as a person confirming it is correct, and collapsing them
 * is how a draft ends up in an applicant's hands.
 *
 * Three properties hold:
 *
 *  • **Old certificates are never destroyed.** Each upload appends a
 *    `certificate_versions` row behind an append-only trigger, so a corrected
 *    certificate becomes v2 while v1 stays downloadable with its own trail —
 *    which matters when an applicant produces a five-year-old certificate and
 *    NBR must confirm what was issued.
 *  • **Approval never transfers.** A new version resets the certificate to
 *    `pending_verification`, because the sign-off belonged to the file it
 *    replaced.
 *  • **Nothing automatic completes the stage.** Not a payment settling, and
 *    notably not the public website — which mints a certificate number of its
 *    own the moment money lands. That number is recorded for reference and is
 *    never allowed to stand in for a certificate an employee has approved.
 */
@Injectable()
export class CertificatesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly storage: StorageService,
    private readonly timeline: TimelineService,
    private readonly audit: AuditService,
    private readonly cache: CacheService,
    private readonly legacy: LegacyPushService,
    private readonly advance: RecordAdvanceService,
  ) {}

  /**
   * M-04 Upload Certificate. Always appends a version — there is deliberately
   * no "replace" path.
   *
   * Uploading does **not** complete the certificate stage. The record stays in
   * Certificate Verification and the certificate sits at
   * `pending_verification` until an employee signs it off in `verify` below.
   */
  async upload(input: {
    recordId: string;
    certificateNumber?: string;
    recordNumber?: string;
    issueDate: Date;
    pdfKey: string;
    editableFileKey?: string;
    versionReason?: string;
  }): Promise<{ certificateId: string; version: number; certificateNumber: string }> {
    const actor = requireActor();
    const record = await this.loadRecord(input.recordId);

    const head = await this.storage.verifyUploaded(input.pdfKey);
    if (!head.exists) {
      throw new ValidationError({
        pdfKey: ['That upload did not complete. Please upload the certificate PDF again.'],
      });
    }

    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(schema.certificates)
        .where(eq(schema.certificates.recordId, input.recordId))
        .limit(1);

      // Allocate a number only on first issue. A correction keeps the original
      // number — reissuing under a new one would make the old certificate look
      // like a different record.
      let certificateNumber = existing?.certificateNumber ?? input.certificateNumber ?? null;

      if (!certificateNumber) {
        const financialYear = financialYearOf(input.issueDate);
        const result = await tx.execute<{ next_in_series: number }>(
          sql`SELECT next_in_series('certificate', ${financialYear}) AS next_in_series`,
        );
        const sequence = Number(
          (result as unknown as Array<{ next_in_series: number }>)[0]!.next_in_series,
        );
        certificateNumber = formatCertificateNumber(financialYear, sequence);
      }

      // A row may already exist with no version behind it — the website's
      // auto-minted number is recorded that way. `currentVersion` counts real
      // uploads, so the first upload is always v1 whatever the head row says.
      const [uploadedSoFar] = existing
        ? await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(schema.certificateVersions)
            .where(eq(schema.certificateVersions.certificateId, existing.id))
        : [];

      const nextVersion = (uploadedSoFar?.count ?? 0) + 1;

      const [certificate] = await tx
        .insert(schema.certificates)
        .values({
          recordId: input.recordId,
          applicantId: record.applicantId,
          certificateNumber,
          recordNumber: input.recordNumber ?? record.recordCode,
          currentVersion: nextVersion,
          issueDate: input.issueDate,
          verificationStatus: CERTIFICATE_VERIFICATION.PENDING_VERIFICATION,
        })
        .onConflictDoUpdate({
          target: schema.certificates.recordId,
          set: {
            currentVersion: nextVersion,
            issueDate: input.issueDate,
            ...(input.recordNumber ? { recordNumber: input.recordNumber } : {}),
            /**
             * Back to unverified, every time.
             *
             * A correction is a different document from the one that was
             * approved — different name spelling, different date, sometimes a
             * different achievement — and letting it inherit the earlier
             * sign-off would mean the version an employee actually checked is
             * not the version that goes out. The stamps are cleared with it so
             * the record cannot claim a verifier who never saw this file.
             */
            verificationStatus: CERTIFICATE_VERIFICATION.PENDING_VERIFICATION,
            verifiedAt: null,
            verifiedByUserId: null,
            verifiedVersion: null,
            verificationNotes: null,
          },
        })
        .returning({ id: schema.certificates.id });

      const certificateId = certificate!.id;

      await tx.insert(schema.certificateVersions).values({
        certificateId,
        version: nextVersion,
        pdfKey: input.pdfKey,
        editableFileKey: input.editableFileKey ?? null,
        certificateNumber,
        issueDate: input.issueDate,
        versionReason: input.versionReason ?? (nextVersion === 1 ? 'Initial issue' : null),
        uploadedByUserId: actor.userId,
      });

      /**
       * `hasCertificate` means "a file is on record", not "the stage is done".
       *
       * The two used to be the same thing, which is what let an unchecked
       * upload — or the website's own certificate push, which uploads nothing
       * at all — read as a completed certificate stage. Completion now lives
       * in `verification_status`, and this flag is left to do the smaller job
       * the list view and the evidence checks actually want from it.
       */
      await tx
        .update(schema.records)
        .set({ hasCertificate: true })
        .where(eq(schema.records.id, input.recordId));

      await this.timeline.write(
        {
          applicantId: record.applicantId,
          recordId: input.recordId,
          eventType:
            nextVersion === 1
              ? TIMELINE_EVENT.CERTIFICATE_UPLOADED
              : TIMELINE_EVENT.CERTIFICATE_VERSIONED,
          summary:
            nextVersion === 1
              ? `Certificate ${certificateNumber} uploaded (v1) — awaiting verification`
              : `Certificate ${certificateNumber} re-uploaded as v${nextVersion}${input.versionReason ? ` — ${input.versionReason}` : ''} — awaiting verification`,
          meta: {
            certificateNumber,
            version: nextVersion,
            reason: input.versionReason ?? null,
            verificationStatus: CERTIFICATE_VERIFICATION.PENDING_VERIFICATION,
          },
        },
        tx,
      );

      await this.audit.record(
        {
          action: AUDIT.CERTIFICATE_UPLOADED,
          entityType: 'certificate',
          entityId: certificateId,
          entityLabel: `${certificateNumber} v${nextVersion}`,
          meta: { recordCode: record.recordCode, reason: input.versionReason ?? null },
        },
        tx,
      );

      await this.bust(input.recordId, record.applicantId);

      /**
       * The website is told at sign-off, not here.
       *
       * Registering the number on upload published it to the public
       * verification page before anyone had checked the file — so a draft with
       * a misspelt name was verifiable to the world for as long as it took
       * someone to notice. `verify` is the moment the certificate becomes
       * official, and that is the moment it crosses over.
       */
      return { certificateId, version: nextVersion, certificateNumber };
    });
  }

  /**
   * M-04b Mark Certificate Verified — the employee's sign-off.
   *
   * This is the only thing that completes the certificate stage. It stamps who
   * checked it, when, and which version they checked; makes that certificate
   * the official one on the public website; and releases the record to
   * Dispatch.
   *
   * The two advances are chained rather than jumping straight to Dispatch
   * Pending so the record's history reads the way the process actually runs —
   * Certificate Verification → Certificate Completed → Dispatch Pending — and
   * so a reader of the timeline can see the sign-off as its own event rather
   * than inferring it from a two-stage leap.
   */
  async verify(input: {
    recordId: string;
    notes?: string;
  }): Promise<{
    certificateId: string;
    certificateNumber: string | null;
    verifiedVersion: number;
    status: string;
  }> {
    const actor = requireActor();
    const record = await this.loadRecord(input.recordId);

    const [certificate] = await this.db
      .select()
      .from(schema.certificates)
      .where(eq(schema.certificates.recordId, input.recordId))
      .limit(1);

    if (!certificate) {
      throw new ValidationError({
        certificate: ['Upload the certificate before marking it verified.'],
      });
    }

    // A head row can exist with nothing behind it — that is how the website's
    // auto-minted number is recorded. Signing that off would complete the stage
    // on a certificate that does not exist as a file anywhere.
    const [latest] = await this.db
      .select({ version: schema.certificateVersions.version })
      .from(schema.certificateVersions)
      .where(eq(schema.certificateVersions.certificateId, certificate.id))
      .orderBy(desc(schema.certificateVersions.version))
      .limit(1);

    if (!latest) {
      throw new ValidationError({
        certificate: [
          'No certificate file has been uploaded for this record yet. Upload it first, then mark it verified.',
        ],
      });
    }

    if (
      certificate.verificationStatus === CERTIFICATE_VERIFICATION.VERIFIED &&
      certificate.verifiedVersion === latest.version
    ) {
      throw new ConflictError(
        'ALREADY_VERIFIED',
        `Version ${latest.version} has already been verified. Upload a new version if it needs correcting.`,
      );
    }

    const verifiedAt = new Date();

    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.certificates)
        .set({
          verificationStatus: CERTIFICATE_VERIFICATION.VERIFIED,
          verifiedAt,
          verifiedByUserId: actor.userId,
          verifiedVersion: latest.version,
          verificationNotes: input.notes ?? null,
        })
        .where(eq(schema.certificates.id, certificate.id));

      await this.timeline.write(
        {
          applicantId: record.applicantId,
          recordId: input.recordId,
          eventType: TIMELINE_EVENT.CERTIFICATE_UPLOADED,
          summary: `Certificate ${certificate.certificateNumber ?? ''} v${latest.version} verified and marked complete${input.notes ? ` — ${input.notes}` : ''}`.trim(),
          meta: {
            certificateNumber: certificate.certificateNumber,
            version: latest.version,
            notes: input.notes ?? null,
          },
        },
        tx,
      );

      await this.audit.record(
        {
          action: AUDIT.CERTIFICATE_UPLOADED,
          entityType: 'certificate',
          entityId: certificate.id,
          entityLabel: `${certificate.certificateNumber ?? record.recordCode} v${latest.version} verified`,
          meta: { recordCode: record.recordCode, notes: input.notes ?? null },
        },
        tx,
      );

      // Certificate Verification → Certificate Completed → Dispatch Pending.
      // Only from the certificate stage: a record already past Dispatch is
      // having a correction signed off, and must not be dragged backwards.
      const completed = await this.advance.advance(
        {
          recordId: input.recordId,
          applicantId: record.applicantId,
          expectedFrom: [RECORD_STATUS.PAYMENT_RECEIVED, RECORD_STATUS.CERTIFICATE_PENDING],
          to: RECORD_STATUS.CERTIFICATE_UPLOADED,
          reason: `certificate v${latest.version} verified by ${actor.fullName}`,
        },
        tx,
      );

      if (completed) {
        await this.advance.advance(
          {
            recordId: input.recordId,
            applicantId: record.applicantId,
            expectedFrom: [RECORD_STATUS.CERTIFICATE_UPLOADED],
            to: RECORD_STATUS.DISPATCH_PENDING,
            reason: 'certificate stage completed',
          },
          tx,
        );
      }
    });

    await this.bust(input.recordId, record.applicantId);

    // Now it is official: register the number so the website's public
    // verification page recognises it.
    if (certificate.certificateNumber) {
      this.legacy.pushCertificate(input.recordId, {
        action: 'issue',
        certificateId: certificate.certificateNumber,
      });
    }

    const [after] = await this.db
      .select({ status: schema.records.status })
      .from(schema.records)
      .where(eq(schema.records.id, input.recordId))
      .limit(1);

    return {
      certificateId: certificate.id,
      certificateNumber: certificate.certificateNumber,
      verifiedVersion: latest.version,
      status: after?.status ?? RECORD_STATUS.CERTIFICATE_UPLOADED,
    };
  }

  async getByRecord(recordId: string): Promise<CertificateView | null> {
    const [certificate] = await this.db
      .select()
      .from(schema.certificates)
      .where(eq(schema.certificates.recordId, recordId))
      .limit(1);

    if (!certificate) return null;

    const [verifier] = certificate.verifiedByUserId
      ? await this.db
          .select({ fullName: schema.users.fullName })
          .from(schema.users)
          .where(eq(schema.users.id, certificate.verifiedByUserId))
          .limit(1)
      : [];

    const versions = await this.db
      .select({
        id: schema.certificateVersions.id,
        version: schema.certificateVersions.version,
        certificateNumber: schema.certificateVersions.certificateNumber,
        issueDate: schema.certificateVersions.issueDate,
        versionReason: schema.certificateVersions.versionReason,
        editableFileKey: schema.certificateVersions.editableFileKey,
        uploadedByName: schema.users.fullName,
        createdAt: schema.certificateVersions.createdAt,
      })
      .from(schema.certificateVersions)
      .leftJoin(schema.users, eq(schema.certificateVersions.uploadedByUserId, schema.users.id))
      .where(eq(schema.certificateVersions.certificateId, certificate.id))
      .orderBy(desc(schema.certificateVersions.version));

    // A head row with no versions behind it is the website's auto-minted
    // number, recorded for reference. Nothing has been uploaded, so the honest
    // state is "awaiting upload" rather than the column's stored default.
    const verificationStatus = (
      versions.length === 0
        ? CERTIFICATE_VERIFICATION.AWAITING_UPLOAD
        : certificate.verificationStatus
    ) as CertificateVerification;

    return {
      id: certificate.id,
      certificateNumber: certificate.certificateNumber,
      recordNumber: certificate.recordNumber,
      currentVersion: certificate.currentVersion,
      issueDate: certificate.issueDate?.toISOString() ?? null,
      verificationStatus,
      verifiedAt: certificate.verifiedAt?.toISOString() ?? null,
      verifiedByName: verifier?.fullName ?? null,
      verifiedVersion: certificate.verifiedVersion,
      verificationNotes: certificate.verificationNotes,
      isCurrentVersionVerified:
        verificationStatus === CERTIFICATE_VERIFICATION.VERIFIED &&
        certificate.verifiedVersion === certificate.currentVersion,
      versions: versions.map((v) => ({
        id: v.id,
        version: v.version,
        certificateNumber: v.certificateNumber,
        issueDate: v.issueDate?.toISOString() ?? null,
        versionReason: v.versionReason,
        hasEditableFile: Boolean(v.editableFileKey),
        uploadedByName: v.uploadedByName,
        createdAt: v.createdAt.toISOString(),
        isCurrent: v.version === certificate.currentVersion,
        isVerified:
          verificationStatus === CERTIFICATE_VERIFICATION.VERIFIED &&
          certificate.verifiedVersion === v.version,
      })),
    };
  }

  /**
   * Download URL for a specific version — including superseded ones, which is
   * the whole point of keeping them (§11 stage 9 "Allow Certificate
   * Re-download").
   */
  async getVersionDownloadUrl(
    versionId: string,
    which: 'pdf' | 'editable' = 'pdf',
  ): Promise<{ url: string; fileName: string }> {
    const [version] = await this.db
      .select()
      .from(schema.certificateVersions)
      .where(eq(schema.certificateVersions.id, versionId))
      .limit(1);

    if (!version) throw new NotFoundError('Certificate version');

    const key = which === 'editable' ? version.editableFileKey : version.pdfKey;
    if (!key) throw new NotFoundError('Editable source file');

    const safeNumber = (version.certificateNumber ?? 'certificate').replace(/[^\w.-]+/g, '-');
    const fileName = `${safeNumber}-v${version.version}.${which === 'editable' ? 'src' : 'pdf'}`;

    const url = await this.storage.presignDownload(key, fileName);

    await this.audit.record({
      action: AUDIT.FILE_DOWNLOADED,
      entityType: 'certificate_version',
      entityId: versionId,
      entityLabel: fileName,
    });

    return { url, fileName };
  }

  /**
   * The certificates queue (W-21) — records whose certificate stage is open.
   *
   * Membership is now decided by verification, not by whether a file exists.
   * The old test — `has_certificate = false` — dropped a record out of the
   * queue the moment anything was uploaded, so a certificate sitting unchecked,
   * or one the website had auto-minted a number for, was invisible to the very
   * team responsible for finishing it. Those are exactly the rows that need
   * attention, so the queue reports what each is waiting for.
   */
  async pendingQueue(limit = 100) {
    const rows = await this.db
      .select({
        recordId: schema.records.id,
        recordCode: schema.records.recordCode,
        applicantId: schema.records.applicantId,
        applicantName: schema.applicants.fullName,
        recordTitle: schema.achievements.recordTitle,
        status: schema.records.status,
        paymentStatus: schema.records.paymentStatus,
        updatedAt: schema.records.updatedAt,
        certificateNumber: schema.certificates.certificateNumber,
        verificationStatus: schema.certificates.verificationStatus,
        uploadedVersions: sql<number>`(
          SELECT count(*)::int FROM certificate_versions cv
           WHERE cv.certificate_id = ${schema.certificates.id}
        )`,
      })
      .from(schema.records)
      .innerJoin(schema.applicants, eq(schema.records.applicantId, schema.applicants.id))
      .leftJoin(schema.achievements, eq(schema.achievements.recordId, schema.records.id))
      .leftJoin(schema.certificates, eq(schema.certificates.recordId, schema.records.id))
      .where(
        and(
          isNull(schema.records.deletedAt),
          inArray(schema.records.status, [
            RECORD_STATUS.PAYMENT_RECEIVED,
            RECORD_STATUS.CERTIFICATE_PENDING,
          ]),
          // Verified rows leave the queue even if the auto-advance to Dispatch
          // was blocked by something else — they need nothing from this team.
          sql`(${schema.certificates.verificationStatus} IS NULL
               OR ${schema.certificates.verificationStatus} <> ${CERTIFICATE_VERIFICATION.VERIFIED})`,
        ),
      )
      .orderBy(schema.records.updatedAt)
      .limit(limit);

    return rows.map((row) => ({
      ...row,
      verificationStatus:
        row.uploadedVersions && row.uploadedVersions > 0
          ? (row.verificationStatus as CertificateVerification)
          : CERTIFICATE_VERIFICATION.AWAITING_UPLOAD,
      /** What this row is actually waiting for, so the queue is scannable. */
      waitingOn:
        row.uploadedVersions && row.uploadedVersions > 0
          ? ('verification' as const)
          : ('upload' as const),
    }));
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
    );
  }
}
