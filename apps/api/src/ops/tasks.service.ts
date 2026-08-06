import { Inject, Injectable } from '@nestjs/common';
import { TASK_STATUS, TIMELINE_EVENT } from '@nbr/shared';
import { and, asc, desc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { ForbiddenError, NotFoundError } from '../common/errors';
import { requireActor } from '../common/request-context';
import type { Database } from '../database/client';
import { DB } from '../database/database.tokens';
import * as schema from '../database/schema';
import { TimelineService } from '../timeline/timeline.service';

export interface TaskRow {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly status: string;
  readonly priority: string;
  readonly dueDate: string;
  readonly remindAt: string | null;
  readonly overdue: boolean;
  readonly assignedToUserId: string;
  readonly assignedToName: string | null;
  readonly applicantId: string | null;
  readonly applicantName: string | null;
  readonly applicantCode: string | null;
  readonly recordId: string | null;
  readonly completedAt: string | null;
  readonly completionRemark: string | null;
  readonly createdByName: string | null;
  readonly createdAt: string;
}

/**
 * Tasks & follow-ups (§15, P2-05).
 *
 * Per-applicant and on a global board. Everything is scoped by assignee on the
 * read path — the dashboard's "my pending tasks" and the board's "everyone's"
 * view are the same query with a different filter, so they cannot disagree.
 */
@Injectable()
export class TasksService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly timeline: TimelineService,
    private readonly audit: AuditService,
  ) {}

  async create(input: {
    applicantId?: string;
    recordId?: string;
    title: string;
    description?: string;
    assignedToUserId: string;
    dueDate: Date;
    priority: string;
    remindAt?: Date;
  }): Promise<{ id: string }> {
    const actor = requireActor();

    // Resolve the applicant from the record when only the record was given, so
    // the task still appears on the applicant's profile.
    let applicantId = input.applicantId ?? null;
    if (!applicantId && input.recordId) {
      const [record] = await this.db
        .select({ applicantId: schema.records.applicantId })
        .from(schema.records)
        .where(eq(schema.records.id, input.recordId))
        .limit(1);
      applicantId = record?.applicantId ?? null;
    }

    const [task] = await this.db
      .insert(schema.tasks)
      .values({
        applicantId,
        recordId: input.recordId ?? null,
        title: input.title,
        description: input.description ?? null,
        assignedToUserId: input.assignedToUserId,
        dueDate: input.dueDate,
        priority: input.priority,
        remindAt: input.remindAt ?? null,
        createdByUserId: actor.userId,
      })
      .returning({ id: schema.tasks.id });

    if (applicantId) {
      await this.timeline.write({
        applicantId,
        recordId: input.recordId ?? null,
        eventType: TIMELINE_EVENT.TASK_CREATED,
        summary: `Task created — ${input.title}`,
        meta: { dueDate: input.dueDate.toISOString(), priority: input.priority },
      });
    }

    return { id: task!.id };
  }

  async update(
    taskId: string,
    input: {
      status?: string;
      title?: string;
      description?: string;
      assignedToUserId?: string;
      dueDate?: Date;
      priority?: string;
      completionRemark?: string;
    },
  ): Promise<void> {
    const actor = requireActor();

    const [task] = await this.db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, taskId))
      .limit(1);

    if (!task) throw new NotFoundError('Task');

    // Reassigning someone else's task is an admin action; completing your own
    // is not. Without this, anyone could quietly clear another team's queue.
    const isOwn = task.assignedToUserId === actor.userId || task.createdByUserId === actor.userId;
    if (!isOwn && !actor.isSuperAdmin && !actor.permissions.has('tasks:edit')) {
      throw new ForbiddenError('You can only update tasks assigned to you.');
    }

    const completing =
      input.status === TASK_STATUS.COMPLETED && task.status !== TASK_STATUS.COMPLETED;

    await this.db
      .update(schema.tasks)
      .set({
        ...input,
        ...(completing
          ? { completedAt: new Date(), completedByUserId: actor.userId }
          : input.status === TASK_STATUS.PENDING
            ? { completedAt: null, completedByUserId: null }
            : {}),
      })
      .where(eq(schema.tasks.id, taskId));

    if (completing && task.applicantId) {
      await this.timeline.write({
        applicantId: task.applicantId,
        recordId: task.recordId,
        eventType: TIMELINE_EVENT.TASK_COMPLETED,
        summary: `Task completed — ${task.title}`,
        meta: { completionRemark: input.completionRemark ?? null },
      });
    }
  }

  /**
   * The task board (W-24) and the per-applicant list, from one query.
   *
   * `scope: 'mine'` is the default because an unfiltered board across a
   * 20-person team is noise to everyone.
   */
  async list(filters: {
    scope?: 'mine' | 'all' | 'applicant';
    applicantId?: string;
    status?: string;
    assignedToUserId?: string;
    dueBefore?: Date;
    overdueOnly?: boolean;
    limit?: number;
  }): Promise<TaskRow[]> {
    const actor = requireActor();
    const conditions = [];

    if (filters.scope === 'applicant' && filters.applicantId) {
      conditions.push(eq(schema.tasks.applicantId, filters.applicantId));
    } else if (filters.scope === 'all') {
      if (filters.assignedToUserId) {
        conditions.push(eq(schema.tasks.assignedToUserId, filters.assignedToUserId));
      }
    } else {
      conditions.push(eq(schema.tasks.assignedToUserId, actor.userId));
    }

    if (filters.status) conditions.push(eq(schema.tasks.status, filters.status));
    if (filters.dueBefore) conditions.push(lte(schema.tasks.dueDate, filters.dueBefore));
    if (filters.overdueOnly) {
      conditions.push(
        and(eq(schema.tasks.status, TASK_STATUS.PENDING), lte(schema.tasks.dueDate, new Date()))!,
      );
    }

    const rows = await this.db
      .select({
        id: schema.tasks.id,
        title: schema.tasks.title,
        description: schema.tasks.description,
        status: schema.tasks.status,
        priority: schema.tasks.priority,
        dueDate: schema.tasks.dueDate,
        remindAt: schema.tasks.remindAt,
        assignedToUserId: schema.tasks.assignedToUserId,
        assignedToName: schema.users.fullName,
        applicantId: schema.tasks.applicantId,
        applicantName: schema.applicants.fullName,
        applicantCode: schema.applicants.applicantCode,
        recordId: schema.tasks.recordId,
        completedAt: schema.tasks.completedAt,
        completionRemark: schema.tasks.completionRemark,
        createdAt: schema.tasks.createdAt,
      })
      .from(schema.tasks)
      .leftJoin(schema.users, eq(schema.tasks.assignedToUserId, schema.users.id))
      .leftJoin(schema.applicants, eq(schema.tasks.applicantId, schema.applicants.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      // Pending first, then soonest deadline — the order someone actually works in.
      .orderBy(
        sql`CASE WHEN ${schema.tasks.status} = 'pending' THEN 0 ELSE 1 END`,
        asc(schema.tasks.dueDate),
      )
      .limit(filters.limit ?? 100);

    return rows.map((row) => ({
      ...row,
      dueDate: row.dueDate.toISOString(),
      remindAt: row.remindAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      createdByName: null,
      overdue: row.status === TASK_STATUS.PENDING && row.dueDate.getTime() < Date.now(),
    }));
  }

  /** Counts for the board's filter chips. */
  async counts(): Promise<{ mine: number; overdue: number; dueToday: number; all: number }> {
    const actor = requireActor();
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const [row] = await this.db
      .select({
        mine: sql<number>`count(*) FILTER (WHERE ${schema.tasks.assignedToUserId} = ${actor.userId} AND ${schema.tasks.status} = 'pending')::int`,
        overdue: sql<number>`count(*) FILTER (WHERE ${schema.tasks.status} = 'pending' AND ${schema.tasks.dueDate} < now())::int`,
        dueToday: sql<number>`count(*) FILTER (WHERE ${schema.tasks.status} = 'pending' AND ${schema.tasks.dueDate} <= ${endOfToday.toISOString()}::timestamptz)::int`,
        all: sql<number>`count(*) FILTER (WHERE ${schema.tasks.status} = 'pending')::int`,
      })
      .from(schema.tasks);

    return row ?? { mine: 0, overdue: 0, dueToday: 0, all: 0 };
  }
}
