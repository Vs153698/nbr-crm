import { TASK_PRIORITY, TASK_STATUS } from '@nbr/shared';
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
import { cn } from '@/lib/cn';
import { formatDate, formatRelative, humanise } from '@/lib/format';
import { ICON_STROKE, Icons } from '@/lib/icons';
import { queryKeys } from '@/lib/query-client';
import type { Lookups, TaskRow } from '../types';
import { useAutoOpen } from '@/hooks/useAutoOpen';

/** W-16 Tasks & follow-ups on the profile (§15, M-10). */
export function TasksTab({
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
  const [addOpen, setAddOpen] = useState(false);

  useAutoOpen(autoOpen, { task: () => setAddOpen(true) }, onAutoOpened);

  const { data: tasks, isLoading } = useQuery({
    queryKey: queryKeys.tasks(applicantId),
    queryFn: ({ signal }) =>
      api.get<TaskRow[]>('/tasks', { scope: 'applicant', applicantId }, signal),
  });

  const { data: lookups } = useQuery({
    queryKey: ['lookups'],
    queryFn: ({ signal }) => api.get<Lookups>('/lookups', undefined, signal),
    staleTime: 10 * 60_000,
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.tasks(applicantId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
  }

  const toggleMutation = useMutation({
    mutationFn: (task: TaskRow) =>
      api.put(`/tasks/${task.id}`, {
        status: task.status === TASK_STATUS.COMPLETED ? TASK_STATUS.PENDING : TASK_STATUS.COMPLETED,
      }),
    onSuccess: invalidate,
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not update the task'),
  });

  if (isLoading) return <div className="skeleton h-32" />;

  return (
    <div className="space-y-4">
      <CardHeader
        title="Tasks & follow-ups"
        subtitle="Reminders attached to this applicant."
        icon={Icons.ClipboardCheck}
        action={
          can('tasks:create') ? (
            <Button size="sm" variant="primary" icon={Icons.Plus} onClick={() => setAddOpen(true)}>
              Add task
            </Button>
          ) : null
        }
      />

      {(tasks?.length ?? 0) === 0 ? (
        <EmptyState
          icon={Icons.ClipboardCheck}
          title="No tasks yet"
          description="Add a follow-up so the next step doesn't depend on someone remembering."
        />
      ) : (
        <ul className="space-y-1.5">
          {tasks?.map((task) => {
            const done = task.status === TASK_STATUS.COMPLETED;
            return (
              <li
                key={task.id}
                className={cn(
                  'flex items-start gap-2.5 rounded-lg border p-2.5 transition-colors',
                  done
                    ? 'border-line bg-canvas opacity-60'
                    : task.overdue
                      ? 'border-danger-ring bg-danger-tint/40'
                      : 'border-line',
                )}
              >
                <button
                  type="button"
                  onClick={() => toggleMutation.mutate(task)}
                  aria-label={done ? 'Mark as pending' : 'Mark as complete'}
                  className={cn(
                    'mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border transition-colors',
                    done ? 'border-ok bg-ok text-white' : 'border-ink-4 hover:border-brand',
                  )}
                >
                  {done ? <Icons.Check size={10} strokeWidth={3} /> : null}
                </button>

                <div className="min-w-0 flex-1">
                  <p className={cn('text-xs font-medium', done ? 'text-ink-3 line-through' : 'text-ink')}>
                    {task.title}
                  </p>
                  {task.description ? (
                    <p className="text-[10px] text-ink-3">{task.description}</p>
                  ) : null}
                  <p className="text-[10px] text-ink-3">
                    {task.assignedToName} ·{' '}
                    {done
                      ? `completed ${formatRelative(task.completedAt)}`
                      : `${task.overdue ? 'overdue — was due' : 'due'} ${formatDate(task.dueDate)}`}
                  </p>
                </div>

                {task.priority !== TASK_PRIORITY.NORMAL && !done ? (
                  <Chip tone={task.priority === 'urgent' ? 'red' : 'orange'}>{task.priority}</Chip>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {addOpen ? (
        <AddTaskDialog
          applicantId={applicantId}
          recordId={recordId}
          staff={lookups?.staff ?? []}
          onClose={() => setAddOpen(false)}
          onSaved={invalidate}
        />
      ) : null}
    </div>
  );
}

function AddTaskDialog({
  applicantId,
  recordId,
  staff,
  onClose,
  onSaved,
}: {
  applicantId: string;
  recordId?: string;
  staff: Lookups['staff'];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignedToUserId, setAssignedToUserId] = useState(user?.id ?? '');
  const [dueDate, setDueDate] = useState(() => {
    const tomorrow = new Date(Date.now() + 86_400_000);
    return tomorrow.toISOString().slice(0, 10);
  });
  const [priority, setPriority] = useState<string>(TASK_PRIORITY.NORMAL);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.post('/tasks', {
        applicantId,
        recordId,
        title,
        description: description || undefined,
        assignedToUserId,
        dueDate,
        priority,
      }),
    onSuccess: () => {
      toast.success('Task created');
      onClose();
      onSaved();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not create the task'),
  });

  return (
    <Dialog
      open
      onOpenChange={onClose}
      title="Add task"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={saveMutation.isPending}
            disabled={!title.trim() || !assignedToUserId || !dueDate}
            onClick={() => saveMutation.mutate()}
          >
            Create task
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          label="Task"
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          autoFocus
          placeholder="e.g. Call about the dispatch address"
        />
        <Textarea
          label="Details"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={2}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Assign to"
            required
            value={assignedToUserId}
            onChange={(event) => setAssignedToUserId(event.target.value)}
            options={staff.map((member) => ({
              value: member.id,
              label: `${member.fullName} — ${member.roleName}`,
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
          <Input
            label="Due date"
            type="date"
            required
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
            containerClassName="sm:col-span-2"
          />
        </div>
      </div>
    </Dialog>
  );
}
