import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Select, Textarea } from '@/components/ui/Field';
import { api, ApiError } from '@/lib/api-client';
import { ICON_STROKE, Icons } from '@/lib/icons';
import { queryKeys } from '@/lib/query-client';
import type { AvailableTransition } from '../types';

/**
 * Move a record to another stage.
 *
 * Lives on its own because two places offer it — the Next Steps panel and the
 * status badge in the profile header — and a stage change carries permission
 * checks, data guards, a required remark on some steps and an audited override
 * on others. Two implementations of that would drift, and the one that drifted
 * would be the one quietly letting somebody past a guard.
 *
 * Only transitions the server says are legal from here are offered. That is not
 * a UI courtesy: `changeStatus` refuses any move that is not in the workflow
 * table, so a dropdown of all seventeen statuses would be a list of mostly
 * errors.
 */
export function ChangeStageDialog({
  recordId,
  applicantId,
  currentLabel,
  transitions,
  initialTarget,
  open,
  onOpenChange,
}: {
  recordId: string;
  applicantId: string;
  currentLabel: string;
  transitions: readonly AvailableTransition[];
  /** Pre-selected stage, when the caller already knows which one was chosen. */
  initialTarget?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const available = transitions.filter((transition) => transition.available);

  const [targetStatus, setTargetStatus] = useState(initialTarget ?? available[0]?.to ?? '');
  const [remark, setRemark] = useState('');

  const selected = transitions.find((transition) => transition.to === targetStatus);

  const changeStatus = useMutation({
    mutationFn: (payload: { toStatus: string; remark?: string }) =>
      api.post<{ status: string }>(`/records/${recordId}/status`, payload),
    onSuccess: () => {
      toast.success('Status updated', { description: 'The change is on the timeline.' });
      onOpenChange(false);
      setRemark('');
      // The change ripples into the header, the tabs, the timeline and the
      // panel itself — invalidate all of it rather than patching pieces.
      void queryClient.invalidateQueries({ queryKey: queryKeys.applicant(applicantId) });
      // One prefix: the action panel, timeline and client-progress badge all
      // hang off it, so none of them can be left stale.
      void queryClient.invalidateQueries({ queryKey: queryKeys.record(recordId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        // Guard failures are the interesting case: the message explains exactly
        // what is missing ("upload evidence first").
        toast.error(
          error.code === 'GUARD_NOT_SATISFIED'
            ? 'Not ready for this step'
            : 'Could not change status',
          { description: error.message },
        );
      } else {
        toast.error('Could not change status');
      }
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Change stage"
      description="Only valid next steps are shown. The change is recorded on the timeline."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={changeStatus.isPending}
            disabled={!targetStatus || (selected?.requiresRemark && !remark.trim())}
            onClick={() =>
              changeStatus.mutate({ toStatus: targetStatus, remark: remark || undefined })
            }
          >
            Update stage
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2 rounded-lg bg-canvas px-3 py-2">
          <span className="text-xs text-ink-3">Current stage</span>
          <span className="text-xs font-semibold text-ink">{currentLabel}</span>
        </div>

        {available.length === 0 ? (
          <p className="flex items-start gap-1.5 rounded-lg bg-slate2-tint p-2.5 text-[11px] text-ink-2">
            <Icons.Info size={13} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0" />
            There is nowhere to move this record from {currentLabel}. Either it is a final stage, or
            every next step is waiting on something — the Next Steps panel lists what.
          </p>
        ) : (
          <Select
            label="Move to"
            value={targetStatus}
            onChange={(event) => setTargetStatus(event.target.value)}
            placeholder="Choose the next step"
            options={available.map((transition) => ({
              value: transition.to,
              label: transition.label,
            }))}
          />
        )}

        {selected?.requiresOverride ? (
          <p className="flex items-start gap-1.5 rounded-lg bg-warn-tint p-2.5 text-[11px] text-warn">
            <Icons.ShieldAlert size={13} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0" />
            This is an Admin override. It is recorded in the audit log with your name.
          </p>
        ) : null}

        <Textarea
          label={selected?.requiresRemark ? 'Remark (required)' : 'Remark'}
          value={remark}
          onChange={(event) => setRemark(event.target.value)}
          required={selected?.requiresRemark}
          rows={3}
          placeholder="Why this change? This goes on the permanent timeline."
          hint="Timeline entries cannot be edited or deleted afterwards."
        />
      </div>
    </Dialog>
  );
}
