import { Inject, Injectable, Logger } from '@nestjs/common';
import { EVIDENCE_KIND, TIMELINE_EVENT } from '@nbr/shared';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { AUDIT, AuditService } from '../audit/audit.service';
import { ForbiddenError, NotFoundError, ValidationError } from '../common/errors';
import { requireActor } from '../common/request-context';
import type { Database } from '../database/client';
import { DB } from '../database/database.tokens';
import * as schema from '../database/schema';
import { CacheService, CacheTag } from '../redis/cache.service';
import { StorageService, type UploadScope } from '../storage/storage.service';
import { TimelineService } from '../timeline/timeline.service';
import { LegacyPushService } from '../integrations/legacy-push.service';

export interface EvidenceItem {
  readonly id: string;
  readonly kind: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly description: string | null;
  readonly isSensitive: boolean;
  readonly scanStatus: string;
  readonly uploadedByName: string | null;
  readonly createdAt: string;
}

/**
 * Evidence vault and general attachments (§7, §16, P1-12, P1-13).
 *
 * The requirement is unusually strict: "Files should remain attached
 * permanently. No overwriting. Multiple uploads should be allowed."
 *
 * That is implemented three ways, so no single mistake can break it:
 *  1. Storage keys carry a UUID, so the same filename never collides.
 *  2. There is no delete endpoint on this service at all.
 *  3. A database trigger rejects DELETE on `evidence_files` outright.
 */
@Injectable()
export class VaultService {
  private readonly logger = new Logger(VaultService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly storage: StorageService,
    private readonly timeline: TimelineService,
    private readonly audit: AuditService,
    private readonly cache: CacheService,
    private readonly legacyPush: LegacyPushService,
  ) {}

  /**
   * Step 1 of an upload: hand the browser a presigned URL and remember that we
   * did. The intent row lets a nightly job find objects that were uploaded but
   * never confirmed, and caps what an authenticated user can push into the
   * bucket before any metadata row exists.
   */
  async presign(input: {
    scope: UploadScope;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    recordId?: string;
    applicantId?: string;
  }) {
    const actor = requireActor();

    const ownerId = input.recordId ?? input.applicantId ?? actor.userId;
    const presigned = await this.storage.presignUpload({
      scope: input.scope,
      ownerId,
      fileName: input.fileName,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
    });

    await this.db.insert(schema.uploadIntents).values({
      userId: actor.userId,
      scope: input.scope,
      storageKey: presigned.storageKey,
      fileName: input.fileName,
      contentType: input.contentType,
      declaredSizeBytes: input.sizeBytes,
      recordId: input.recordId ?? null,
      applicantId: input.applicantId ?? null,
      expiresAt: new Date(Date.now() + presigned.expiresInSeconds * 1000),
    });

    return presigned;
  }

