import { Inject, Injectable } from '@nestjs/common';
import {
  APPLICATION_SOURCE,
  CALL_OUTCOME,
  formatLeadId,
  isConnectedOutcome,
  LEAD_STATUS,
  normaliseMobile,
  RECORD_STATUS,
  type CallOutcome,
  type LeadStatus,
  TIMELINE_EVENT,} from '@nbr/shared';
import { and, asc, desc, eq, gte, ilike, isNull, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import { AUDIT, AuditService } from '../audit/audit.service';
import { ConflictError, NotFoundError, ValidationError } from '../common/errors';
import { requireActor } from '../common/request-context';
import type { Database } from '../database/client';
import { DB } from '../database/database.tokens';
import * as schema from '../database/schema';
import { ApplicantsService } from '../applicants/applicants.service';
import { TimelineService } from '../timeline/timeline.service';

/**
 * Where a lead lands after a call, when the rep does not say explicitly.
 *
 * Derived from the outcome so the common case needs one click rather than two
 * dropdowns that can contradict each other. An unanswered call deliberately
 * maps to `undefined` — it leaves the lead exactly where it was, because
 * failing to reach someone tells you nothing about their interest.
 */
const OUTCOME_TO_STATUS: Readonly<Partial<Record<CallOutcome, LeadStatus>>> = {
  [CALL_OUTCOME.CONNECTED]: LEAD_STATUS.CONTACTED,
  [CALL_OUTCOME.INTERESTED]: LEAD_STATUS.INTERESTED,
  [CALL_OUTCOME.CALLBACK_REQUESTED]: LEAD_STATUS.CALLBACK,
  [CALL_OUTCOME.NOT_INTERESTED]: LEAD_STATUS.NOT_INTERESTED,
  [CALL_OUTCOME.WRONG_NUMBER]: LEAD_STATUS.UNQUALIFIED,
};

const DEFAULT_PAGE_SIZE = 25;

@Injectable()
export class LeadsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly applicants: ApplicantsService,
    private readonly timeline: TimelineService,
  ) {}

  // ── Create ────────────────────────────────────────────────────────────────

  async create(input: {
    fullName: string;
    mobile: string;
    email?: string;
    city?: string;
    state?: string;
    achievementSummary?: string;
    category?: string;
    source: string;
    sourceDetail?: string;
    ownerUserId?: string;
    nextFollowUpAt?: Date;
    notes?: string;
  }): Promise<{ id: string; leadCode: string }> {
    const actor = requireActor();

    // The schema already validated the number, but normaliseMobile is defensive
    // and returns null for anything it cannot make sense of. The column is NOT
    // NULL and the duplicate guard keys on it, so a null here must fail loudly
    // rather than land as an empty string that matches every other bad row.
    const mobileNormalised = normaliseMobile(input.mobile);
    if (!mobileNormalised) {
      throw new ValidationError({ mobile: ['That does not look like a valid mobile number.'] });
    }

    // Two reps working the same number off two imported lists is the classic
    // outbound failure. Checked here so the caller gets a pointer to the open
    // lead rather than a unique-violation 500.
    const [existing] = await this.db
      .select({
        id: schema.leads.id,
        leadCode: schema.leads.leadCode,
        ownerUserId: schema.leads.ownerUserId,
      })
      .from(schema.leads)
      .where(
        and(
          eq(schema.leads.mobileNormalised, mobileNormalised),
          isNull(schema.leads.deletedAt),
          sql`${schema.leads.status} not in ('converted','lost','not_interested','unqualified')`,
        ),
      )
      .limit(1);

    if (existing) {
      throw new ConflictError(
        'LEAD_ALREADY_OPEN',
        `${input.mobile} is already an open lead (${existing.leadCode}). Work that one rather than starting a second.`,
      );
    }

    const lead = await this.db.transaction(async (tx) => {
      const result = await tx.execute<{ nextval: string }>(
        sql`SELECT nextval('lead_code_seq')::text AS nextval`,
      );
      const sequence = Number((result as unknown as Array<{ nextval: string }>)[0]!.nextval);
      const leadCode = formatLeadId(sequence);

      const [row] = await tx
        .insert(schema.leads)
        .values({
          leadCode,
          fullName: input.fullName,
          mobile: input.mobile,
          mobileNormalised,
          email: input.email ?? null,
          city: input.city ?? null,
          state: input.state ?? null,
          achievementSummary: input.achievementSummary ?? null,
          category: input.category ?? null,
          status: LEAD_STATUS.NEW,
          source: input.source,
          sourceDetail: input.sourceDetail ?? null,
          // An unowned lead is nobody's job, so it falls to whoever entered it.
          ownerUserId: input.ownerUserId ?? actor.userId,
          nextFollowUpAt: input.nextFollowUpAt ?? null,
          notes: input.notes ?? null,
          createdByUserId: actor.userId,
        })
        .returning({ id: schema.leads.id, leadCode: schema.leads.leadCode });

      return row!;
    });

    await this.audit.record({
      action: AUDIT.LEAD_CREATED,
      entityType: 'lead',
      entityId: lead.id,
      entityLabel: `${lead.leadCode} — ${input.fullName}`,
    });

    return lead;
  }

  // ── Read ──────────────────────────────────────────────────────────────────

  async list(filters: {
    q?: string;
    status?: string;
    ownerUserId?: string;
    source?: string;
    followUp?: 'due_today' | 'overdue' | 'upcoming';
    limit?: number;
    cursor?: string;
  }) {
    const conditions: SQL[] = [isNull(schema.leads.deletedAt)];

    if (filters.status) conditions.push(eq(schema.leads.status, filters.status));
    if (filters.ownerUserId) conditions.push(eq(schema.leads.ownerUserId, filters.ownerUserId));
    if (filters.source) conditions.push(eq(schema.leads.source, filters.source));

    if (filters.q) {
      const term = `%${filters.q}%`;
      const digits = filters.q.replace(/\D/g, '');
      const search = [ilike(schema.leads.fullName, term), ilike(schema.leads.leadCode, term)];
      if (digits.length >= 4) search.push(ilike(schema.leads.mobileNormalised, `%${digits}%`));
      conditions.push(or(...search)!);
    }

    if (filters.followUp) {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const startOfTomorrow = new Date(startOfToday);
      startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

      // Only open leads can have an outstanding follow-up; a converted lead with
      // a stale date is not a missed call.
      conditions.push(sql`${schema.leads.status} not in ('converted','lost','not_interested','unqualified')`);

      if (filters.followUp === 'overdue') {
        conditions.push(lt(schema.leads.nextFollowUpAt, startOfToday));
      } else if (filters.followUp === 'due_today') {
        conditions.push(gte(schema.leads.nextFollowUpAt, startOfToday));
        conditions.push(lt(schema.leads.nextFollowUpAt, startOfTomorrow));
      } else {
        conditions.push(gte(schema.leads.nextFollowUpAt, startOfTomorrow));
      }
    }

    const limit = Math.min(filters.limit ?? DEFAULT_PAGE_SIZE, 100);

    const rows = await this.db
      .select({
        id: schema.leads.id,
        leadCode: schema.leads.leadCode,
        fullName: schema.leads.fullName,
        mobile: schema.leads.mobile,
        email: schema.leads.email,
        city: schema.leads.city,
        status: schema.leads.status,
        source: schema.leads.source,
        category: schema.leads.category,
        ownerUserId: schema.leads.ownerUserId,
        ownerName: schema.users.fullName,
        nextFollowUpAt: schema.leads.nextFollowUpAt,
        lastContactedAt: schema.leads.lastContactedAt,
        callCount: schema.leads.callCount,
        convertedApplicantId: schema.leads.convertedApplicantId,
        updatedAt: schema.leads.updatedAt,
      })
      .from(schema.leads)
      .leftJoin(schema.users, eq(schema.users.id, schema.leads.ownerUserId))
      .where(and(...conditions))
      // Follow-up queues read best oldest-first: the most overdue is the most
      // urgent. Everything else is newest-activity-first.
      .orderBy(
        filters.followUp ? asc(schema.leads.nextFollowUpAt) : desc(schema.leads.updatedAt),
      )
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return {
      items: page.map((row) => ({
        ...row,
        nextFollowUpAt: row.nextFollowUpAt?.toISOString() ?? null,
        lastContactedAt: row.lastContactedAt?.toISOString() ?? null,
        updatedAt: row.updatedAt.toISOString(),
      })),
      nextCursor: hasMore ? page[page.length - 1]!.id : null,
    };
  }

  async getById(leadId: string) {
    const [lead] = await this.db
      .select()
      .from(schema.leads)
      .where(and(eq(schema.leads.id, leadId), isNull(schema.leads.deletedAt)))
      .limit(1);

    if (!lead) throw new NotFoundError('Lead');

    const calls = await this.db
      .select()
      .from(schema.leadCalls)
      .where(eq(schema.leadCalls.leadId, leadId))
      .orderBy(desc(schema.leadCalls.calledAt));

    return {
      ...lead,
      nextFollowUpAt: lead.nextFollowUpAt?.toISOString() ?? null,
      lastContactedAt: lead.lastContactedAt?.toISOString() ?? null,
      convertedAt: lead.convertedAt?.toISOString() ?? null,
      createdAt: lead.createdAt.toISOString(),
      updatedAt: lead.updatedAt.toISOString(),
      calls: calls.map((call) => ({
        ...call,
        calledAt: call.calledAt.toISOString(),
        followUpAt: call.followUpAt?.toISOString() ?? null,
        createdAt: call.createdAt.toISOString(),
      })),
    };
  }

  // ── Update ────────────────────────────────────────────────────────────────

  async update(leadId: string, input: Record<string, unknown>): Promise<{ ok: true }> {
    const lead = await this.requireOpen(leadId, { allowClosed: true });

    const patch: Record<string, unknown> = { ...input };
    if (typeof input.mobile === 'string') {
      const normalised = normaliseMobile(input.mobile);
      if (!normalised) {
        throw new ValidationError({ mobile: ['That does not look like a valid mobile number.'] });
      }
      patch.mobileNormalised = normalised;
    }
    delete patch.override;

    await this.db.update(schema.leads).set(patch).where(eq(schema.leads.id, leadId));

    await this.audit.record({
      action: AUDIT.LEAD_UPDATED,
      entityType: 'lead',
      entityId: leadId,
      entityLabel: lead.leadCode,
      meta: { fields: Object.keys(input) },
    });

    return { ok: true };
  }

  // ── Log a call ────────────────────────────────────────────────────────────

  /**
   * Record one call attempt and move the lead on.
   *
   * Everything happens in one transaction because the denormalised counters on
   * the lead (`callCount`, `lastContactedAt`, `nextFollowUpAt`) are what the
   * dashboard and the evening report read. If a call row could exist without
   * them updating, the report would undercount and nobody would notice.
   */
  async logCall(
    leadId: string,
    input: {
      outcome: CallOutcome;
      summary: string;
      durationMinutes?: number;
      followUpAt?: Date;
      resultingStatus?: LeadStatus;
      calledAt?: Date;
    },
  ): Promise<{ callId: string; status: LeadStatus }> {
    const actor = requireActor();
    const lead = await this.requireOpen(leadId, { allowClosed: false });

    const calledAt = input.calledAt ?? new Date();
    const nextStatus =
      input.resultingStatus ?? OUTCOME_TO_STATUS[input.outcome] ?? (lead.status as LeadStatus);

    const callId = await this.db.transaction(async (tx) => {
      const [call] = await tx
        .insert(schema.leadCalls)
        .values({
          leadId,
          calledByUserId: actor.userId,
          calledByName: actor.fullName,
          calledAt,
          outcome: input.outcome,
          durationMinutes: input.durationMinutes ?? null,
          summary: input.summary,
          followUpAt: input.followUpAt ?? null,
          resultingStatus: nextStatus,
        })
        .returning({ id: schema.leadCalls.id });

      await tx
        .update(schema.leads)
        .set({
          status: nextStatus,
          callCount: sql`${schema.leads.callCount} + 1`,
          // Only a call that actually reached someone counts as contact. An
          // unanswered ring would otherwise make a lead look worked.
          lastContactedAt: isConnectedOutcome(input.outcome) ? calledAt : lead.lastContactedAt,
          // Clearing on no follow-up is deliberate: the previous commitment was
          // just serviced by this call, so leaving it would report as missed.
          nextFollowUpAt: input.followUpAt ?? null,
        })
        .where(eq(schema.leads.id, leadId));

      return call!.id;
    });

    await this.audit.record({
      action: AUDIT.LEAD_CALL_LOGGED,
      entityType: 'lead',
      entityId: leadId,
      entityLabel: `${lead.leadCode} — ${input.outcome}`,
      meta: { followUpAt: input.followUpAt?.toISOString() ?? null, status: nextStatus },
    });

    return { callId, status: nextStatus };
  }

  // ── Convert ───────────────────────────────────────────────────────────────

  /**
   * Turn a lead into an applicant with a record.
   *
   * The lead row is kept and marked converted rather than deleted: it carries
   * the call history that explains how the applicant was won, which is the only
   * evidence the sales report has that the effort paid off.
   */
  async convert(
    leadId: string,
    input: {
      categoryId: string;
      recordTitle: string;
      description?: string;
      existingApplicantId?: string;
      override: boolean;
      overrideReason?: string;
    },
  ): Promise<{ applicantId: string; applicantCode: string; recordId: string; recordCode: string }> {
    const lead = await this.requireOpen(leadId, { allowClosed: false });

    if (lead.status === LEAD_STATUS.CONVERTED) {
      throw new ConflictError(
        'LEAD_ALREADY_CONVERTED',
        `${lead.leadCode} has already been converted.`,
      );
    }

    if (!lead.email) {
      throw new ValidationError({
        email: [
          'An email address is required to open an applicant profile. Add one to the lead first.',
        ],
      });
    }

    // Reuses the ordinary intake path rather than inserting rows directly, so a
    // converted lead gets the same duplicate detection, consent ledger entry,
    // timeline and audit trail as a walk-in.
    const created = await this.applicants.create({
      applicant: {
        fullName: lead.fullName,
        mobile: lead.mobile,
        email: lead.email,
        city: lead.city ?? undefined,
        state: lead.state ?? undefined,
        country: 'India',
      },
      record: {
        source: APPLICATION_SOURCE.PHONE,
        initialStatus: RECORD_STATUS.NEW_LEAD,
        internalRemarks: `Converted from sales lead ${lead.leadCode}.`,
        achievement: {
          recordTitle: input.recordTitle,
          categoryId: input.categoryId,
          recordType: 'individual',
          description: input.description ?? lead.achievementSummary ?? undefined,
          participantCount: 1,
        },
      },
      overrideDuplicate: input.override,
      overrideReason: input.overrideReason,
    } as never);

    await this.db
      .update(schema.leads)
      .set({
        status: LEAD_STATUS.CONVERTED,
        convertedApplicantId: created.applicantId,
        convertedRecordId: created.recordId,
        convertedAt: new Date(),
        nextFollowUpAt: null,
      })
      .where(eq(schema.leads.id, leadId));

    /**
     * Carry the sales calls onto the applicant's timeline.
     *
     * Without this the call history stays behind in `lead_calls`, reachable
     * only from a lead page nobody visits once it is converted — so the
     * profile of a hard-won applicant looks as though they simply walked in.
     * Anyone later asking "how did we get this one?" or "who has spoken to
     * them?" is answered on the profile itself.
     *
     * Each entry keeps its original date and caller, so the timeline reads as
     * the history it is rather than a burst of activity at conversion.
     */
    const calls = await this.db
      .select()
      .from(schema.leadCalls)
      .where(eq(schema.leadCalls.leadId, leadId))
      .orderBy(schema.leadCalls.calledAt);

    await this.timeline.writeMany([
      ...calls.map((call) => ({
        applicantId: created.applicantId,
        recordId: created.recordId,
        eventType: TIMELINE_EVENT.CALL_LOGGED,
        summary: `Sales call — ${call.outcome.replace(/_/g, ' ')}${
          call.durationMinutes ? ` (${call.durationMinutes} min)` : ''
        }: ${call.summary.slice(0, 120)}`,
        meta: {
          source: 'lead',
          leadCode: lead.leadCode,
          outcome: call.outcome,
          durationMinutes: call.durationMinutes,
          followUpAt: call.followUpAt?.toISOString() ?? null,
        },
        // The person who actually made the call, not whoever converted.
        actorKind: 'user' as const,
        actorName: call.calledByName ?? undefined,
        occurredAt: call.calledAt,
      })),
      {
        applicantId: created.applicantId,
        recordId: created.recordId,
        eventType: TIMELINE_EVENT.RECORD_CREATED,
        summary: `Converted from sales lead ${lead.leadCode} after ${calls.length} call${
          calls.length === 1 ? '' : 's'
        }`,
        meta: { leadCode: lead.leadCode, leadId, callCount: calls.length },
      },
    ]);

    await this.audit.record({
      action: AUDIT.LEAD_CONVERTED,
      entityType: 'lead',
      entityId: leadId,
      entityLabel: `${lead.leadCode} → ${created.applicantCode}`,
      meta: { applicantId: created.applicantId, recordId: created.recordId },
    });

    return created;
  }

  /** Soft delete — the call history stays for the report's historical figures. */
  async remove(leadId: string, reason?: string): Promise<{ ok: true }> {
    const lead = await this.requireOpen(leadId, { allowClosed: true });

    await this.db
      .update(schema.leads)
      .set({ deletedAt: new Date() })
      .where(eq(schema.leads.id, leadId));

    await this.audit.record({
      action: AUDIT.LEAD_DELETED,
      entityType: 'lead',
      entityId: leadId,
      entityLabel: lead.leadCode,
      meta: { reason: reason ?? null },
    });

    return { ok: true };
  }

  private async requireOpen(leadId: string, options: { allowClosed: boolean }) {
    const [lead] = await this.db
      .select()
      .from(schema.leads)
      .where(and(eq(schema.leads.id, leadId), isNull(schema.leads.deletedAt)))
      .limit(1);

    if (!lead) throw new NotFoundError('Lead');

    if (!options.allowClosed && lead.status === LEAD_STATUS.CONVERTED) {
      throw new ConflictError(
        'LEAD_CLOSED',
        `${lead.leadCode} has been converted — work the applicant profile instead.`,
      );
    }

    return lead;
  }
}
