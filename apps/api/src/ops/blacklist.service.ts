import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  BLACKLIST_KIND,
  BLACKLIST_REASON,
  BLACKLIST_REASON_LABELS,
  FLAG,
  FLAG_META,
  TIMELINE_EVENT,
  type BlacklistReason,
  legacyUserBlockSchema,
  type FlagCode,
  type LegacyUserBlockInput,
} from '@nbr/shared';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { AUDIT, AuditService } from '../audit/audit.service';
import { verifyWebhookSignature } from '../common/crypto';
import {
  ConflictError,
  NotFoundError,
  UnauthorisedError,
  ValidationError,
} from '../common/errors';
import { getActor, INTEGRATION_ACTOR_NAME, requireActor } from '../common/request-context';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import type { Database } from '../database/client';
import { DB } from '../database/database.tokens';
import * as schema from '../database/schema';
import { LegacyPushService } from '../integrations/legacy-push.service';
import { CacheService, CacheTag } from '../redis/cache.service';
import { TimelineService } from '../timeline/timeline.service';

/**
 * Where a blacklist change came from.
 *
 * `crm` pushes the block on to the website. `website` does not — it *is* the
 * website telling us, and echoing it straight back would have the two systems
 * volleying one block between them.
 */
export type BlacklistOrigin = 'crm' | 'website';

