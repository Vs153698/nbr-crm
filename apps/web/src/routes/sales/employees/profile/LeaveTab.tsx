import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  LEAVE_STATUS,
  LEAVE_STATUS_META,
  LEAVE_TYPE_LABELS,
  type LeaveStatus,
  type LeaveType,
} from '@nbr/shared';
import { Chip } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, QueryError } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Textarea } from '@/components/ui/Field';
import { useAuth } from '@/hooks/useAuth';
import { api, ApiError } from '@/lib/api-client';
import { formatDate, formatDateTime } from '@/lib/format';
import { Icons } from '@/lib/icons';
import { ApplyLeaveDialog } from './ApplyLeaveDialog';
import { Metric, Section } from './shared';
import { employeeKeys, type LeaveList, type LeaveRequest } from '../types';

/**
 * The leave record: what has been requested, what was decided, what is left.
 *
 * Approving writes the days into the attendance register, which is what keeps
 * leave and attendance from disagreeing and lets payroll read one number. That
 * happens on the server; this screen only carries the decision.
 */
export function LeaveTab({ employeeId }: { employeeId: string }) {
  const { can } = useAuth();
  const canDecide = can('employees:edit');

  const [applyOpen, setApplyOpen] = useState(false);
  const [deciding, setDeciding] = useState<{ request: LeaveRequest; status: LeaveStatus } | null>(
    null,
  );

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: employeeKeys.leave(employeeId),
    queryFn: ({ signal }) => api.get<LeaveList>(`/employees/${employeeId}/leave`, undefined, signal),
  });

  return (
    <div className="space-y-4">
      {isError ? (
        <Card>
          <QueryError title="Couldn't load the leave record" onRetry={() => void refetch()} />
        </Card>
      ) : isLoading || !data ? (
        <div className="skeleton h-64" />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric
              label={`Taken in ${data.summary.year}`}
              value={data.summary.takenTotal}
              icon={Icons.CalendarDays}
              tone="blue"
            />
            <Metric
              label="Pending decisions"
              value={data.summary.pending}
              icon={Icons.Clock}
              tone={data.summary.pending > 0 ? 'orange' : 'slate'}
            />
            <Metric label="Requests on record" value={data.requests.length} icon={Icons.ListChecks} tone="slate" />
            <div className="rounded-lg border border-line bg-white p-3">
              <span className="text-[11px] uppercase tracking-wide text-ink-3">By type</span>
              {Object.keys(data.summary.takenByType).length === 0 ? (
                <p className="mt-1 text-sm text-ink-4">None taken</p>
              ) : (
                <ul className="mt-1 space-y-0.5">
                  {Object.entries(data.summary.takenByType).map(([type, days]) => (
                    <li key={type} className="flex justify-between gap-2 text-[11px]">
                      <span className="truncate text-ink-3">
                        {LEAVE_TYPE_LABELS[type as LeaveType] ?? type}
                      </span>
                      <span className="tabular font-semibold text-ink">{days}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <Section
            title="Leave requests"
            icon={Icons.CalendarPlus}
            action={
              canDecide ? (
                <Button size="sm" variant="primary" icon={Icons.Plus} onClick={() => setApplyOpen(true)}>
                  Apply leave
                </Button>
              ) : null
            }
          >
            {data.requests.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-3">No leave has been requested yet.</p>
            ) : (
              <ul className="space-y-2">
                {data.requests.map((request) => {
                  const meta = LEAVE_STATUS_META[request.status as LeaveStatus];
                  return (
                    <li key={request.id} className="rounded-lg border border-line p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-ink">
                              {LEAVE_TYPE_LABELS[request.leaveType as LeaveType] ?? request.leaveType}
                            </span>
                            <Chip tone={meta?.tone ?? 'slate'}>{meta?.label ?? request.status}</Chip>
                            <span className="tabular text-xs text-ink-3">
                              {request.days} {Number(request.days) === 1 ? 'day' : 'days'}
                            </span>
                          </div>
                          <p className="tabular mt-0.5 text-xs text-ink-2">
                            {formatDate(request.fromDate)} → {formatDate(request.toDate)}
                          </p>
                          <p className="mt-1 text-xs text-ink-2">{request.reason}</p>
                          <p className="mt-1 text-[11px] text-ink-3">
                            Applied by {request.appliedByName ?? 'unknown'} ·{' '}
                            {formatDateTime(request.createdAt)}
                          </p>
                          {request.decidedAt ? (
                            <p className="mt-0.5 text-[11px] text-ink-3">
                              {meta?.label ?? request.status} by {request.decidedByName ?? 'unknown'} ·{' '}
                              {formatDateTime(request.decidedAt)}
                              {request.decisionNote ? ` — ${request.decisionNote}` : ''}
                            </p>
                          ) : null}
                        </div>

                        {canDecide && request.status === LEAVE_STATUS.PENDING ? (
                          <div className="flex shrink-0 gap-2">
                            <Button
                              size="sm"
                              variant="success"
                              icon={Icons.Check}
                              onClick={() => setDeciding({ request, status: LEAVE_STATUS.APPROVED })}
                            >
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              icon={Icons.XCircle}
                              onClick={() => setDeciding({ request, status: LEAVE_STATUS.REJECTED })}
                            >
                              Reject
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        </>
      )}

      {applyOpen ? <ApplyLeaveDialog employeeId={employeeId} onClose={() => setApplyOpen(false)} /> : null}

      {deciding ? (
        <DecideLeaveDialog
          employeeId={employeeId}
          request={deciding.request}
          status={deciding.status}
          onClose={() => setDeciding(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * Approve or reject one request.
 *
 * A rejection needs a note — "why not?" is the only question a refusal raises,
 * and the server refuses one without it.
 */
function DecideLeaveDialog({
  employeeId,
  request,
  status,
  onClose,
}: {
  employeeId: string;
  request: LeaveRequest;
  status: LeaveStatus;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const rejecting = status === LEAVE_STATUS.REJECTED;

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/employees/${employeeId}/leave/${request.id}/decide`, {
        status,
        decisionNote: note.trim() || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['employee', employeeId] });
      toast.success(rejecting ? 'Leave rejected' : 'Leave approved', {
        description: rejecting
          ? undefined
          : 'The days have been written into the attendance register.',
      });
      onClose();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not record the decision'),
  });

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={rejecting ? 'Reject leave request' : 'Approve leave request'}
      description={`${formatDate(request.fromDate)} → ${formatDate(request.toDate)} · ${request.days} days`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            variant={rejecting ? 'danger' : 'success'}
            loading={mutation.isPending}
            disabled={rejecting && note.trim().length === 0}
            onClick={() => mutation.mutate()}
          >
            {rejecting ? 'Reject' : 'Approve'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {!rejecting ? (
          <p className="text-xs text-ink-3">
            Approving writes each day into the attendance register as leave, so payroll and
            attendance agree.
          </p>
        ) : null}
        <Textarea
          label={rejecting ? 'Reason for rejection' : 'Note'}
          required={rejecting}
          rows={3}
          value={note}
          maxLength={1000}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
    </Dialog>
  );
}
