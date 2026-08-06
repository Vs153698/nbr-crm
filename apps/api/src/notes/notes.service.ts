import { Inject, Injectable } from '@nestjs/common';
import { TIMELINE_EVENT } from '@nbr/shared';
import { desc, eq, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { ForbiddenError, NotFoundError } from '../common/errors';
import { requireActor } from '../common/request-context';
import type { Database } from '../database/client';
import { DB } from '../database/database.tokens';
import * as schema from '../database/schema';
import { TimelineService } from '../timeline/timeline.service';

export interface NoteItem {
  readonly id: string;
  readonly body: string;
  readonly category: string;
  readonly priority: string;
  readonly followUpDate: string | null;
  readonly revisionCount: number;
  readonly lastEditedAt: string | null;
  readonly createdByName: string | null;
  readonly createdAt: string;
  readonly canEdit: boolean;
}

/**
 * Internal notes (§14, P1-13).
 *
 * "Notes should keep edit history." Editing writes the previous body to
 * `note_revisions` — which is itself append-only by trigger — so a note's
 * history cannot be laundered by editing it twice. Notes cannot be deleted at
 * all; the database rejects DELETE outright.
 */
@Injectable()
export class NotesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly timeline: TimelineService,
    private readonly audit: AuditService,
  ) {}

  async create(input: {
    applicantId: string;
    recordId?: string;
    body: string;
    category: string;
    priority: string;
    followUpDate?: Date;
    visibleToRoleIds?: string[];
  }): Promise<{ id: string }> {
    const actor = requireActor();

    const [note] = await this.db
      .insert(schema.notes)
      .values({
        applicantId: input.applicantId,
        recordId: input.recordId ?? null,
        body: input.body,
        category: input.category,
        priority: input.priority,
        followUpDate: input.followUpDate ?? null,
        visibleToRoleIds: input.visibleToRoleIds ?? [],
        createdByUserId: actor.userId,
        // Snapshotted so the note still reads correctly after the author's
        // account is deactivated.
        createdByName: actor.fullName,
      })
      .returning({ id: schema.notes.id });

    await this.timeline.write({
      applicantId: input.applicantId,
      recordId: input.recordId ?? null,
      eventType: TIMELINE_EVENT.NOTE_ADDED,
      summary: `Note added — ${truncate(input.body, 80)}`,
      meta: { category: input.category, priority: input.priority },
    });

    return { id: note!.id };
  }

  /**
   * Edit a note.
   *
   * Only the author may edit, and only within a short window — after that, a
   * correction belongs in a new note. An old note that can still be rewritten
   * is not a record of what someone thought at the time, which is the entire
   * value of an internal note in a dispute.
   */
  private static readonly EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

  async update(noteId: string, body: string, editReason?: string): Promise<void> {
    const actor = requireActor();

    const [note] = await this.db
      .select()
      .from(schema.notes)
      .where(eq(schema.notes.id, noteId))
      .limit(1);

    if (!note) throw new NotFoundError('Note');

    if (note.createdByUserId !== actor.userId && !actor.isSuperAdmin) {
      throw new ForbiddenError('You can only edit your own notes.');
    }

    const age = Date.now() - note.createdAt.getTime();
    if (age > NotesService.EDIT_WINDOW_MS && !actor.isSuperAdmin) {
      throw new ForbiddenError(
        'This note is more than 24 hours old and can no longer be edited. Add a new note instead — the original stays on the record.',
      );
    }

    await this.db.transaction(async (tx) => {
      const nextRevision = note.revisionCount + 1;

      await tx.insert(schema.noteRevisions).values({
        noteId,
        revision: nextRevision,
        previousBody: note.body,
        editReason: editReason ?? null,
        editedByUserId: actor.userId,
        editedByName: actor.fullName,
      });

      await tx
        .update(schema.notes)
        .set({
          body,
          revisionCount: nextRevision,
          lastEditedAt: new Date(),
        })
        .where(eq(schema.notes.id, noteId));

      await this.timeline.write(
        {
          applicantId: note.applicantId,
          recordId: note.recordId,
          eventType: TIMELINE_EVENT.NOTE_EDITED,
          summary: `Note edited (revision ${nextRevision})`,
          meta: { noteId, editReason: editReason ?? null },
        },
        tx,
      );
    });
  }

  async list(applicantId: string, recordId?: string): Promise<NoteItem[]> {
    const actor = requireActor();

    const rows = await this.db
      .select()
      .from(schema.notes)
      .where(
        recordId
          ? sql`${schema.notes.recordId} = ${recordId}`
          : eq(schema.notes.applicantId, applicantId),
      )
      .orderBy(desc(schema.notes.createdAt));

    return rows
      // Role-restricted notes are filtered here rather than in SQL because the
      // check needs the caller's role, and an empty list means "all staff".
      .filter(
        (note) =>
          note.visibleToRoleIds.length === 0 ||
          actor.isSuperAdmin ||
          note.visibleToRoleIds.includes(actor.roleId),
      )
      .map((note) => ({
        id: note.id,
        body: note.body,
        category: note.category,
        priority: note.priority,
        followUpDate: note.followUpDate?.toISOString() ?? null,
        revisionCount: note.revisionCount,
        lastEditedAt: note.lastEditedAt?.toISOString() ?? null,
        createdByName: note.createdByName,
        createdAt: note.createdAt.toISOString(),
        canEdit:
          (note.createdByUserId === actor.userId &&
            Date.now() - note.createdAt.getTime() <= NotesService.EDIT_WINDOW_MS) ||
          actor.isSuperAdmin,
      }));
  }

  /** The full edit history of one note — shown behind "edited" in the UI. */
  async revisions(noteId: string) {
    const rows = await this.db
      .select({
        revision: schema.noteRevisions.revision,
        previousBody: schema.noteRevisions.previousBody,
        editReason: schema.noteRevisions.editReason,
        editedByName: schema.noteRevisions.editedByName,
        createdAt: schema.noteRevisions.createdAt,
      })
      .from(schema.noteRevisions)
      .where(eq(schema.noteRevisions.noteId, noteId))
      .orderBy(desc(schema.noteRevisions.revision));

    return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
  }
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}
