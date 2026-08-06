import { Inject, Injectable } from '@nestjs/common';
import type { TimelineEventType } from '@nbr/shared';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { getActor, SYSTEM_ACTOR_NAME } from '../common/request-context';
import type { Database } from '../database/client';
import { DB } from '../database/database.tokens';
import * as schema from '../database/schema';

export interface TimelineWrite {
  readonly applicantId: string;
  readonly recordId?: string | null;
  readonly eventType: TimelineEventType;
  readonly summary: string;
  readonly meta?: Record<string, unknown>;
  /** Overrides the request actor — used by scheduled jobs and the importer. */
  readonly actorKind?: 'user' | 'system' | 'integration';
  readonly actorName?: string;
  readonly occurredAt?: Date;
}

export interface TimelineEntry {
  readonly id: string;
  readonly eventType: string;
  readonly summary: string;
  readonly meta: Record<string, unknown> | null;
  readonly actorName: string | null;
  readonly actorKind: string;
  readonly occurredAt: string;
}

/**
 * The automatic timeline (§13).
 *
 * "Every activity should automatically create a log… Timeline must be
 * read-only." Writes go through here and only here; the table itself rejects
 * UPDATE and DELETE at the database level, so nothing downstream can rewrite
 * what happened.
 *
 * The actor's *name* is snapshotted alongside the foreign key, so an entry
 * still reads correctly years later after that employee's account is
 * deactivated or their name changes.
 */
@Injectable()
export class TimelineService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Always call this inside the caller's transaction. A status change whose
   * timeline entry silently failed is worse than a status change that failed
   * outright — the record would look correct with no explanation of how it got
   * there.
   */
  async write(entry: TimelineWrite, tx?: Database): Promise<void> {
    const actor = getActor();

    await (tx ?? this.db).insert(schema.timelineEvents).values({
      applicantId: entry.applicantId,
      recordId: entry.recordId ?? null,
      eventType: entry.eventType,
      summary: entry.summary,
      meta: entry.meta ?? null,
      actorUserId: entry.actorKind && entry.actorKind !== 'user' ? null : (actor?.userId ?? null),
      actorName: entry.actorName ?? actor?.fullName ?? SYSTEM_ACTOR_NAME,
      actorKind: entry.actorKind ?? (actor ? 'user' : 'system'),
      occurredAt: entry.occurredAt ?? new Date(),
    });
  }

  /** Several entries in one round trip — a status change often writes 2–3. */
  async writeMany(entries: TimelineWrite[], tx?: Database): Promise<void> {
    if (entries.length === 0) return;
    const actor = getActor();

    await (tx ?? this.db).insert(schema.timelineEvents).values(
      entries.map((entry) => ({
        applicantId: entry.applicantId,
        recordId: entry.recordId ?? null,
        eventType: entry.eventType,
        summary: entry.summary,
        meta: entry.meta ?? null,
        actorUserId:
          entry.actorKind && entry.actorKind !== 'user' ? null : (actor?.userId ?? null),
        actorName: entry.actorName ?? actor?.fullName ?? SYSTEM_ACTOR_NAME,
        actorKind: entry.actorKind ?? (actor ? 'user' : 'system'),
        occurredAt: entry.occurredAt ?? new Date(),
      })),
    );
  }

  /**
   * Cursor-paginated feed, newest first.
   *
   * Keyset rather than OFFSET: a profile with 400 timeline entries scrolls at
   * the same speed on page 8 as page 1, and no entry is skipped or repeated
   * when a new one lands mid-scroll.
   */
  async list(params: {
    recordId?: string;
    applicantId?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{ items: TimelineEntry[]; nextCursor: string | null }> {
    const limit = Math.min(params.limit ?? 30, 100);

    const scope = params.recordId
      ? eq(schema.timelineEvents.recordId, params.recordId)
      : params.applicantId
        ? eq(schema.timelineEvents.applicantId, params.applicantId)
        : undefined;

    const cursorClause = params.cursor ? decodeCursor(params.cursor) : undefined;

    const rows = await this.db
      .select({
        id: schema.timelineEvents.id,
        eventType: schema.timelineEvents.eventType,
        summary: schema.timelineEvents.summary,
        meta: schema.timelineEvents.meta,
        actorName: schema.timelineEvents.actorName,
        actorKind: schema.timelineEvents.actorKind,
        occurredAt: schema.timelineEvents.occurredAt,
      })
      .from(schema.timelineEvents)
      .where(scope && cursorClause ? and(scope, cursorClause) : (scope ?? cursorClause))
      .orderBy(desc(schema.timelineEvents.occurredAt), desc(schema.timelineEvents.id))
      // One extra row tells us whether another page exists without a count().
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map((row) => ({
      id: row.id,
      eventType: row.eventType,
      summary: row.summary,
      meta: row.meta,
      actorName: row.actorName,
      actorKind: row.actorKind,
      occurredAt: row.occurredAt.toISOString(),
    }));

    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last ? encodeCursor(last.occurredAt, last.id) : null,
    };
  }

  /** Dashboard "Recent Activities" feed (§2). */
  async recentActivity(limit = 15): Promise<TimelineEntry[]> {
    const rows = await this.db
      .select({
        id: schema.timelineEvents.id,
        eventType: schema.timelineEvents.eventType,
        summary: schema.timelineEvents.summary,
        meta: schema.timelineEvents.meta,
        actorName: schema.timelineEvents.actorName,
        actorKind: schema.timelineEvents.actorKind,
        occurredAt: schema.timelineEvents.occurredAt,
      })
      .from(schema.timelineEvents)
      .orderBy(desc(schema.timelineEvents.occurredAt))
      .limit(Math.min(limit, 50));

    return rows.map((row) => ({
      ...row,
      occurredAt: row.occurredAt.toISOString(),
    }));
  }
}

/** Cursor = base64("<iso timestamp>|<uuid>"). Opaque to the client. */
function encodeCursor(occurredAt: string, id: string): string {
  return Buffer.from(`${occurredAt}|${id}`).toString('base64url');
}

function decodeCursor(cursor: string) {
  const [at, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (!at || !id) return undefined;

  const timestamp = new Date(at);
  // Strict "older than" on the composite (occurredAt, id) so two events written
  // in the same millisecond are still ordered deterministically and neither is
  // dropped from the page boundary.
  return or(
    lt(schema.timelineEvents.occurredAt, timestamp),
    and(
      eq(schema.timelineEvents.occurredAt, timestamp),
      lt(schema.timelineEvents.id, sql`${id}::uuid`),
    ),
  );
}