  /**
   * Step 2: the browser reports the upload finished, and we record it.
   *
   * The object is verified against storage first — its real size and type, not
   * the client's claim. Otherwise the metadata row is unfounded, and a caller
   * could register a file that was never uploaded at all.
   */
  async confirmEvidence(input: {
    recordId: string;
    kind: string;
    storageKey: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    checksumSha256?: string;
    description?: string;
  }): Promise<{ id: string }> {
    const [record] = await this.db
      .select({
        id: schema.records.id,
        applicantId: schema.records.applicantId,
        recordCode: schema.records.recordCode,
      })
      .from(schema.records)
      .where(and(eq(schema.records.id, input.recordId), isNull(schema.records.deletedAt)))
      .limit(1);

    if (!record) throw new NotFoundError('Record');

    await this.assertIntentBelongsToCaller(input.storageKey);

    const head = await this.storage.verifyUploaded(input.storageKey);
    if (!head.exists) {
      throw new ValidationError({
        storageKey: ['That upload did not complete. Please try uploading the file again.'],
      });
    }

    // ID proofs and consent forms are the most sensitive objects in the vault;
    // flagging them here is what gates their download on `pii:reveal`.
    const isSensitive =
      input.kind === EVIDENCE_KIND.ID_PROOF || input.kind === EVIDENCE_KIND.CONSENT_FORM;

    const [inserted] = await this.db.transaction(async (tx) => {
      const rows = await tx
        .insert(schema.evidenceFiles)
        .values({
          recordId: record.id,
          applicantId: record.applicantId,
          kind: input.kind,
          storageKey: input.storageKey,
          fileName: input.fileName,
          contentType: head.contentType ?? input.contentType,
          // Trust storage over the client for the real byte count.
          sizeBytes: head.sizeBytes || input.sizeBytes,
          checksumSha256: input.checksumSha256 ?? null,
          description: input.description ?? null,
          isSensitive,
          uploadedByUserId: requireActor().userId,
        })
        .returning({ id: schema.evidenceFiles.id });

      // Denormalised counter feeds the list view and the has_evidence guard
      // without a COUNT per row.
      await tx
        .update(schema.records)
        .set({ evidenceCount: sql`${schema.records.evidenceCount} + 1` })
        .where(eq(schema.records.id, record.id));

      await tx
        .update(schema.uploadIntents)
        .set({ confirmedAt: new Date() })
        .where(eq(schema.uploadIntents.storageKey, input.storageKey));

      await this.timeline.write(
        {
          applicantId: record.applicantId,
          recordId: record.id,
          eventType: TIMELINE_EVENT.EVIDENCE_UPLOADED,
          summary: `Evidence uploaded — ${input.fileName}`,
          meta: { kind: input.kind, fileName: input.fileName, sizeBytes: head.sizeBytes },
        },
        tx,
      );

      await this.audit.record(
        {
          action: AUDIT.EVIDENCE_UPLOADED,
          entityType: 'evidence',
          entityId: rows[0]!.id,
          entityLabel: `${record.recordCode} — ${input.fileName}`,
          meta: { kind: input.kind, sensitive: isSensitive },
        },
        tx,
      );

      return rows;
    });

    await this.cache.invalidateTags(
      CacheTag.record(record.id),
      CacheTag.applicant(record.applicantId),
      CacheTag.applicantList(),
    );

    /**
     * Send it up to the website too.
     *
     * Its applicant portal, adjudicator view and certificate pack all read from
     * its own columns, so a document collected here was invisible to every one
     * of them. Skipped automatically for a CRM-native record — `push` requires
     * a mirror row and reports "does not exist on the website" otherwise.
     *
     * A signed URL rather than the bytes: the website fetches it once into its
     * own bucket, so a large video never travels through a JSON body and the
     * file outlives this system.
     */
    void this.storage
      .presignDownload(input.storageKey, input.fileName, 'inline')
      .then((downloadUrl) => {
        this.legacyPush.pushEvidence(record.id, {
          crmFileId: inserted!.id,
          fileName: input.fileName,
          contentType: head.contentType ?? input.contentType,
          kind: input.kind,
          downloadUrl,
        });
      })
      .catch((error: unknown) => {
        this.logger.error(
          `Could not sign ${input.fileName} for the website: ${error instanceof Error ? error.message : String(error)}`,
        );
      });

    return { id: inserted!.id };
  }

  async listEvidence(recordId: string): Promise<EvidenceItem[]> {
    const rows = await this.db
      .select({
        id: schema.evidenceFiles.id,
        kind: schema.evidenceFiles.kind,
        fileName: schema.evidenceFiles.fileName,
        contentType: schema.evidenceFiles.contentType,
        sizeBytes: schema.evidenceFiles.sizeBytes,
        description: schema.evidenceFiles.description,
        isSensitive: schema.evidenceFiles.isSensitive,
        scanStatus: schema.evidenceFiles.scanStatus,
        uploadedByName: schema.users.fullName,
        createdAt: schema.evidenceFiles.createdAt,
      })
      .from(schema.evidenceFiles)
      .leftJoin(schema.users, eq(schema.evidenceFiles.uploadedByUserId, schema.users.id))
      .where(eq(schema.evidenceFiles.recordId, recordId))
      .orderBy(desc(schema.evidenceFiles.createdAt));

    return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
  }

