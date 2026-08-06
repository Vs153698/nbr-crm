import { Inject, Injectable } from '@nestjs/common';
import {
  BLACKLIST_KIND,
  BLACKLIST_REASON_LABELS,
  FLAG,
  FLAG_META,
  TIMELINE_EVENT,
  type BlacklistReason,
  type FlagCode,
} from '@nbr/shared';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { AUDIT, AuditService } from '../audit/audit.service';
import { ConflictError, NotFoundError, ValidationError } from '../common/errors';
import { requireActor } from '../common/request-context';
import type { Database } from '../database/client';
import { DB } from '../database/database.tokens';
import * as schema from '../database/schema';
import { CacheService, CacheTag } from '../redis/cache.service';
import { TimelineService } from '../timeline/timeline.service';

/**
 * Blacklist and restriction flags (§19, §20 — P2-09).
 *
 * The enforcement already lives in the create-applicant and add-record paths;
 * this service is how entries get added, lifted and listed. Nothing is ever
 * deleted — lifting a blacklist stamps `liftedAt` so the history of *why*
 * someone was blocked survives, which is the point when a decision is
 * challenged years later.
 */
@Injectable()
export class BlacklistService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly timeline: TimelineService,
    private readonly audit: AuditService,
    private readonly cache: CacheService,
  ) {}

  /** M-09 Blacklist Applicant. */
  async add(input: {
    applicantId: string;
    kind: string;
    reason: string;
    reasonDetail: string;
    effectiveUntil?: Date;
    documentKeys: string[];
    remarks?: string;
  }): Promise<{ id: string }> {
    const actor = requireActor();

    const [applicant] = await this.db
      .select({
        id: schema.applicants.id,
        applicantCode: schema.applicants.applicantCode,
        fullName: schema.applicants.fullName,
      })
      .from(schema.applicants)
      .where(and(eq(schema.applicants.id, input.applicantId), isNull(schema.applicants.deletedAt)))
      .limit(1);

    if (!applicant) throw new NotFoundError('Applicant');

    // The schema's CHECK constraints enforce this too, but a clear message
    // beats a constraint-name error surfacing in the UI.
    if (input.kind === BLACKLIST_KIND.TEMPORARY && !input.effectiveUntil) {
      throw new ValidationError({ effectiveUntil: ['A temporary blacklist needs an end date.'] });
    }
    if (input.kind === BLACKLIST_KIND.PERMANENT && input.effectiveUntil) {
      throw new ValidationError({ effectiveUntil: ['A permanent blacklist cannot have an end date.'] });
    }

    const [active] = await this.db
      .select({ id: schema.blacklists.id })
      .from(schema.blacklists)
      .where(
        and(eq(schema.blacklists.applicantId, input.applicantId), isNull(schema.blacklists.liftedAt)),
      )
      .limit(1);

    if (active) {
      throw new ConflictError(
        'ALREADY_BLACKLISTED',
        'This applicant already has an active blacklist entry. Lift it before adding another.',
      );
    }

    const id = await this.db.transaction(async (tx) => {
      const [blacklist] = await tx
        .insert(schema.blacklists)
        .values({
          applicantId: input.applicantId,
          kind: input.kind,
          reason: input.reason,
          reasonDetail: input.reasonDetail,
          remarks: input.remarks ?? null,
          documentKeys: input.documentKeys,
          effectiveUntil: input.effectiveUntil ?? null,
          createdByUserId: actor.userId,
        })
        .returning({ id: schema.blacklists.id });

      // Denormalised so the list view, the red banner and the duplicate check
      // need no join on the hot path.
      await tx
        .update(schema.applicants)
        .set({ isBlacklisted: true })
        .where(eq(schema.applicants.id, input.applicantId));

      // The BLACKLISTED flag renders next to the name everywhere.
      await tx
        .insert(schema.applicantFlags)
        .values({
          applicantId: input.applicantId,
          flag: FLAG.BLACKLISTED,
          reason: input.reasonDetail,
          expiresAt: input.effectiveUntil ?? null,
          setByUserId: actor.userId,
        })
        .onConflictDoNothing();

      const reasonLabel =
        BLACKLIST_REASON_LABELS[input.reason as BlacklistReason] ?? input.reason;

      await this.timeline.write(
        {
          applicantId: input.applicantId,
          eventType: TIMELINE_EVENT.BLACKLISTED,
          summary: `Blacklisted (${input.kind}) — ${reasonLabel}`,
          meta: {
            kind: input.kind,
            reason: input.reason,
            detail: input.reasonDetail,
            effectiveUntil: input.effectiveUntil?.toISOString() ?? null,
          },
        },
        tx,
      );

      await this.audit.record(
        {
          action: AUDIT.BLACKLIST_ADDED,
          entityType: 'applicant',
          entityId: input.applicantId,
          entityLabel: `${applicant.applicantCode} — ${applicant.fullName}`,
          meta: { kind: input.kind, reason: input.reason, detail: input.reasonDetail },
        },
        tx,
      );

      return blacklist!.id;
    });

    await this.bust(input.applicantId);
    return { id };
  }

  /** Lifting keeps the record — it stamps `liftedAt` rather than deleting. */
  async lift(blacklistId: string, reason: string): Promise<void> {
    const actor = requireActor();

    const [blacklist] = await this.db
      .select()
      .from(schema.blacklists)
      .where(eq(schema.blacklists.id, blacklistId))
      .limit(1);

    if (!blacklist) throw new NotFoundError('Blacklist entry');
    if (blacklist.liftedAt) {
      throw new ConflictError('ALREADY_LIFTED', 'That blacklist has already been lifted.');
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.blacklists)
        .set({ liftedAt: new Date(), liftedByUserId: actor.userId, liftReason: reason })
        .where(eq(schema.blacklists.id, blacklistId));

      // Only clear the applicant-level flag if nothing else is still in force.
      const [remaining] = await tx
        .select({ id: schema.blacklists.id })
        .from(schema.blacklists)
        .where(
          and(
            eq(schema.blacklists.applicantId, blacklist.applicantId),
            isNull(schema.blacklists.liftedAt),
          ),
        )
        .limit(1);

      if (!remaining) {
        await tx
          .update(schema.applicants)
          .set({ isBlacklisted: false })
          .where(eq(schema.applicants.id, blacklist.applicantId));

        await tx
          .update(schema.applicantFlags)
          .set({ removedAt: new Date(), removedByUserId: actor.userId })
          .where(
            and(
              eq(schema.applicantFlags.applicantId, blacklist.applicantId),
              eq(schema.applicantFlags.flag, FLAG.BLACKLISTED),
              isNull(schema.applicantFlags.removedAt),
            ),
          );
      }

      await this.timeline.write(
        {
          applicantId: blacklist.applicantId,
          eventType: TIMELINE_EVENT.BLACKLIST_LIFTED,
          summary: `Blacklist lifted — ${reason}`,
          meta: { blacklistId, reason },
        },
        tx,
      );

      await this.audit.record(
        {
          action: AUDIT.BLACKLIST_LIFTED,
          entityType: 'applicant',
          entityId: blacklist.applicantId,
          meta: { blacklistId, reason },
        },
        tx,
      );
    });

    await this.bust(blacklist.applicantId);
  }

  /** W-25 register — every entry, active and historical. */
  async list(filters: { activeOnly?: boolean; limit?: number } = {}) {
    const rows = await this.db
      .select({
        id: schema.blacklists.id,
        applicantId: schema.blacklists.applicantId,
        applicantCode: schema.applicants.applicantCode,
        applicantName: schema.applicants.fullName,
        kind: schema.blacklists.kind,
        reason: schema.blacklists.reason,
        reasonDetail: schema.blacklists.reasonDetail,
        remarks: schema.blacklists.remarks,
        effectiveFrom: schema.blacklists.effectiveFrom,
        effectiveUntil: schema.blacklists.effectiveUntil,
        liftedAt: schema.blacklists.liftedAt,
        liftReason: schema.blacklists.liftReason,
        documentCount: sql<number>`jsonb_array_length(${schema.blacklists.documentKeys})::int`,
        createdByName: schema.users.fullName,
        createdAt: schema.blacklists.createdAt,
      })
      .from(schema.blacklists)
      .innerJoin(schema.applicants, eq(schema.blacklists.applicantId, schema.applicants.id))
      .leftJoin(schema.users, eq(schema.blacklists.createdByUserId, schema.users.id))
      .where(filters.activeOnly ? isNull(schema.blacklists.liftedAt) : undefined)
      .orderBy(desc(schema.blacklists.createdAt))
      .limit(filters.limit ?? 200);

    return rows.map((row) => ({
      ...row,
      effectiveFrom: row.effectiveFrom.toISOString(),
      effectiveUntil: row.effectiveUntil?.toISOString() ?? null,
      liftedAt: row.liftedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      isActive: row.liftedAt === null,
    }));
  }

  // ── Restriction flags (§20) ───────────────────────────────────────────────

  async setFlag(input: {
    applicantId: string;
    flag: string;
    reason?: string;
    expiresAt?: Date;
  }): Promise<{ id: string }> {
    const actor = requireActor();

    if (!FLAG_META[input.flag as FlagCode]) {
      throw new ValidationError({ flag: ['Unknown flag.'] });
    }

    // The blacklist flag is a consequence of a blacklist entry, not something
    // to be set by hand — otherwise the flag and the register drift apart.
    if (input.flag === FLAG.BLACKLISTED) {
      throw new ValidationError({
        flag: ['Add a blacklist entry instead — the flag follows from it automatically.'],
      });
    }

    const [flag] = await this.db
      .insert(schema.applicantFlags)
      .values({
        applicantId: input.applicantId,
        flag: input.flag,
        reason: input.reason ?? null,
        expiresAt: input.expiresAt ?? null,
        setByUserId: actor.userId,
      })
      .onConflictDoNothing()
      .returning({ id: schema.applicantFlags.id });

    if (!flag) {
      throw new ConflictError('FLAG_EXISTS', 'That flag is already set on this applicant.');
    }

    const meta = FLAG_META[input.flag as FlagCode];

    await this.timeline.write({
      applicantId: input.applicantId,
      eventType: TIMELINE_EVENT.FLAG_ADDED,
      summary: `Flag added — ${meta.label}${input.reason ? `: ${input.reason}` : ''}`,
      meta: { flag: input.flag, reason: input.reason ?? null },
    });

    await this.audit.record({
      action: AUDIT.FLAG_SET,
      entityType: 'applicant',
      entityId: input.applicantId,
      meta: { flag: input.flag, reason: input.reason ?? null },
    });

    await this.bust(input.applicantId);
    return { id: flag.id };
  }

  async removeFlag(applicantId: string, flag: string): Promise<void> {
    const actor = requireActor();

    if (flag === FLAG.BLACKLISTED) {
      throw new ValidationError({
        flag: ['Lift the blacklist entry instead — the flag clears with it.'],
      });
    }

    const updated = await this.db
      .update(schema.applicantFlags)
      .set({ removedAt: new Date(), removedByUserId: actor.userId })
      .where(
        and(
          eq(schema.applicantFlags.applicantId, applicantId),
          eq(schema.applicantFlags.flag, flag),
          isNull(schema.applicantFlags.removedAt),
        ),
      )
      .returning({ id: schema.applicantFlags.id });

    if (updated.length === 0) throw new NotFoundError('Flag');

    await this.timeline.write({
      applicantId,
      eventType: TIMELINE_EVENT.FLAG_REMOVED,
      summary: `Flag removed — ${FLAG_META[flag as FlagCode]?.label ?? flag}`,
      meta: { flag },
    });

    await this.audit.record({
      action: AUDIT.FLAG_REMOVED,
      entityType: 'applicant',
      entityId: applicantId,
      meta: { flag },
    });

    await this.bust(applicantId);
  }

  async listFlags(applicantId: string) {
    const rows = await this.db
      .select({
        id: schema.applicantFlags.id,
        flag: schema.applicantFlags.flag,
        reason: schema.applicantFlags.reason,
        expiresAt: schema.applicantFlags.expiresAt,
        setByName: schema.users.fullName,
        createdAt: schema.applicantFlags.createdAt,
      })
      .from(schema.applicantFlags)
      .leftJoin(schema.users, eq(schema.applicantFlags.setByUserId, schema.users.id))
      .where(
        and(
          eq(schema.applicantFlags.applicantId, applicantId),
          isNull(schema.applicantFlags.removedAt),
        ),
      );

    return rows.map((row) => ({
      ...row,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      meta: FLAG_META[row.flag as FlagCode] ?? null,
    }));
  }

  private async bust(applicantId: string) {
    await this.cache.invalidateTags(
      CacheTag.applicant(applicantId),
      CacheTag.applicantList(),
      CacheTag.dashboard(),
    );
  }
}
