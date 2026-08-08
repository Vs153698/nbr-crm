import { Inject, Injectable } from '@nestjs/common';
import { isSensitiveEmployeeDocument } from '@nbr/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { AUDIT, AuditService } from '../audit/audit.service';
import { ForbiddenError, NotFoundError, ValidationError } from '../common/errors';
import { requireActor } from '../common/request-context';
import type { Database } from '../database/client';
import { DB } from '../database/database.tokens';
import * as schema from '../database/schema';
import { StorageService } from '../storage/storage.service';

export interface EmployeeDocumentItem {
  readonly id: string;
  readonly kind: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly originalSizeBytes: number | null;
  readonly description: string | null;
  readonly isSensitive: boolean;
  readonly uploadedByName: string | null;
  readonly createdAt: string;
}

/**
 * The onboarding file — offer letter, ID proof, certificates, signed contract.
 *
 * Uploads follow the same two-step path as the evidence vault: the browser gets
 * a presigned URL and pushes the bytes straight to storage, then tells the API
 * where they landed. A scanned contract never passes through an app worker.
 *
 * Two things differ from the vault deliberately. Permission hangs off
 * `employees:*` rather than `evidence:*`, because the people who run onboarding
 * are rarely the people who verify record submissions. And the files are
 * deletable — an onboarding folder collects mis-scans, and HR must be able to
 * tidy one — though the delete is soft and audited.
 */
