import { TASK_PRIORITY, TASK_STATUS } from '@nbr/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/AppShell';
import { Chip } from '@/components/ui/Badge';
import { Card, EmptyState, QueryError } from '@/components/ui/Card';
import { api, ApiError } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { formatDate, formatRelative } from '@/lib/format';
import { Icons } from '@/lib/icons';
import type { TaskRow } from '@/routes/applicants/types';

const FILTERS = [
  { key: 'mine', label: 'My tasks', scope: 'mine' as const },
  { key: 'overdue', label: 'Overdue', scope: 'all' as const, overdueOnly: true },
  { key: 'all', label: 'Everyone', scope: 'all' as const },
];

/**
 * W-24 Global task board (§15).
 *
 * Defaults to "my tasks" — an unfiltered board across a twenty-person team is
 * noise to every individual on it.
 */
export default function TasksBoardPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState(FILTERS[0]!);

  const { data: counts } = useQuery({
    queryKey: ['tasks', 'counts'],
    queryFn: ({ signal }) =>
      api.get<{ mine: number; overdue: number; dueToday: number; all: number }>(
        '/tasks/counts',
        undefined,
        signal,
      ),
  });

  const { data: tasks, isLoading, isError, refetch } = useQuery({
    queryKey: ['tasks', 'board', filter.key],
    queryFn: ({ signal }) =>
      api.get<TaskRow[]>(
        '/tasks',
        { scope: filter.scope, overdueOnly: filter.overdueOnly ? 'true' : undefined },
        signal,
      ),
  });

  const toggleMutation = useMutation({
    mutationFn: (task: TaskRow) =>
      api.put(`/tasks/${task.id}`, {
        status: task.status === TASK_STATUS.COMPLETED ? TASK_STATUS.PENDING : TASK_STATUS.COMPLETED,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not update the task'),
  });

  const pending = tasks?.filter((task) => task.status === TASK_STATUS.PENDING) ?? [];
  const done = tasks?.filter((task) => task.status === TASK_STATUS.COMPLETED) ?? [];

  return (
    <div className="p-4 sm:p-5">
      <PageHeader
        title="Tasks & follow-ups"
        subtitle="Everything waiting on someone, nearest deadline first."
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map((option) => {
          const count =
            option.key === 'mine'
              ? counts?.mine
              : option.key === 'overdue'
                ? counts?.overdue
                : counts?.all;

          return (
            <button
              key={option.key}
              type="button"
              onClick={() => setFilter(option)}
              aria-pressed={filter.key === option.key}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                filter.key === option.key
                  ? 'border-brand bg-brand text-white'
                  : 'border-line bg-white text-ink-2 hover:bg-canvas',
              )}
            >
              {option.label}
              {count !== undefined ? (
                <span
                  className={cn(
                    'tabular rounded-full px-1.5 text-[10px] font-bold',
                    filter.key === option.key
                      ? 'bg-white/20'
                      : option.key === 'overdue' && count > 0
                        ? 'bg-danger-tint text-danger'
                        : 'bg-slate2-tint text-ink-2',
                  )}
                >
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {isError ? (
        <Card>
          <QueryError title="Couldn't load tasks" onRetry={() => void refetch()} />
        </Card>
      ) : isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="skeleton h-16" />
          ))}
        </div>
      ) : pending.length === 0 && done.length === 0 ? (
        <Card>
          <EmptyState
            icon={Icons.CheckCircle2}
            title="Nothing outstanding"
            description="No open tasks in this view."
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {pending.length > 0 ? (
            <div className="space-y-1.5">
              {pending.map((task) => (
                <TaskCard key={task.id} task={task} onToggle={() => toggleMutation.mutate(task)} />
              ))}
            </div>
          ) : null}

          {done.length > 0 ? (
            <details className="rounded-card border border-line bg-white">
              <summary className="cursor-pointer px-4 py-2.5 text-xs font-semibold text-ink-2">
                Completed ({done.length})
              </summary>
              <div className="space-y-1.5 border-t border-line p-2">
                {done.map((task) => (
                  <TaskCard key={task.id} task={task} onToggle={() => toggleMutation.mutate(task)} />
                ))}
              </div>
            </details>
          ) : null}
        </div>
      )}
    </div>
  );
}

function TaskCard({ task, onToggle }: { task: TaskRow; onToggle: () => void }) {
  const done = task.status === TASK_STATUS.COMPLETED;

  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-card border bg-white p-3 shadow-card transition-colors',
        done
          ? 'border-line opacity-60'
          : task.overdue
            ? 'border-danger-ring bg-danger-tint/40'
            : 'border-line',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-label={done ? 'Reopen task' : 'Mark complete'}
        className={cn(
          'mt-0.5 grid h-4.5 w-4.5 shrink-0 place-items-center rounded border transition-colors',
          done ? 'border-ok bg-ok text-white' : 'border-ink-4 hover:border-brand',
        )}
        style={{ height: 18, width: 18 }}
      >
        {done ? <Icons.Check size={11} strokeWidth={3} /> : null}
      </button>

      <div className="min-w-0 flex-1">
        <p className={cn('text-sm font-medium', done ? 'text-ink-3 line-through' : 'text-ink')}>
          {task.title}
        </p>
        {task.description ? <p className="text-xs text-ink-3">{task.description}</p> : null}

        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-ink-3">
          <span className="flex items-center gap-1">
            <Icons.User size={10} strokeWidth={2} />
            {task.assignedToName}
          </span>
          <span
            className={cn('flex items-center gap-1', task.overdue && !done ? 'font-semibold text-danger' : '')}
          >
            <Icons.CalendarClock size={10} strokeWidth={2} />
            {done
              ? `completed ${formatRelative(task.completedAt)}`
              : `${task.overdue ? 'overdue — was due' : 'due'} ${formatDate(task.dueDate)}`}
          </span>
          {task.applicantId ? (
            <Link
              to={`/applicants/${task.applicantId}`}
              className="flex items-center gap-1 font-medium text-brand hover:underline"
            >
              <Icons.Users size={10} strokeWidth={2} />
              {task.applicantName}
            </Link>
          ) : null}
        </div>
      </div>

      {task.priority !== TASK_PRIORITY.NORMAL && !done ? (
        <Chip tone={task.priority === 'urgent' ? 'red' : 'orange'}>{task.priority}</Chip>
      ) : null}
    </div>
  );
}