/** Detail recorded when the website blocks an account with no reason of its own. */
const WEBSITE_BLOCK_DETAIL = 'Account blocked on the NBR website.';
const WEBSITE_UNBLOCK_REASON = 'Account unblocked on the NBR website.';

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
  private readonly logger = new Logger(BlacklistService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly timeline: TimelineService,
    private readonly audit: AuditService,
    private readonly cache: CacheService,
    private readonly legacyPush: LegacyPushService,
  ) {}

  /**
   * Verify the website's signature, then apply the block.
   *
   * The signature check runs before the body is parsed as our schema — an
   * unsigned request should cost nothing beyond one HMAC. Same secret and same
   * tolerance as the application webhook, so an operator configures one value.
   */
  async receiveWebsiteBlock(
    rawBody: string,
    signatureHeader: string | undefined,
    parsedBody: unknown,
  ): Promise<{ matched: boolean; applicantId: string | null; changed: boolean }> {
    const verification = verifyWebhookSignature({
      header: signatureHeader,
      rawBody,
      secret: this.env.NBR_WEBHOOK_SECRET,
      toleranceSeconds: this.env.NBR_WEBHOOK_TOLERANCE_SECONDS,
    });

    if (!verification.valid) {
      this.logger.warn(`Rejected website user-block push: ${verification.reason}`);

      await this.audit.record({
        action: AUDIT.WEBHOOK_REJECTED,
        entityType: 'integration',
        entityLabel: 'nbr_website:user-block',
        meta: { reason: verification.reason },
      });

      throw new UnauthorisedError(
        'WEBHOOK_SIGNATURE_INVALID',
        `The signature did not verify (${verification.reason}).`,
      );
    }

    return this.applyFromWebsite(legacyUserBlockSchema.parse(parsedBody));
  }

  /**
   * M-09 Blacklist Applicant.
   *
   * `origin` decides whether the block is mirrored on to the website. An
   * operator acting here is authoritative and the website is told; a block that
   * *arrived* from the website is already in force over there and must not be
   * sent back.
   */
  async add(input: {
    applicantId: string;
    kind: string;
    reason: string;
    reasonDetail: string;
    effectiveUntil?: Date;
    documentKeys: string[];
    remarks?: string;
    origin?: BlacklistOrigin;
  }): Promise<{ id: string }> {
    // Not `requireActor` any more: the website's own block arrives on a signed
    // server-to-server call with no session behind it, and the timeline and
    // audit writers already record an authorless change as System.
    const actor = getActor();
    const origin = input.origin ?? 'crm';

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
          createdByUserId: actor?.userId ?? null,
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
          setByUserId: actor?.userId ?? null,
        })
        .onConflictDoNothing();

      const reasonLabel =
        BLACKLIST_REASON_LABELS[input.reason as BlacklistReason] ?? input.reason;

      await this.timeline.write(
        {
          applicantId: input.applicantId,
          eventType: TIMELINE_EVENT.BLACKLISTED,
          summary:
            origin === 'website'
              ? `Blacklisted (${input.kind}) — ${reasonLabel} · mirrored from the NBR website`
              : `Blacklisted (${input.kind}) — ${reasonLabel}`,
          meta: {
            kind: input.kind,
            reason: input.reason,
            detail: input.reasonDetail,
            effectiveUntil: input.effectiveUntil?.toISOString() ?? null,
            origin,
          },
          ...(origin === 'website'
            ? { actorKind: 'integration' as const, actorName: INTEGRATION_ACTOR_NAME }
            : {}),
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

    // Block the website account too, so a blacklisted person cannot simply log
    // in over there and file again. Detached: the register entry here is
    // already written and enforced, and a website outage must not undo it.
    if (origin === 'crm') {
      this.legacyPush.pushBlacklist(input.applicantId, {
        action: 'add',
        kind: input.kind,
        reason: input.reason,
        reasonDetail: input.reasonDetail,
        effectiveUntil: input.effectiveUntil ?? null,
      });
    }

    return { id };
  }

  /** Lifting keeps the record — it stamps `liftedAt` rather than deleting. */
  async lift(
    blacklistId: string,
    reason: string,
    origin: BlacklistOrigin = 'crm',
  ): Promise<void> {
    const actor = getActor();

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
        .set({ liftedAt: new Date(), liftedByUserId: actor?.userId ?? null, liftReason: reason })
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
          .set({ removedAt: new Date(), removedByUserId: actor?.userId ?? null })
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
          summary:
            origin === 'website'
              ? `Blacklist lifted — ${reason} · mirrored from the NBR website`
              : `Blacklist lifted — ${reason}`,
          meta: { blacklistId, reason, origin },
          ...(origin === 'website'
            ? { actorKind: 'integration' as const, actorName: INTEGRATION_ACTOR_NAME }
            : {}),
        },
        tx,
      );

      await this.audit.record(
        {
          action: AUDIT.BLACKLIST_LIFTED,
          entityType: 'applicant',
          entityId: blacklist.applicantId,
          meta: { blacklistId, reason, origin },
        },
        tx,
      );
    });

    await this.bust(blacklist.applicantId);

    // Unblock the website account, but only once nothing else is still in
    // force here — two blacklists and one lift must not restore their login.
    if (origin === 'crm') {
      const [stillBlocked] = await this.db
        .select({ id: schema.blacklists.id })
        .from(schema.blacklists)
        .where(
          and(
            eq(schema.blacklists.applicantId, blacklist.applicantId),
            isNull(schema.blacklists.liftedAt),
          ),
        )
        .limit(1);

      if (!stillBlocked) {
        this.legacyPush.pushBlacklist(blacklist.applicantId, { action: 'lift' });
      }
    }
  }

  /**
   * ── Inbound: the website blocked or unblocked an account ──────────────────
   *
   * The website's Users screen has always had a block switch, and it already
   * refuses that person's login and refuses an admin filing an application for
   * them. What it had no way to do was tell anyone — so a person blocked over
   * there stayed fully active here, and the CRM would happily open a new record
   * for them the same afternoon.
   *
   * Matching is on mobile first, then email. Mobile is the identifier the CRM
   * treats as identity — it carries a unique index and drives duplicate
   * detection — whereas an email is routinely shared inside a family or reused
   * by an agent filing on someone's behalf, so matching on it alone would
   * occasionally blacklist the wrong person.
   *
   * Someone the CRM has never met is not an error: they registered on the
   * website and never got as far as an application. Reported as `matched:
   * false` so the website's log says so plainly.
   */
  async applyFromWebsite(
    input: LegacyUserBlockInput,
  ): Promise<{ matched: boolean; applicantId: string | null; changed: boolean }> {
    const applicant = await this.findByIdentifiers(input.email, input.phone);

    if (!applicant) {
      this.logger.warn(
        `Website ${input.action} for ${input.email ?? input.phone ?? input.userId} matched no applicant`,
      );
      return { matched: false, applicantId: null, changed: false };
    }

    const [active] = await this.db
      .select({ id: schema.blacklists.id })
      .from(schema.blacklists)
      .where(
        and(eq(schema.blacklists.applicantId, applicant.id), isNull(schema.blacklists.liftedAt)),
      )
      .limit(1);

    if (input.action === 'block') {
      // Already blocked here. The two systems agree, which is the point —
      // report success so the website stops retrying.
      if (active) return { matched: true, applicantId: applicant.id, changed: false };

      await this.add({
        applicantId: applicant.id,
        // The website's switch has no end date, so the honest mirror is a
        // permanent entry. An operator here can lift it at any time, and that
        // lift travels back and unblocks the account.
        kind: BLACKLIST_KIND.PERMANENT,
        reason: BLACKLIST_REASON.OTHER,
        reasonDetail: input.reason?.trim() || WEBSITE_BLOCK_DETAIL,
        documentKeys: [],
        remarks: `Blocked on the NBR website (user ${input.userId}).`,
        origin: 'website',
      });

      return { matched: true, applicantId: applicant.id, changed: true };
    }

    if (!active) return { matched: true, applicantId: applicant.id, changed: false };

    await this.lift(active.id, input.reason?.trim() || WEBSITE_UNBLOCK_REASON, 'website');
    return { matched: true, applicantId: applicant.id, changed: true };
  }

  /**
   * Find the applicant behind a website account.
   *
   * Deliberately exact-match only. A fuzzy name match is right for the
   * duplicate-detection warning, where a human reads the result and decides;
   * it is wrong here, where the outcome is an automatic block applied with
   * nobody looking.
   */
  private async findByIdentifiers(email?: string, phone?: string) {
    const digits = phone?.replace(/\D/g, '') ?? '';
    // The website stores bare ten-digit Indian mobiles; the CRM normalises to
    // the last ten. Comparing the tails is what makes "+91 98765 43210" and
    // "9876543210" the same person.
    const tail = digits.length >= 10 ? digits.slice(-10) : null;
    const normalisedEmail = email?.trim().toLowerCase() || null;

    if (!tail && !normalisedEmail) return null;

    const [byMobile] = tail
      ? await this.db
          .select({ id: schema.applicants.id })
          .from(schema.applicants)
          .where(
            and(
              isNull(schema.applicants.deletedAt),
              sql`right(regexp_replace(${schema.applicants.mobileNormalised}, '\\D', '', 'g'), 10) = ${tail}`,
            ),
          )
          .limit(1)
      : [];

    if (byMobile) return byMobile;

    const [byEmail] = normalisedEmail
      ? await this.db
          .select({ id: schema.applicants.id })
          .from(schema.applicants)
          .where(
            and(
              isNull(schema.applicants.deletedAt),
              eq(schema.applicants.emailNormalised, normalisedEmail),
            ),
          )
          .limit(1)
      : [];

    return byEmail ?? null;
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