  /**
   * Issue a short-lived download URL.
   *
   * A file flagged sensitive requires `pii:reveal` and writes to the PII access
   * log — downloading someone's Aadhaar scan is the same act as decrypting
   * their Aadhaar number, and is treated the same way.
   */
  async getDownloadUrl(
    evidenceId: string,
    mode: 'attachment' | 'inline' = 'attachment',
  ): Promise<{ url: string; fileName: string; contentType: string }> {
    const actor = requireActor();

    const [file] = await this.db
      .select()
      .from(schema.evidenceFiles)
      .where(eq(schema.evidenceFiles.id, evidenceId))
      .limit(1);

    if (!file) throw new NotFoundError('File');

    if (file.isSensitive && !actor.isSuperAdmin && !actor.permissions.has('pii:reveal')) {
      throw new ForbiddenError('You do not have permission to open identity documents.');
    }

    if (file.isSensitive) {
      await this.audit.recordPiiAccess({
        applicantId: file.applicantId,
        field: file.kind,
        accessType: 'download',
        reason: `Downloaded ${file.fileName}`,
      });
    }

    const url = await this.storage.presignDownload(file.storageKey, file.fileName, mode);
    return { url, fileName: file.fileName, contentType: file.contentType };
  }

  // ── General attachments (§16) ──────────────────────────────────────────────

  async confirmAttachment(input: {
    applicantId?: string;
    recordId?: string;
    kind: string;
    storageKey: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    description?: string;
  }): Promise<{ id: string }> {
    const actor = requireActor();
    await this.assertIntentBelongsToCaller(input.storageKey);

    const head = await this.storage.verifyUploaded(input.storageKey);
    if (!head.exists) {
      throw new ValidationError({ storageKey: ['That upload did not complete.'] });
    }

    let applicantId = input.applicantId;
    if (!applicantId && input.recordId) {
      const [record] = await this.db
        .select({ applicantId: schema.records.applicantId })
        .from(schema.records)
        .where(eq(schema.records.id, input.recordId))
        .limit(1);
      if (!record) throw new NotFoundError('Record');
      applicantId = record.applicantId;
    }

    if (!applicantId) throw new ValidationError({ applicantId: ['An applicant is required.'] });

    const [inserted] = await this.db
      .insert(schema.attachments)
      .values({
        applicantId,
        recordId: input.recordId ?? null,
        kind: input.kind,
        storageKey: input.storageKey,
        fileName: input.fileName,
        contentType: head.contentType ?? input.contentType,
        sizeBytes: head.sizeBytes || input.sizeBytes,
        description: input.description ?? null,
        uploadedByUserId: actor.userId,
      })
      .returning({ id: schema.attachments.id });

    await this.timeline.write({
      applicantId,
      recordId: input.recordId ?? null,
      eventType: TIMELINE_EVENT.ATTACHMENT_UPLOADED,
      summary: `Attachment added — ${input.fileName}`,
      meta: { kind: input.kind },
    });

    await this.audit.record({
      action: AUDIT.ATTACHMENT_UPLOADED,
      entityType: 'attachment',
      entityId: inserted!.id,
      entityLabel: input.fileName,
    });

    return { id: inserted!.id };
  }

  /**
   * Everything attached to this applicant, across all their records.
   *
   * Keyed on the applicant — the master profile — rather than on one record, so
   * a correction letter filed against last year's application is still in front
   * of whoever opens the profile today. `recordCode` travels with each row so a
   * file that does belong to a specific record says which.
   */
  async listAttachments(applicantId: string) {
    const rows = await this.db
      .select({
        id: schema.attachments.id,
        kind: schema.attachments.kind,
        fileName: schema.attachments.fileName,
        contentType: schema.attachments.contentType,
        sizeBytes: schema.attachments.sizeBytes,
        description: schema.attachments.description,
        recordId: schema.attachments.recordId,
        recordCode: schema.records.recordCode,
        uploadedByName: schema.users.fullName,
        createdAt: schema.attachments.createdAt,
      })
      .from(schema.attachments)
      .leftJoin(schema.users, eq(schema.attachments.uploadedByUserId, schema.users.id))
      .leftJoin(schema.records, eq(schema.attachments.recordId, schema.records.id))
      .where(
        and(
          eq(schema.attachments.applicantId, applicantId),
          isNull(schema.attachments.deletedAt),
        ),
      )
      .orderBy(desc(schema.attachments.createdAt));

    return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
  }