@Injectable()
export class EmployeeDocumentsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  /** Step 1: hand the browser an upload URL, and remember that we did. */
  async presign(
    employeeId: string,
    input: { fileName: string; contentType: string; sizeBytes: number },
  ) {
    const actor = requireActor();
    await this.loadEmployee(employeeId);

    const presigned = await this.storage.presignUpload({
      scope: 'employee_document',
      ownerId: employeeId,
      fileName: input.fileName,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
    });

    await this.db.insert(schema.uploadIntents).values({
      userId: actor.userId,
      scope: 'employee_document',
      storageKey: presigned.storageKey,
      fileName: input.fileName,
      contentType: input.contentType,
      declaredSizeBytes: input.sizeBytes,
      expiresAt: new Date(Date.now() + presigned.expiresInSeconds * 1000),
    });

    return presigned;
  }

  /**
   * Step 2: the browser reports the upload finished.
   *
   * The object is checked against storage first — its real size and type, not
   * the client's claim — so the metadata row describes bytes that exist.
   */
  async confirm(
    employeeId: string,
    input: {
      kind: string;
      storageKey: string;
      fileName: string;
      contentType: string;
      sizeBytes: number;
      originalSizeBytes?: number;
      checksumSha256?: string;
      description?: string;
    },
  ): Promise<{ id: string }> {
    const actor = requireActor();
    const employee = await this.loadEmployee(employeeId);
    await this.assertIntentBelongsToCaller(input.storageKey);

    const head = await this.storage.verifyUploaded(input.storageKey);
    if (!head.exists) {
      throw new ValidationError({
        storageKey: ['That upload did not complete. Please try the file again.'],
      });
    }

    if (input.checksumSha256) await this.assertNotAlreadyHeld(employeeId, input.checksumSha256);

    const storedSize = head.sizeBytes || input.sizeBytes;

    const [inserted] = await this.db.transaction(async (tx) => {
      const rows = await tx
        .insert(schema.employeeDocuments)
        .values({
          employeeId,
          kind: input.kind,
          storageKey: input.storageKey,
          fileName: input.fileName,
          contentType: head.contentType ?? input.contentType,
          // Trust storage over the client for the real byte count.
          sizeBytes: storedSize,
          // Only meaningful when the browser actually shrank the file; an
          // untouched upload records the same number on both sides.
          originalSizeBytes: input.originalSizeBytes ?? storedSize,
          checksumSha256: input.checksumSha256 ?? null,
          description: input.description ?? null,
          isSensitive: isSensitiveEmployeeDocument(input.kind),
          uploadedByUserId: actor.userId,
        })
        .returning({ id: schema.employeeDocuments.id });

      await tx
        .update(schema.uploadIntents)
        .set({ confirmedAt: new Date() })
        .where(eq(schema.uploadIntents.storageKey, input.storageKey));

      return rows;
    });

    await this.audit.record({
      action: AUDIT.EMPLOYEE_DOCUMENT_UPLOADED,
      entityType: 'employee_document',
      entityId: inserted!.id,
      entityLabel: `${employee.employeeCode} — ${input.fileName}`,
      meta: { kind: input.kind, sizeBytes: storedSize },
    });

    return { id: inserted!.id };
  }

  async list(employeeId: string): Promise<EmployeeDocumentItem[]> {
    const rows = await this.db
      .select({
        id: schema.employeeDocuments.id,
        kind: schema.employeeDocuments.kind,
        fileName: schema.employeeDocuments.fileName,
        contentType: schema.employeeDocuments.contentType,
        sizeBytes: schema.employeeDocuments.sizeBytes,
        originalSizeBytes: schema.employeeDocuments.originalSizeBytes,
        description: schema.employeeDocuments.description,
        isSensitive: schema.employeeDocuments.isSensitive,
        uploadedByName: schema.users.fullName,
        createdAt: schema.employeeDocuments.createdAt,
      })
      .from(schema.employeeDocuments)
      .leftJoin(schema.users, eq(schema.employeeDocuments.uploadedByUserId, schema.users.id))
      .where(
        and(
          eq(schema.employeeDocuments.employeeId, employeeId),
          isNull(schema.employeeDocuments.deletedAt),
        ),
      )
      .orderBy(desc(schema.employeeDocuments.createdAt));

    return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
  }

  /**
   * A short-lived URL for one document.
   *
   * `inline` renders the file in the preview panel instead of downloading it —
   * the same object and the same expiry, presented differently. Opening a file
   * holding a government identifier is written to the audit log either way:
   * unlike an applicant's ID proof this is not gated on `pii:reveal`, because
   * the people who run onboarding need these routinely, but a record of who
   * looked is what makes that access answerable.
   */
  async downloadUrl(
    employeeId: string,
    documentId: string,
    mode: 'attachment' | 'inline' = 'attachment',
  ): Promise<{ url: string; fileName: string; contentType: string }> {
    const document = await this.loadDocument(employeeId, documentId);

    if (document.isSensitive) {
      await this.audit.record({
        action: AUDIT.EMPLOYEE_DOCUMENT_OPENED,
        entityType: 'employee_document',
        entityId: document.id,
        entityLabel: document.fileName,
        meta: { kind: document.kind, mode },
      });
    }

    const url = await this.storage.presignDownload(document.storageKey, document.fileName, mode);
    return { url, fileName: document.fileName, contentType: document.contentType };
  }

  /**
   * Soft delete, for a mis-scan or a duplicate.
   *
   * The row and the stored object both survive — only the listing stops showing
   * it — so a file removed by mistake, or one whose removal is later disputed,
   * can still be produced.
   */
  async remove(employeeId: string, documentId: string, reason?: string): Promise<{ ok: true }> {
    const document = await this.loadDocument(employeeId, documentId);

    await this.db
      .update(schema.employeeDocuments)
      .set({ deletedAt: new Date() })
      .where(eq(schema.employeeDocuments.id, document.id));

    await this.audit.record({
      action: AUDIT.EMPLOYEE_DOCUMENT_DELETED,
      entityType: 'employee_document',
      entityId: document.id,
      entityLabel: document.fileName,
      meta: { kind: document.kind, reason: reason ?? null },
    });

    return { ok: true };
  }

  private async loadEmployee(employeeId: string) {
    const [employee] = await this.db
      .select({ id: schema.employees.id, employeeCode: schema.employees.employeeCode })
      .from(schema.employees)
      .where(and(eq(schema.employees.id, employeeId), isNull(schema.employees.deletedAt)))
      .limit(1);

    if (!employee) throw new NotFoundError('Employee');
    return employee;
  }

  private async loadDocument(employeeId: string, documentId: string) {
    const [document] = await this.db
      .select()
      .from(schema.employeeDocuments)
      .where(
        and(
          eq(schema.employeeDocuments.id, documentId),
          // Scoped to the employee in the path, so a document id guessed from
          // one profile cannot be read through another.
          eq(schema.employeeDocuments.employeeId, employeeId),
          isNull(schema.employeeDocuments.deletedAt),
        ),
      )
      .limit(1);

    if (!document) throw new NotFoundError('Document');
    return document;
  }

  /**
   * The unique index already refuses a duplicate; catching it here turns a
   * 500 into the sentence the person uploading needs to read.
   */
  private async assertNotAlreadyHeld(employeeId: string, checksum: string): Promise<void> {
    const [clash] = await this.db
      .select({ fileName: schema.employeeDocuments.fileName })
      .from(schema.employeeDocuments)
      .where(
        and(
          eq(schema.employeeDocuments.employeeId, employeeId),
          eq(schema.employeeDocuments.checksumSha256, checksum),
          isNull(schema.employeeDocuments.deletedAt),
        ),
      )
      .limit(1);

    if (clash) {
      throw new ValidationError({
        storageKey: [`This file is already on the profile as "${clash.fileName}".`],
      });
    }
  }

  /**
   * A confirm call may only reference a key this user was actually issued.
   * Without it, one user could register another's in-flight upload — or point a
   * metadata row at an arbitrary object in the bucket.
   */
  private async assertIntentBelongsToCaller(storageKey: string): Promise<void> {
    const actor = requireActor();

    const [intent] = await this.db
      .select({
        userId: schema.uploadIntents.userId,
        scope: schema.uploadIntents.scope,
        confirmedAt: schema.uploadIntents.confirmedAt,
      })
      .from(schema.uploadIntents)
      .where(eq(schema.uploadIntents.storageKey, storageKey))
      .limit(1);

    if (!intent || intent.scope !== 'employee_document') {
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
