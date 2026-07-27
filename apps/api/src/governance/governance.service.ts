import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, ilike, lte, or, sql, type SQL } from 'drizzle-orm';
import { AUDIT, AuditService } from '../audit/audit.service';
import { ForbiddenError, NotFoundError } from '../common/errors';
import { requireActor } from '../common/request-context';
import type { Database } from '../database/client';
import { DB } from '../database/database.tokens';
import * as schema from '../database/schema';
import { CacheService, CacheTag } from '../redis/cache.service';

export interface AuditLogRow {
  readonly id: string;
  readonly action: string;
  readonly actorName: string | null;
  readonly actorRole: string | null;
  readonly entityType: string | null;
  readonly entityId: string | null;
  readonly entityLabel: string | null;
  readonly changes: Record<string, { from: unknown; to: unknown }> | null;
  readonly meta: Record<string, unknown> | null;
  readonly ipAddress: string | null;
  readonly requestId: string | null;
  readonly createdAt: string;
}

/**
 * Audit log viewer and settings (§23, §26 — P2-13).
 *
 * The audit log is read-only in the strongest sense — the table itself rejects
 * UPDATE and DELETE — so this service exposes querying only. There is
 * deliberately no write path here; entries come from `AuditService` alone.
 */
@Injectable()
export class GovernanceService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly cache: CacheService,
  ) {}

  /**
   * W-30 Audit log, cursor-paginated.
   *
   * Bounded by default to the last 30 days: an unfiltered scan of a table that
   * grows forever is the one query guaranteed to get slower every month.
   */
  async listAuditLogs(filters: {
    action?: string;
    actorUserId?: string;
    entityType?: string;
    entityId?: string;
    from?: Date;
    to?: Date;
    q?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{ items: AuditLogRow[]; nextCursor: string | null }> {
    const limit = Math.min(filters.limit ?? 50, 200);
    const from = filters.from ?? new Date(Date.now() - 30 * 86_400_000);

    const conditions: SQL[] = [gte(schema.auditLogs.createdAt, from) as SQL];

    if (filters.to) conditions.push(lte(schema.auditLogs.createdAt, filters.to) as SQL);
    if (filters.action) conditions.push(eq(schema.auditLogs.action, filters.action) as SQL);
    if (filters.actorUserId) {
      conditions.push(eq(schema.auditLogs.actorUserId, filters.actorUserId) as SQL);
    }
    if (filters.entityType) {
      conditions.push(eq(schema.auditLogs.entityType, filters.entityType) as SQL);
    }
    if (filters.entityId) conditions.push(eq(schema.auditLogs.entityId, filters.entityId) as SQL);

    if (filters.q) {
      const clause = or(
        ilike(schema.auditLogs.entityLabel, `%${filters.q}%`),
        ilike(schema.auditLogs.actorName, `%${filters.q}%`),
        ilike(schema.auditLogs.action, `%${filters.q}%`),
      );
      if (clause) conditions.push(clause);
    }

    if (filters.cursor) {
      const decoded = decodeCursor(filters.cursor);
      if (decoded) conditions.push(decoded);
    }

    const rows = await this.db
      .select({
        id: schema.auditLogs.id,
        action: schema.auditLogs.action,
        actorName: schema.auditLogs.actorName,
        actorRole: schema.auditLogs.actorRole,
        entityType: schema.auditLogs.entityType,
        entityId: schema.auditLogs.entityId,
        entityLabel: schema.auditLogs.entityLabel,
        changes: schema.auditLogs.changes,
        meta: schema.auditLogs.meta,
        ipAddress: schema.auditLogs.ipAddress,
        requestId: schema.auditLogs.requestId,
        createdAt: schema.auditLogs.createdAt,
      })
      .from(schema.auditLogs)
      .where(and(...conditions))
      .orderBy(desc(schema.auditLogs.createdAt), desc(schema.auditLogs.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    }));

    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }

  /** Distinct action codes, for the filter dropdown. */
  async auditActions(): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ action: schema.auditLogs.action })
      .from(schema.auditLogs)
      .orderBy(schema.auditLogs.action);
    return rows.map((row) => row.action);
  }

  /**
   * Everything ever done to one entity — the "who changed this and when"
   * question that arrives with a complaint.
   */
  async entityHistory(entityType: string, entityId: string): Promise<AuditLogRow[]> {
    const rows = await this.db
      .select({
        id: schema.auditLogs.id,
        action: schema.auditLogs.action,
        actorName: schema.auditLogs.actorName,
        actorRole: schema.auditLogs.actorRole,
        entityType: schema.auditLogs.entityType,
        entityId: schema.auditLogs.entityId,
        entityLabel: schema.auditLogs.entityLabel,
        changes: schema.auditLogs.changes,
        meta: schema.auditLogs.meta,
        ipAddress: schema.auditLogs.ipAddress,
        requestId: schema.auditLogs.requestId,
        createdAt: schema.auditLogs.createdAt,
      })
      .from(schema.auditLogs)
      .where(
        and(eq(schema.auditLogs.entityType, entityType), eq(schema.auditLogs.entityId, entityId)),
      )
      .orderBy(desc(schema.auditLogs.createdAt))
      .limit(200);

    return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
  }

  /** DPDP §8(4) — who read which government identifier, and why. */
  async listPiiAccess(filters: { applicantId?: string; userId?: string; limit?: number }) {
    const conditions: SQL[] = [];
    if (filters.applicantId) {
      conditions.push(eq(schema.piiAccessLog.applicantId, filters.applicantId) as SQL);
    }
    if (filters.userId) conditions.push(eq(schema.piiAccessLog.userId, filters.userId) as SQL);

    const rows = await this.db
      .select({
        id: schema.piiAccessLog.id,
        userName: schema.piiAccessLog.userName,
        userRole: schema.piiAccessLog.userRole,
        applicantId: schema.piiAccessLog.applicantId,
        field: schema.piiAccessLog.field,
        accessType: schema.piiAccessLog.accessType,
        reason: schema.piiAccessLog.reason,
        ipAddress: schema.piiAccessLog.ipAddress,
        createdAt: schema.piiAccessLog.createdAt,
      })
      .from(schema.piiAccessLog)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.piiAccessLog.createdAt))
      .limit(Math.min(filters.limit ?? 100, 500));

    return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
  }

  // ── Settings (§26, W-29) ──────────────────────────────────────────────────

  async listSettings() {
    const rows = await this.db
      .select()
      .from(schema.settings)
      .orderBy(schema.settings.category, schema.settings.key);

    // Grouped so the screen renders sections rather than a flat list of 17 keys.
    const grouped = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = grouped.get(row.category) ?? [];
      list.push(row);
      grouped.set(row.category, list);
    }

    return [...grouped.entries()].map(([category, items]) => ({
      category,
      settings: items.map((item) => ({
        key: item.key,
        value: item.value,
        label: item.label,
        description: item.description,
        isEditable: item.isEditable,
        updatedAt: item.updatedAt.toISOString(),
      })),
    }));
  }

  async updateSetting(key: string, value: unknown): Promise<void> {
    const actor = requireActor();

    const [existing] = await this.db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, key))
      .limit(1);

    if (!existing) throw new NotFoundError('Setting');

    // Some settings mirror an environment variable or a statutory limit —
    // changing them from the UI would create a value the process never reads,
    // or quietly weaken a legal obligation.
    if (!existing.isEditable) {
      throw new ForbiddenError(
        'This setting is controlled by the deployment configuration and cannot be changed here.',
      );
    }

    await this.db
      .update(schema.settings)
      .set({ value: value as never, updatedByUserId: actor.userId })
      .where(eq(schema.settings.key, key));

    await this.cache.invalidateTags(CacheTag.settings());

    await this.audit.record({
      action: AUDIT.SETTING_UPDATED,
      entityType: 'setting',
      entityId: existing.id,
      entityLabel: key,
      changes: { value: { from: existing.value, to: value } },
    });
  }

  // ── Catalogue management (§26: categories, packages, couriers) ────────────

  async upsertCategory(input: {
    id?: string;
    name: string;
    description?: string;
    isActive: boolean;
  }): Promise<{ id: string }> {
    const slug = input.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    const [row] = input.id
      ? await this.db
          .update(schema.categories)
          .set({ name: input.name, description: input.description ?? null, isActive: input.isActive })
          .where(eq(schema.categories.id, input.id))
          .returning({ id: schema.categories.id })
      : await this.db
          .insert(schema.categories)
          .values({
            name: input.name,
            slug,
            description: input.description ?? null,
            isActive: input.isActive,
          })
          .returning({ id: schema.categories.id });

    if (!row) throw new NotFoundError('Category');
    await this.cache.invalidateTags(CacheTag.settings());
    return { id: row.id };
  }

  async upsertPackage(input: {
    id?: string;
    name: string;
    description?: string;
    amount: string;
    gstPercent: string;
    isActive: boolean;
  }): Promise<{ id: string }> {
    const values = {
      name: input.name,
      description: input.description ?? null,
      amount: input.amount,
      gstPercent: input.gstPercent,
      isActive: input.isActive,
    };

    const [row] = input.id
      ? await this.db
          .update(schema.packages)
          .set(values)
          .where(eq(schema.packages.id, input.id))
          .returning({ id: schema.packages.id })
      : await this.db.insert(schema.packages).values(values).returning({ id: schema.packages.id });

    if (!row) throw new NotFoundError('Package');
    await this.cache.invalidateTags(CacheTag.settings());

    await this.audit.record({
      action: AUDIT.SETTING_UPDATED,
      entityType: 'package',
      entityId: row.id,
      entityLabel: `${input.name} — ₹${input.amount}`,
    });

    return { id: row.id };
  }

  async upsertCourier(input: {
    id?: string;
    name: string;
    trackingUrlTemplate?: string;
    isActive: boolean;
  }): Promise<{ id: string }> {
    const values = {
      name: input.name,
      trackingUrlTemplate: input.trackingUrlTemplate ?? null,
      isActive: input.isActive,
    };

    const [row] = input.id
      ? await this.db
          .update(schema.couriers)
          .set(values)
          .where(eq(schema.couriers.id, input.id))
          .returning({ id: schema.couriers.id })
      : await this.db.insert(schema.couriers).values(values).returning({ id: schema.couriers.id });

    if (!row) throw new NotFoundError('Courier');
    await this.cache.invalidateTags(CacheTag.settings());
    return { id: row.id };
  }
}

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`).toString('base64url');
}

function decodeCursor(cursor: string): SQL | undefined {
  const [at, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (!at || !id) return undefined;

  // Composite comparison so two entries written in the same millisecond stay
  // deterministically ordered across a page boundary.
  return sql`(${schema.auditLogs.createdAt}, ${schema.auditLogs.id}) < (${at}::timestamptz, ${id}::uuid)`;
}