  /**
   * Withdraw an attachment (§16).
   *
   * Deliberately a soft delete. "Remove according to permission" is a real
   * need — a file lands on the wrong profile, a correction letter is
   * superseded — but a hard delete would take with it the answer to "was there
   * ever a document about this?", which is the question that actually gets
   * asked. The row and the stored object stay; the file leaves the list and
   * stops being downloadable.
   *
   * Evidence files are not reachable from here at all: they are permanent by
   * database trigger, and this method only ever touches `attachments`.
   */
  async deleteAttachment(attachmentId: string, reason: string): Promise<{ ok: true }> {
    const actor = requireActor();

    const [file] = await this.db
      .select()
      .from(schema.attachments)
      .where(eq(schema.attachments.id, attachmentId))
      .limit(1);

    if (!file) throw new NotFoundError('Attachment');

    // Already gone. Reported as success so a double-click is not an error, and
    // so the second remover's name does not overwrite the first's.
    if (file.deletedAt) return { ok: true };

    await this.db
      .update(schema.attachments)
      .set({ deletedAt: new Date(), deletedByUserId: actor.userId, deleteReason: reason })
      .where(eq(schema.attachments.id, attachmentId));

    await this.timeline.write({
      applicantId: file.applicantId,
      recordId: file.recordId,
      eventType: TIMELINE_EVENT.ATTACHMENT_UPLOADED,
      summary: `Attachment removed — ${file.fileName}: ${reason}`,
      meta: { attachmentId, fileName: file.fileName, reason, removed: true },
    });

    await this.audit.record({
      action: AUDIT.FILE_DELETED,
      entityType: 'attachment',
      entityId: attachmentId,
      entityLabel: file.fileName,
      meta: { reason },
    });

    await this.cache.invalidateTags(CacheTag.applicant(file.applicantId));

    return { ok: true };
  }

  async getAttachmentDownloadUrl(
    attachmentId: string,
    mode: 'attachment' | 'inline' = 'attachment',
  ): Promise<{ url: string; fileName: string; contentType: string }> {
    const [file] = await this.db
      .select()
      .from(schema.attachments)
      .where(eq(schema.attachments.id, attachmentId))
      .limit(1);

    if (!file) throw new NotFoundError('File');

    // Withdrawn. The row survives so the audit trail can answer what was here,
    // but handing out a link would make the removal cosmetic.
    if (file.deletedAt) throw new NotFoundError('File');

    /**
     * Attachments get the same treatment as evidence.
     *
     * This table carries an `isSensitive` column and nothing consulted it: an
     * attachment flagged sensitive could be downloaded by anyone with
     * `evidence:view`, with no permission check and no entry in the PII access
     * log — while the identical file filed as evidence was gated and logged.
     * The claim that opening an identity document is recorded was therefore
     * true of one path and not the other.
     */
    const actor = requireActor();

    if (file.isSensitive && !actor.isSuperAdmin && !actor.permissions.has('pii:reveal')) {
      throw new ForbiddenError('You do not have permission to open identity documents.');
    }

    if (file.isSensitive) {
      await this.audit.recordPiiAccess({
        applicantId: file.applicantId,
        field: file.kind,
        accessType: 'download',
        reason: `Opened ${file.fileName}`,
      });
    }

    const url = await this.storage.presignDownload(file.storageKey, file.fileName, mode);
    return { url, fileName: file.fileName, contentType: file.contentType };
  }

  /**
   * A confirm call may only reference a key this user was actually issued.
   * Without this, one user could register another's in-flight upload — or
   * fabricate a metadata row pointing at an arbitrary object in the bucket.
   */
  private async assertIntentBelongsToCaller(storageKey: string): Promise<void> {
    const actor = requireActor();

    const [intent] = await this.db
      .select({ userId: schema.uploadIntents.userId, confirmedAt: schema.uploadIntents.confirmedAt })
      .from(schema.uploadIntents)
      .where(eq(schema.uploadIntents.storageKey, storageKey))
      .limit(1);

    if (!intent) {
      throw new ValidationError({ storageKey: ['Unknown upload. Request a new upload URL.'] });
    }
    if (intent.userId !== actor.userId) {
      throw new ForbiddenError('That upload belongs to a different user.');
    }
    if (intent.confirmedAt) {
      throw new ValidationError({ storageKey: ['This file has already been attached.'] });
    }
  }
}
