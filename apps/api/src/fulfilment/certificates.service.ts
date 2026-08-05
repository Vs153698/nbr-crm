import { Inject, Injectable } from '@nestjs/common';
import { financialYearOf, formatCertificateNumber, TIMELINE_EVENT } from '@nbr/shared';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { AUDIT, AuditService } from '../audit/audit.service';
import { NotFoundError, ValidationError } from '../common/errors';
import { requireActor } from '../common/request-context';
import type { Database } from '../database/client';
import { DB } from '../database/database.tokens';
import * as schema from '../database/schema';
import { LegacyPushService } from '../integrations/legacy-push.service';
import { CacheService, CacheTag } from '../redis/cache.service';
import { StorageService } from '../storage/storage.service';
import { TimelineService } from '../timeline/timeline.service';

export interface CertificateView {
  readonly id: string;
  readonly certificateNumber: string | null;
  readonly recordNumber: string | null;
  readonly currentVersion: number;
  readonly issueDate: string | null;
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
  }>;
}

/**
 * Certificates (§10, P2-02).
 *
 * "No automatic certificate generation is required at present" — the designer
 * produces the PDF, staff upload it. What the system guarantees is the part a
 * human process cannot: **old certificates are never destroyed.**
 *
 * Each upload appends a `certificate_versions` row. That table has an
 * append-only trigger, so a corrected certificate becomes v2 while v1 stays
 * downloadable with its own audit trail — which matters when an applicant
 * produces a five-year-old certificate and NBR must confirm what was issued.
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
  ) {}

  /**
   * M-04 Upload Certificate. Always appends a version — there is deliberately
   * no "replace" path.
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

      const nextVersion = (existing?.currentVersion ?? 0) + 1;

      const [certificate] = await tx
        .insert(schema.certificates)
        .values({
          recordId: input.recordId,
          applicantId: record.applicantId,
          certificateNumber,
          recordNumber: input.recordNumber ?? record.recordCode,
          currentVersion: nextVersion,
          issueDate: input.issueDate,
        })
        .onConflictDoUpdate({
          target: schema.certificates.recordId,
          set: {
            currentVersion: nextVersion,
            issueDate: input.issueDate,
            ...(input.recordNumber ? { recordNumber: input.recordNumber } : {}),
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
              ? `Certificate ${certificateNumber} issued`
              : `Certificate ${certificateNumber} re-issued as v${nextVersion}${input.versionReason ? ` — ${input.versionReason}` : ''}`,
          meta: { certificateNumber, version: nextVersion, reason: input.versionReason ?? null },
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

      // Register the number on the website so its public verification page
      // recognises a certificate issued here. Only the number crosses over —
      // the PDF stays in our vault, and the website mints nothing of its own.
      this.legacy.pushCertificate(input.recordId, {
        action: 'issue',
        certificateId: certificateNumber,
      });

      return { certificateId, version: nextVersion, certificateNumber };
    });
  }

  async getByRecord(recordId: string): Promise<CertificateView | null> {
    const [certificate] = await this.db
      .select()
      .from(schema.certificates)
      .where(eq(schema.certificates.recordId, recordId))
      .limit(1);

    if (!certificate) return null;

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

    return {
      id: certificate.id,
      certificateNumber: certificate.certificateNumber,
      recordNumber: certificate.recordNumber,
      currentVersion: certificate.currentVersion,
      issueDate: certificate.issueDate?.toISOString() ?? null,
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

  /** The certificates queue (W-21) — records awaiting one. */
  async pendingQueue(limit = 100) {
    return this.db
      .select({
        recordId: schema.records.id,
        recordCode: schema.records.recordCode,
        applicantId: schema.records.applicantId,
        applicantName: schema.applicants.fullName,
        recordTitle: schema.achievements.recordTitle,
        status: schema.records.status,
        paymentStatus: schema.records.paymentStatus,
        updatedAt: schema.records.updatedAt,
      })
      .from(schema.records)
      .innerJoin(schema.applicants, eq(schema.records.applicantId, schema.applicants.id))
      .leftJoin(schema.achievements, eq(schema.achievements.recordId, schema.records.id))
      .where(
        and(
          isNull(schema.records.deletedAt),
          eq(schema.records.hasCertificate, false),
          sql`${schema.records.status} IN ('payment_received', 'certificate_pending')`,
        ),
      )
      .orderBy(schema.records.updatedAt)
      .limit(limit);
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
