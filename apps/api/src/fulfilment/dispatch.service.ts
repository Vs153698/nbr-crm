import { Inject, Injectable } from '@nestjs/common';
import { DELIVERY_STATUS, PUBLICATION_KIND, TIMELINE_EVENT } from '@nbr/shared';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { AUDIT, AuditService } from '../audit/audit.service';
import { NotFoundError } from '../common/errors';
import { requireActor } from '../common/request-context';
import type { Database } from '../database/client';
import { DB } from '../database/database.tokens';
import * as schema from '../database/schema';
import { CacheService, CacheTag } from '../redis/cache.service';
import { StorageService } from '../storage/storage.service';
import { TimelineService } from '../timeline/timeline.service';

/**
 * Publications (§11) and Dispatch (§12) — P2-03, P2-04.
 *
 * Grouped because they are the tail of the same fulfilment stage and share the
 * vault and timeline plumbing.
 */
@Injectable()
export class DispatchService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly storage: StorageService,
    private readonly timeline: TimelineService,
    private readonly audit: AuditService,
    private readonly cache: CacheService,
  ) {}

  // ── Publications ─────────────────────────────────────────────────────────

  async addPublication(input: {
    recordId: string;
    kind: string;
    title: string;
    publishedOn?: Date;
    magazineName?: string;
    pageNumber?: string;
    url?: string;
    fileKey?: string;
    notes?: string;
  }): Promise<{ id: string }> {
    const actor = requireActor();
    const record = await this.loadRecord(input.recordId);

    const id = await this.db.transaction(async (tx) => {
      const [publication] = await tx
        .insert(schema.publications)
        .values({
          recordId: input.recordId,
          applicantId: record.applicantId,
          kind: input.kind,
          title: input.title,
          publishedOn: input.publishedOn ?? null,
          magazineName: input.magazineName ?? null,
          pageNumber: input.pageNumber ?? null,
          url: input.url ?? null,
          fileKey: input.fileKey ?? null,
          notes: input.notes ?? null,
          createdByUserId: actor.userId,
        })
        .returning({ id: schema.publications.id });

      await tx
        .update(schema.records)
        .set({ hasPublication: true })
        .where(eq(schema.records.id, input.recordId));

      const where =
        input.kind === PUBLICATION_KIND.MAGAZINE && input.magazineName
          ? `${input.magazineName}${input.pageNumber ? `, page ${input.pageNumber}` : ''}`
          : input.kind.replace(/_/g, ' ');

      await this.timeline.write(
        {
          applicantId: record.applicantId,
          recordId: input.recordId,
          eventType: TIMELINE_EVENT.PUBLICATION_ADDED,
          summary: `Published in ${where} — "${input.title}"`,
          meta: { kind: input.kind, url: input.url ?? null },
        },
        tx,
      );

      await this.audit.record(
        {
          action: AUDIT.PUBLICATION_ADDED,
          entityType: 'publication',
          entityId: publication!.id,
          entityLabel: `${record.recordCode} — ${input.title}`,
          meta: { kind: input.kind },
        },
        tx,
      );

      return publication!.id;
    });

    await this.bust(input.recordId, record.applicantId);
    return { id };
  }

  async listPublications(recordId: string) {
    const rows = await this.db
      .select({
        id: schema.publications.id,
        kind: schema.publications.kind,
        title: schema.publications.title,
        publishedOn: schema.publications.publishedOn,
        magazineName: schema.publications.magazineName,
        pageNumber: schema.publications.pageNumber,
        url: schema.publications.url,
        fileKey: schema.publications.fileKey,
        notes: schema.publications.notes,
        createdByName: schema.users.fullName,
        createdAt: schema.publications.createdAt,
      })
      .from(schema.publications)
      .leftJoin(schema.users, eq(schema.publications.createdByUserId, schema.users.id))
      .where(eq(schema.publications.recordId, recordId))
      .orderBy(desc(schema.publications.createdAt));

    return rows.map((row) => ({
      ...row,
      // The storage key never leaves the server — only whether a file exists.
      hasFile: Boolean(row.fileKey),
      fileKey: undefined,
      publishedOn: row.publishedOn?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async getPublicationDownloadUrl(id: string): Promise<{ url: string; fileName: string }> {
    const [publication] = await this.db
      .select()
      .from(schema.publications)
      .where(eq(schema.publications.id, id))
      .limit(1);

    if (!publication?.fileKey) throw new NotFoundError('Publication file');

    const fileName = `${publication.title.replace(/[^\w.-]+/g, '-')}.pdf`;
    return { url: await this.storage.presignDownload(publication.fileKey, fileName), fileName };
  }

  // ── Dispatch ─────────────────────────────────────────────────────────────

  /**
   * M-06 Update Dispatch.
   *
   * A record has at most one *current* dispatch (enforced by a partial unique
   * index). A returned parcel that is re-sent supersedes the previous row
   * rather than overwriting it, so the delivery history survives.
   */
  async upsertDispatch(input: {
    recordId: string;
    courierPartner: string;
    trackingNumber?: string;
    trackingUrl?: string;
    dispatchedOn?: Date;
    deliveryStatus: string;
    deliveredOn?: Date;
    podKey?: string;
    contents?: string;
    remarks?: string;
  }): Promise<{ id: string }> {
    const actor = requireActor();
    const record = await this.loadRecord(input.recordId);

    const id = await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(schema.dispatches)
        .where(
          and(eq(schema.dispatches.recordId, input.recordId), eq(schema.dispatches.isCurrent, true)),
        )
        .limit(1);

      // A returned parcel is history; the re-send is a new row.
      const supersede = current?.deliveryStatus === DELIVERY_STATUS.RETURNED;

      if (current && supersede) {
        await tx
          .update(schema.dispatches)
          .set({ isCurrent: false })
          .where(eq(schema.dispatches.id, current.id));
      }

      const values = {
        recordId: input.recordId,
        applicantId: record.applicantId,
        courierPartner: input.courierPartner,
        trackingNumber: input.trackingNumber ?? null,
        trackingUrl: input.trackingUrl ?? null,
        dispatchedOn: input.dispatchedOn ?? null,
        deliveryStatus: input.deliveryStatus,
        deliveredOn: input.deliveredOn ?? null,
        podKey: input.podKey ?? null,
        contents: input.contents ?? null,
        remarks: input.remarks ?? null,
        isCurrent: true,
        createdByUserId: actor.userId,
      };

      let dispatchId: string;

      if (current && !supersede) {
        await tx.update(schema.dispatches).set(values).where(eq(schema.dispatches.id, current.id));
        dispatchId = current.id;
      } else {
        const [inserted] = await tx
          .insert(schema.dispatches)
          .values(values)
          .returning({ id: schema.dispatches.id });
        dispatchId = inserted!.id;
      }

      // Mirrored onto the record for the list view's Dispatch column.
      await tx
        .update(schema.records)
        .set({ deliveryStatus: input.deliveryStatus })
        .where(eq(schema.records.id, input.recordId));

      const delivered = input.deliveryStatus === DELIVERY_STATUS.DELIVERED;

      await this.timeline.write(
        {
          applicantId: record.applicantId,
          recordId: input.recordId,
          eventType: delivered
            ? TIMELINE_EVENT.DISPATCH_DELIVERED
            : current
              ? TIMELINE_EVENT.DISPATCH_UPDATED
              : TIMELINE_EVENT.DISPATCH_CREATED,
          summary: delivered
            ? `Delivered — ${input.courierPartner}${input.trackingNumber ? ` (${input.trackingNumber})` : ''}`
            : `Dispatch ${current ? 'updated' : 'created'} — ${input.courierPartner}${input.trackingNumber ? ` (${input.trackingNumber})` : ''}`,
          meta: {
            courierPartner: input.courierPartner,
            trackingNumber: input.trackingNumber ?? null,
            deliveryStatus: input.deliveryStatus,
          },
        },
        tx,
      );

      await this.audit.record(
        {
          action: AUDIT.DISPATCH_UPDATED,
          entityType: 'dispatch',
          entityId: dispatchId,
          entityLabel: `${record.recordCode} — ${input.courierPartner}`,
          meta: { deliveryStatus: input.deliveryStatus, trackingNumber: input.trackingNumber ?? null },
        },
        tx,
      );

      return dispatchId;
    });

    await this.bust(input.recordId, record.applicantId);
    return { id };
  }

  async getDispatch(recordId: string) {
    const rows = await this.db
      .select({
        id: schema.dispatches.id,
        courierPartner: schema.dispatches.courierPartner,
        trackingNumber: schema.dispatches.trackingNumber,
        trackingUrl: schema.dispatches.trackingUrl,
        dispatchedOn: schema.dispatches.dispatchedOn,
        deliveryStatus: schema.dispatches.deliveryStatus,
        deliveredOn: schema.dispatches.deliveredOn,
        podKey: schema.dispatches.podKey,
        contents: schema.dispatches.contents,
        remarks: schema.dispatches.remarks,
        isCurrent: schema.dispatches.isCurrent,
        createdByName: schema.users.fullName,
        createdAt: schema.dispatches.createdAt,
      })
      .from(schema.dispatches)
      .leftJoin(schema.users, eq(schema.dispatches.createdByUserId, schema.users.id))
      .where(eq(schema.dispatches.recordId, recordId))
      .orderBy(desc(schema.dispatches.createdAt));

    return rows.map((row) => ({
      ...row,
      hasPod: Boolean(row.podKey),
      podKey: undefined,
      dispatchedOn: row.dispatchedOn?.toISOString() ?? null,
      deliveredOn: row.deliveredOn?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async getPodDownloadUrl(dispatchId: string): Promise<{ url: string; fileName: string }> {
    const [dispatch] = await this.db
      .select()
      .from(schema.dispatches)
      .where(eq(schema.dispatches.id, dispatchId))
      .limit(1);

    if (!dispatch?.podKey) throw new NotFoundError('Proof of delivery');

    const fileName = `pod-${dispatch.trackingNumber ?? dispatchId}.pdf`;
    return { url: await this.storage.presignDownload(dispatch.podKey, fileName), fileName };
  }

  /** The dispatch queue (W-23) — certificates ready to go out. */
  async pendingQueue(limit = 100) {
    return this.db
      .select({
        recordId: schema.records.id,
        recordCode: schema.records.recordCode,
        applicantId: schema.records.applicantId,
        applicantName: schema.applicants.fullName,
        city: schema.applicants.city,
        state: schema.applicants.state,
        pincode: schema.applicants.pincode,
        recordTitle: schema.achievements.recordTitle,
        status: schema.records.status,
        deliveryStatus: schema.records.deliveryStatus,
        updatedAt: schema.records.updatedAt,
      })
      .from(schema.records)
      .innerJoin(schema.applicants, eq(schema.records.applicantId, schema.applicants.id))
      .leftJoin(schema.achievements, eq(schema.achievements.recordId, schema.records.id))
      .where(
        and(
          isNull(schema.records.deletedAt),
          sql`${schema.records.status} IN ('dispatch_pending', 'certificate_uploaded', 'publication')`,
        ),
      )
      .orderBy(schema.records.updatedAt)
      .limit(limit);
  }

  /** Build an applicant-facing tracking link from the courier's template. */
  async buildTrackingUrl(courierName: string, trackingNumber: string): Promise<string | null> {
    const [courier] = await this.db
      .select({ template: schema.couriers.trackingUrlTemplate })
      .from(schema.couriers)
      .where(eq(schema.couriers.name, courierName))
      .limit(1);

    if (!courier?.template) return null;
    return courier.template.replace('{tracking_no}', encodeURIComponent(trackingNumber));
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
