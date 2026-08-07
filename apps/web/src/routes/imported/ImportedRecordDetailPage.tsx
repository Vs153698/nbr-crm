import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/AppShell';
import { Chip } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, DetailRow, EmptyState, QueryError } from '@/components/ui/Card';
import { useAuth } from '@/hooks/useAuth';
import { ApiError, api } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { formatDate, formatDateTime, formatRelative } from '@/lib/format';
import { ICON_SIZE, ICON_STROKE, Icons } from '@/lib/icons';
import { queryKeys } from '@/lib/query-client';
import { ACTIVITY_META, ActivityDialog } from './ActivityDialog';
import type { ActivityKind, ImportedActivity, ImportedRecordDetail } from './types';

/**
 * One imported record, its details, and the follow-up logged against it.
 *
 * There is no status to advance and no queue to move through — the website owns
 * this record's lifecycle. Everything actionable on this page is contact
 * history, which is why the activity log gets the wider column.
 */
export default function ImportedRecordDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const [dialog, setDialog] = useState<ActivityKind | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.importedRecord(id),
    queryFn: ({ signal }) => api.get<ImportedRecordDetail>(`/imported-records/${id}`, {}, signal),
    enabled: Boolean(id),
  });

  if (isLoading) {
    return (
      <div className="grid min-h-[50vh] place-items-center">
        <Icons.Loader2 size={22} className="animate-spin text-brand" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="p-4 sm:p-5">
        <QueryError
          title="Couldn't load this record"
          description="It may have been removed, or the server did not respond."
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  // Each action answers to the permission that already means that thing, so an
  // Admin who can email an applicant can email a certificate holder too.
  const canSend = can('communications:send');
  const canNote = can('notes:create');
  const canTask = can('tasks:create');
  const canAct = canSend || canNote || canTask;

  return (
    <div className="p-4 sm:p-5">
      <PageHeader
        back={{ to: '/imported-records', label: 'Imported Records' }}
        title={data.holderName}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="tabular">{data.certificateNumber}</span>
            {data.category ? <span>· {data.category}</span> : null}
            <span>· Issued {formatDate(data.issuedAt)}</span>
          </span>
        }
        actions={
          <>
            {canSend ? (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={Icons.Mail}
                  onClick={() => setDialog('email')}
                >
                  Email
                </Button>
                <Button
                  variant="whatsapp"
                  size="sm"
                  icon={Icons.MessageCircle}
                  onClick={() => setDialog('whatsapp')}
                >
                  WhatsApp
                </Button>
              </>
            ) : null}
            {canNote ? (
              <Button
                variant="secondary"
                size="sm"
                icon={Icons.StickyNote}
                onClick={() => setDialog('note')}
              >
                Note
              </Button>
            ) : null}
            {canTask ? (
              <Button
                variant="secondary"
                size="sm"
                icon={Icons.ClipboardCheck}
                onClick={() => setDialog('task')}
              >
                Task
              </Button>
            ) : null}
          </>
        }
      />

      {data.revoked ? (
        <div className="mb-4 flex items-start gap-2.5 rounded-card border border-danger/30 bg-danger-tint px-4 py-3">
          <Icons.Ban size={ICON_SIZE.md} strokeWidth={2} className="mt-px shrink-0 text-danger" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-danger">This certificate is revoked</p>
            <p className="mt-0.5 text-xs text-ink-2">
              {data.revokeReason ?? 'No reason was recorded on the website.'}
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Activity gets the wide column — it is the only part of this page an
            operator can actually change. */}
        <div className="lg:col-span-2">
          <ActivityLog
            activity={data.activity}
            canAct={canAct}
            canCompleteTasks={canTask}
            recordId={data.id}
          />
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Record" icon={Icons.Award} />
            <dl className="divide-y divide-line">
              <DetailRow label="Title" value={<span className="text-left">{data.recordTitle}</span>} />
              <DetailRow label="Category" value={data.category ?? '—'} />
              <DetailRow label="Certificate" value={<span className="tabular">{data.certificateNumber}</span>} />
              <DetailRow label="Issued" value={formatDate(data.issuedAt)} />
              <DetailRow
                label="Achieved"
                value={data.achievementDate ? formatDate(data.achievementDate) : '—'}
              />
              <DetailRow
                label="Published"
                value={
                  data.revoked ? (
                    <Chip tone="red">Revoked</Chip>
                  ) : data.isPublished ? (
                    <Chip tone="green">Published</Chip>
                  ) : (
                    <Chip tone="slate">Unpublished</Chip>
                  )
                }
              />
            </dl>
          </Card>

          <Card>
            <CardHeader title="Holder" icon={Icons.User} />
            <dl className="divide-y divide-line">
              <DetailRow label="Name" value={data.holderName} />
              <DetailRow
                label="Email"
                value={
                  data.email ? (
                    <a href={`mailto:${data.email}`} className="text-brand hover:underline">
                      {data.email}
                    </a>
                  ) : (
                    <span className="text-ink-4">Not on record</span>
                  )
                }
              />
              <DetailRow
                label="Phone"
                value={
                  data.phone ? (
                    <a href={`tel:${data.phone}`} className="tabular text-brand hover:underline">
                      {data.phone}
                    </a>
                  ) : (
                    <span className="text-ink-4">Not on record</span>
                  )
                }
              />
              <DetailRow label="Location" value={data.location ?? '—'} />
            </dl>

            {data.bio ? (
              <p className="mt-3 border-t border-line pt-3 text-xs leading-relaxed text-ink-2">
                {data.bio}
              </p>
            ) : null}
          </Card>

          <Card>
            <CardHeader
              title="On the website"
              icon={Icons.Globe}
              subtitle={`Last synced ${formatRelative(data.syncedAt)}`}
            />
            <div className="flex flex-col gap-2">
              {data.verifyUrl ? (
                <ExternalRow href={data.verifyUrl} label="Public verification page" />
              ) : null}
              {data.awardeeUrl ? (
                <ExternalRow href={data.awardeeUrl} label="Awardee profile" />
              ) : null}
              {!data.verifyUrl && !data.awardeeUrl ? (
                <p className="text-xs text-ink-3">No public pages recorded for this certificate.</p>
              ) : null}
            </div>
            <p className="mt-3 border-t border-line pt-3 text-2xs leading-relaxed text-ink-3">
              The website owns this record. Corrections to the name, title or contact details are
              made there, then picked up by the next sync.
            </p>
          </Card>
        </div>
      </div>

      {dialog ? (
        <ActivityDialog
          kind={dialog}
          record={data}
          open
          onOpenChange={(next) => {
            if (!next) setDialog(null);
          }}
        />
      ) : null}
    </div>
  );
}

function ExternalRow({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-xs text-ink-2 transition-colors hover:border-brand-ring hover:bg-brand-tint/40"
    >
      <span className="truncate">{label}</span>
      <Icons.ExternalLink
        size={ICON_SIZE.sm}
        strokeWidth={ICON_STROKE}
        className="shrink-0 text-ink-3 transition-colors group-hover:text-brand"
      />
    </a>
  );
}

/** Newest first — the same order every other history panel in the CRM uses. */
function ActivityLog({
  activity,
  canAct,
  canCompleteTasks,
  recordId,
}: {
  activity: ImportedActivity[];
  canAct: boolean;
  canCompleteTasks: boolean;
  recordId: string;
}) {
  const queryClient = useQueryClient();

  const complete = useMutation({
    mutationFn: (activityId: string) =>
      api.post<{ completed: boolean }>(`/imported-records/activity/${activityId}/complete`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.importedRecord(recordId) });
      toast.success('Task completed');
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not complete the task'),
  });

  return (
    <Card padded={false}>
      <div className="border-b border-line px-4 py-3">
        <CardHeader
          className="mb-0"
          title="Activity"
          icon={Icons.History}
          subtitle={
            activity.length === 0
              ? 'Nothing logged yet'
              : `${activity.length} entr${activity.length === 1 ? 'y' : 'ies'}`
          }
        />
      </div>

      {activity.length === 0 ? (
        <EmptyState
          icon={Icons.Inbox}
          title="No follow-up yet"
          description={
            canAct
              ? 'Emails, WhatsApp messages, notes and tasks logged against this record appear here.'
              : 'Nobody has contacted this holder through the CRM.'
          }
        />
      ) : (
        <ul className="divide-y divide-line">
          {activity.map((entry) => (
            <ActivityRow
              key={entry.id}
              entry={entry}
              canCompleteTasks={canCompleteTasks}
              onComplete={() => complete.mutate(entry.id)}
              completing={complete.isPending && complete.variables === entry.id}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

function ActivityRow({
  entry,
  canCompleteTasks,
  onComplete,
  completing,
}: {
  entry: ImportedActivity;
  canCompleteTasks: boolean;
  onComplete: () => void;
  completing: boolean;
}) {
  const meta = ACTIVITY_META[entry.kind];
  const Icon = meta?.icon ?? Icons.Info;
  const overdue =
    entry.kind === 'task' && !entry.completedAt && entry.dueAt && new Date(entry.dueAt) < new Date();

  return (
    <li className="flex gap-3 px-4 py-3">
      <span
        className={cn(
          'mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md',
          entry.status === 'failed'
            ? 'bg-danger-tint text-danger'
            : entry.completedAt
              ? 'bg-ok-tint text-ok'
              : 'bg-slate2-tint text-ink-3',
        )}
      >
        <Icon size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-ink">{LABELS[entry.kind]}</span>

          {entry.status === 'sent' ? <Chip tone="green">Sent</Chip> : null}
          {entry.status === 'failed' ? <Chip tone="red">Failed</Chip> : null}
          {entry.completedAt ? <Chip tone="green">Done</Chip> : null}
          {overdue ? <Chip tone="orange">Overdue</Chip> : null}

          <span className="ml-auto whitespace-nowrap text-2xs text-ink-3">
            {formatRelative(entry.createdAt)}
          </span>
        </div>

        {entry.subject ? (
          <p className="mt-1 truncate text-xs font-medium text-ink-2">{entry.subject}</p>
        ) : null}

        <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-ink-2">
          {entry.body}
        </p>

        {entry.error ? (
          <p className="mt-1.5 text-2xs text-danger">{entry.error}</p>
        ) : null}

        {entry.dueAt ? (
          <p className="mt-1.5 flex items-center gap-1 text-2xs text-ink-3">
            <Icons.CalendarClock size={12} strokeWidth={ICON_STROKE} />
            Due {formatDateTime(entry.dueAt)}
          </p>
        ) : null}

        {entry.kind === 'task' && !entry.completedAt && canCompleteTasks ? (
          <Button
            variant="ghost"
            size="sm"
            icon={Icons.Check}
            className="mt-1.5 -ml-3"
            loading={completing}
            onClick={onComplete}
          >
            Mark complete
          </Button>
        ) : null}
      </div>
    </li>
  );
}

const LABELS: Record<ActivityKind, string> = {
  email: 'Email',
  whatsapp: 'WhatsApp',
  note: 'Note',
  task: 'Task',
};
