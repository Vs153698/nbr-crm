import { NOTE_CATEGORY, TASK_PRIORITY } from '@nbr/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Chip } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { CardHeader, EmptyState } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Input, Select, Textarea } from '@/components/ui/Field';
import { useAuth } from '@/hooks/useAuth';
import { api, ApiError } from '@/lib/api-client';
import { formatDateTime, formatRelative, humanise } from '@/lib/format';
import { ICON_SIZE, ICON_STROKE, Icons } from '@/lib/icons';
import { queryKeys } from '@/lib/query-client';
import type { NoteItem } from '../types';
import { useAutoOpen } from '@/hooks/useAutoOpen';

/**
 * W-15 Internal notes (§14, P1-13).
 *
 * Notes are permanent: there is no delete control, and editing writes a
 * revision rather than replacing the text. The UI says so plainly, because a
 * user who believes a note is disposable will write something they wouldn't
 * want on a permanent record.
 */
export function NotesTab({
  applicantId,
  recordId,
  autoOpen,
  onAutoOpened,
}: {
  applicantId: string;
  recordId?: string;
  autoOpen?: string | null;
  onAutoOpened?: () => void;
}) {
  const queryClient = useQueryClient();
  const { can } = useAuth();

  const [composerOpen, setComposerOpen] = useState(false);

  useAutoOpen(autoOpen, { note: () => setComposerOpen(true) }, onAutoOpened);
  const [body, setBody] = useState('');
  const [category, setCategory] = useState<string>(NOTE_CATEGORY.GENERAL);
  const [priority, setPriority] = useState<string>(TASK_PRIORITY.NORMAL);
  const [followUpDate, setFollowUpDate] = useState('');

  const [editing, setEditing] = useState<NoteItem | null>(null);
  const [editBody, setEditBody] = useState('');
  const [editReason, setEditReason] = useState('');

  const { data: notes, isLoading } = useQuery({
    queryKey: queryKeys.notes(applicantId, recordId),
    queryFn: ({ signal }) => api.get<NoteItem[]>('/notes', { applicantId, recordId }, signal),
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.notes(applicantId, recordId) });
    if (recordId) void queryClient.invalidateQueries({ queryKey: queryKeys.record(recordId) });
  }

  const createMutation = useMutation({
    mutationFn: () =>
      api.post('/notes', {
        applicantId,
        recordId,
        body,
        category,
        priority,
        followUpDate: followUpDate || undefined,
      }),
    onSuccess: () => {
      toast.success('Note saved');
      setComposerOpen(false);
      setBody('');
      setFollowUpDate('');
      invalidate();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not save the note'),
  });

  const updateMutation = useMutation({
    mutationFn: () => api.put(`/notes/${editing?.id}`, { body: editBody, editReason: editReason || undefined }),
    onSuccess: () => {
      toast.success('Note updated', { description: 'The previous version is kept in its history.' });
      setEditing(null);
      setEditReason('');
      invalidate();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not update the note'),
  });

  return (
    <div className="space-y-4">
      <CardHeader
        title="Internal notes"
        subtitle="Visible to staff only. Notes are permanent — edits keep a full history."
        icon={Icons.StickyNote}
        action={
          can('notes:create') ? (
            <Button size="sm" variant="primary" icon={Icons.Plus} onClick={() => setComposerOpen(true)}>
              Add note
            </Button>
          ) : null
        }
      />

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1].map((index) => (
            <div key={index} className="skeleton h-20" />
          ))}
        </div>
      ) : (notes?.length ?? 0) === 0 ? (
        <EmptyState
          icon={Icons.StickyNote}
          title="No notes yet"
          description="Record call summaries, verification remarks and anything the next person handling this applicant should know."
          action={
            can('notes:create') ? (
              <Button variant="primary" icon={Icons.Plus} onClick={() => setComposerOpen(true)}>
                Add the first note
              </Button>
            ) : null
          }
        />
      ) : (
        <ul className="space-y-2.5">
          {notes?.map((note) => (
            <li key={note.id} className="rounded-card border border-line bg-white p-3.5">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Chip tone={note.category === 'call_summary' ? 'blue' : 'slate'}>
                  {humanise(note.category)}
                </Chip>
                {note.priority !== TASK_PRIORITY.NORMAL ? (
                  <Chip tone={note.priority === 'urgent' ? 'red' : 'orange'}>{note.priority}</Chip>
                ) : null}
                {note.followUpDate ? (
                  <Chip tone="purple">
                    <Icons.CalendarClock size={10} strokeWidth={2} />
                    Follow up {formatRelative(note.followUpDate)}
                  </Chip>
                ) : null}

                <span className="ml-auto text-[10px] text-ink-3" title={formatDateTime(note.createdAt)}>
                  {note.createdByName} · {formatRelative(note.createdAt)}
                </span>
              </div>

              <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{note.body}</p>

              <div className="mt-2 flex items-center gap-3">
                {note.revisionCount > 0 ? (
                  <span className="flex items-center gap-1 text-[10px] text-ink-3">
                    <Icons.PenLine size={10} strokeWidth={2} />
                    Edited {note.revisionCount} time{note.revisionCount === 1 ? '' : 's'} · last{' '}
                    {formatRelative(note.lastEditedAt)}
                  </span>
                ) : null}

                {note.canEdit ? (
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(note);
                      setEditBody(note.body);
                    }}
                    className="ml-auto text-[10px] font-semibold text-brand hover:underline"
                  >
                    Edit
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* M-02 Add note */}
      <Dialog
        open={composerOpen}
        onOpenChange={setComposerOpen}
        title="Add note"
        footer={
          <>
            <Button variant="ghost" onClick={() => setComposerOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={createMutation.isPending}
              disabled={!body.trim()}
              onClick={() => createMutation.mutate()}
            >
              Save note
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Textarea
            label="Note"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={5}
            autoFocus
            placeholder="What happened, and what the next person needs to know."
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              options={Object.values(NOTE_CATEGORY).map((value) => ({
                value,
                label: humanise(value),
              }))}
            />
            <Select
              label="Priority"
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
              options={Object.values(TASK_PRIORITY).map((value) => ({
                value,
                label: humanise(value),
              }))}
            />
          </div>

          <Input
            label="Follow-up date"
            type="date"
            value={followUpDate}
            onChange={(event) => setFollowUpDate(event.target.value)}
          />

          <p className="flex items-start gap-1.5 rounded-lg bg-canvas p-2.5 text-[11px] text-ink-3">
            <Icons.Info size={13} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0" />
            Notes are permanent and cannot be deleted. They can be edited for 24 hours, and every
            edit keeps the previous version.
          </p>
        </div>
      </Dialog>

      {/* Edit — writes a revision, never replaces */}
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title="Edit note"
        description="The previous version is kept and stays visible in the note's history."
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={updateMutation.isPending}
              disabled={!editBody.trim() || editBody === editing?.body}
              onClick={() => updateMutation.mutate()}
            >
              Save revision
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Textarea
            label="Note"
            value={editBody}
            onChange={(event) => setEditBody(event.target.value)}
            rows={5}
            autoFocus
          />
          <Input
            label="Reason for the edit"
            value={editReason}
            onChange={(event) => setEditReason(event.target.value)}
            placeholder="e.g. corrected the spelling of the applicant's name"
          />
        </div>
      </Dialog>
    </div>
  );
}
