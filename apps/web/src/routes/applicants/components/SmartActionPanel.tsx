import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Select, Textarea } from '@/components/ui/Field';
import { api, ApiError } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { formatDate, humanise } from '@/lib/format';
import { ICON_SIZE, ICON_STROKE, iconByName, Icons } from '@/lib/icons';
import { queryKeys } from '@/lib/query-client';
import type { SmartActionPanel as PanelData } from '../types';

const VARIANT_MAP: Record<string, 'primary' | 'secondary' | 'success' | 'danger' | 'whatsapp'> = {
  primary: 'primary',
  secondary: 'secondary',
  success: 'success',
  danger: 'danger',
  whatsapp: 'whatsapp',
};

/**
 * §11 Smart Workflow Engine — the "Next steps" panel.
 *
 * Everything here is computed server-side: which actions exist at this stage,
 * which the caller is permitted to perform, and which transitions are currently
 * blocked by unmet data guards. The client renders the answer rather than
 * deciding it, so two people in different roles see genuinely different panels
 * and neither can invent an action they aren't entitled to.
 */
export function SmartActionPanel({
  recordId,
  applicantId,
  panel,
  isLoading,
  onAction,
}: {
  recordId: string;
  applicantId: string;
  panel?: PanelData;
  isLoading: boolean;
  onAction?: (action: { kind: string; target: string }) => void;
}) {
  const queryClient = useQueryClient();
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [targetStatus, setTargetStatus] = useState('');
  const [remark, setRemark] = useState('');

  const changeStatus = useMutation({
    mutationFn: (payload: { toStatus: string; remark?: string }) =>
      api.post<{ status: string }>(`/records/${recordId}/status`, payload),
    onSuccess: () => {
      toast.success('Status updated', { description: 'The change is on the timeline.' });
      setStatusDialogOpen(false);
      setRemark('');
      // The status change ripples into the header, the tabs, the timeline and
      // the panel itself — invalidate all of it rather than patching pieces.
      void queryClient.invalidateQueries({ queryKey: queryKeys.applicant(applicantId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.recordActions(recordId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.recordTimeline(recordId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        // Guard failures are the interesting case: the message explains
        // exactly what is missing ("upload evidence first").
        toast.error(
          error.code === 'GUARD_NOT_SATISFIED' ? 'Not ready for this step' : 'Could not change status',
          { description: error.message },
        );
      } else {
        toast.error('Could not change status');
      }
    },
  });

  if (isLoading) {
    return (
      <div className="rounded-card border border-line bg-white p-4 shadow-card">
        <div className="skeleton mb-3 h-4 w-32" />
        <div className="flex gap-2">
          <div className="skeleton h-9 w-32" />
          <div className="skeleton h-9 w-28" />
        </div>
      </div>
    );
  }

  if (!panel) return null;

  const selectedTransition = panel.transitions.find((t) => t.to === targetStatus);
  const availableTransitions = panel.transitions.filter((t) => t.available);
  const blockedTransitions = panel.transitions.filter((t) => !t.available);

  return (
    <>
      <div
        className={cn(
          'rounded-card border p-4 shadow-card',
          panel.locked ? 'border-ok-ring bg-ok-tint/40' : 'border-brand-ring bg-brand-tint/50',
        )}
      >
        <div className="mb-3 flex items-center gap-2">
          {panel.locked ? (
            <Icons.Lock size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} className="text-ok" />
          ) : (
            <span className="grid h-5 w-5 place-items-center rounded bg-brand text-white">
              <Icons.PlayCircle size={13} strokeWidth={2.2} />
            </span>
          )}
          <h3 className="text-xs font-bold uppercase tracking-wider text-ink-2">
            {panel.locked ? 'Workflow locked' : `Next steps · ${panel.statusLabel}`}
          </h3>
        </div>

        {/* §11 stage 5 — payment context with days remaining and reminder count */}
        {panel.paymentContext ? (
          <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 rounded-lg border border-line bg-white px-3 py-2">
            <Metric label="Due date" value={formatDate(panel.paymentContext.dueDate)} />
            <Metric
              label="Days remaining"
              value={
                panel.paymentContext.daysRemaining === null
                  ? '—'
                  : panel.paymentContext.overdue
                    ? `${Math.abs(panel.paymentContext.daysRemaining)} overdue`
                    : String(panel.paymentContext.daysRemaining)
              }
              tone={panel.paymentContext.overdue ? 'danger' : undefined}
            />
            <Metric label="Balance" value={`₹${panel.paymentContext.balanceDue}`} />
            <Metric label="Reminders sent" value={String(panel.paymentContext.reminderCount)} />
          </div>
        ) : null}

        {/*
          §Pipeline 4 — has the selection actually gone out?

          The unsent case is the one worth a banner. A record can sit in
          Selection Sent for weeks having been approved and never written to,
          and before this the only way to find out was to open the
          Communication tab and read the history.
        */}
        {panel.selectionContext ? (
          panel.selectionContext.sent ? (
            <div
              className={cn(
                'mb-3 flex gap-2 rounded-lg border px-3 py-2 text-[11px]',
                panel.selectionContext.status === 'failed'
                  ? 'border-danger-ring bg-danger-tint text-ink-2'
                  : 'border-line bg-white text-ink-2',
              )}
            >
              {panel.selectionContext.status === 'failed' ? (
                <Icons.XCircle
                  size={ICON_SIZE.sm}
                  strokeWidth={ICON_STROKE}
                  className="mt-px shrink-0 text-danger"
                />
              ) : (
                <Icons.Mail
                  size={ICON_SIZE.sm}
                  strokeWidth={ICON_STROKE}
                  className="mt-px shrink-0 text-ok"
                />
              )}
              <span>
                {panel.selectionContext.status === 'failed' ? (
                  <>
                    <span className="font-semibold text-danger">
                      The selection letter did not send.
                    </span>{' '}
                    {panel.selectionContext.failureReason ?? 'No reason was recorded.'} Send it
                    again from the Communication tab.
                  </>
                ) : (
                  <>
                    Selection {panel.selectionContext.channel ?? 'letter'}{' '}
                    <span className="font-semibold text-ok">
                      {humanise(panel.selectionContext.status ?? 'sent')}
                    </span>
                    {panel.selectionContext.at ? ` on ${formatDate(panel.selectionContext.at)}` : ''}
                    {panel.selectionContext.by ? ` by ${panel.selectionContext.by}` : ''}.
                  </>
                )}
              </span>
            </div>
          ) : (
            <div className="mb-3 flex gap-2 rounded-lg border border-warn-ring bg-warn-tint px-3 py-2 text-[11px] text-ink-2">
              <Icons.MailWarning
                size={ICON_SIZE.sm}
                strokeWidth={ICON_STROKE}
                className="mt-px shrink-0 text-warn"
              />
              <span>
                <span className="font-semibold text-warn">
                  The applicant has not been told they were selected.
                </span>{' '}
                Send the selection letter below — this stage is not finished until they know.
              </span>
            </div>
          )
        ) : null}

        {panel.actions.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {panel.actions.map((action) => {
              const Icon = iconByName(action.icon);
              return (
                <Button
                  key={action.id}
                  size="sm"
                  variant={VARIANT_MAP[action.variant ?? 'secondary'] ?? 'secondary'}
                  icon={Icon}
                  onClick={() => {
                    if (action.kind === 'transition') {
                      setTargetStatus(action.target);
                      setStatusDialogOpen(true);
                    } else {
                      onAction?.({ kind: action.kind, target: action.target });
                    }
                  }}
                >
                  {action.label}
                </Button>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-ink-3">
            {panel.locked
              ? 'This record is complete. The profile stays available for reference and the certificate can be re-downloaded.'
              : 'No actions available to your role at this stage.'}
          </p>
        )}

        {/* Blocked transitions are shown, not hidden — telling someone *why*
            they can't proceed is more useful than an absent button. */}
        {blockedTransitions.length > 0 ? (
          <div className="mt-3 space-y-1 border-t border-black/5 pt-3">
            {blockedTransitions.map((transition) => (
              <p key={transition.to} className="flex items-start gap-1.5 text-[11px] text-ink-3">
                <Icons.Lock size={12} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0" />
                <span>
                  <span className="font-medium">{transition.label}</span> — {transition.blockedReason}
                </span>
              </p>
            ))}
          </div>
        ) : null}

        {availableTransitions.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              setTargetStatus(availableTransitions[0]?.to ?? '');
              setStatusDialogOpen(true);
            }}
            className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-brand hover:underline"
          >
            <Icons.RotateCcw size={12} strokeWidth={ICON_STROKE} />
            Change status manually
          </button>
        ) : null}
      </div>

      {/* M-01 Change Status — only legal next steps appear */}
      <Dialog
        open={statusDialogOpen}
        onOpenChange={setStatusDialogOpen}
        title="Change status"
        description="Only valid next steps are shown. The change is recorded on the timeline."
        footer={
          <>
            <Button variant="ghost" onClick={() => setStatusDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={changeStatus.isPending}
              disabled={!targetStatus || (selectedTransition?.requiresRemark && !remark.trim())}
              onClick={() => changeStatus.mutate({ toStatus: targetStatus, remark: remark || undefined })}
            >
              Update status
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-lg bg-canvas px-3 py-2">
            <span className="text-xs text-ink-3">Current status</span>
            <span className="text-xs font-semibold text-ink">{panel.statusLabel}</span>
          </div>

          <Select
            label="Move to"
            value={targetStatus}
            onChange={(event) => setTargetStatus(event.target.value)}
            placeholder="Choose the next step"
            options={availableTransitions.map((transition) => ({
              value: transition.to,
              label: transition.label,
            }))}
          />

          {selectedTransition?.requiresOverride ? (
            <p className="flex items-start gap-1.5 rounded-lg bg-warn-tint p-2.5 text-[11px] text-warn">
              <Icons.ShieldAlert size={13} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0" />
              This is an Admin override. It is recorded in the audit log with your name.
            </p>
          ) : null}

          <Textarea
            label={selectedTransition?.requiresRemark ? 'Remark (required)' : 'Remark'}
            value={remark}
            onChange={(event) => setRemark(event.target.value)}
            required={selectedTransition?.requiresRemark}
            rows={3}
            placeholder="Why this change? This goes on the permanent timeline."
            hint="Timeline entries cannot be edited or deleted afterwards."
          />
        </div>
      </Dialog>
    </>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'danger';
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-ink-3">{label}</p>
      <p className={cn('tabular text-xs font-semibold', tone === 'danger' ? 'text-danger' : 'text-ink')}>
        {value}
      </p>
    </div>
  );
}
