import * as Popover from '@radix-ui/react-popover';
import { type ClientProgress, type ClientProgressStageState } from '@nbr/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input, Textarea } from '@/components/ui/Field';
import { useAuth } from '@/hooks/useAuth';
import { api, ApiError } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-client';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/format';
import { ICON_SIZE, ICON_STROKE, Icons } from '@/lib/icons';

/**
 * The client's eleven-stage progress, as one badge.
 *
 * Deliberately *not* a second stepper. The record already has its own workflow
 * rail and that is untouched; this is a single chip reporting the furthest
 * milestone genuinely reached, in the client's vocabulary — Submitted through
 * Photo Uploaded — with the detail behind a click for anyone who wants it.
 *
 * The badge shows what has *happened*, not where the record sits. Those come
 * apart constantly, and the difference is the whole point: a record parked at
 * Dispatch Pending has been approved, paid for and certified, while one showing
 * Fees Received may never have been sent a reminder because it was paid before
 * anyone chased it. Nothing here is inferred from position — every tick is a
 * dated fact from the timeline, the ledger, the certificate sign-off, the
 * courier row or the evidence vault.
 */
export function ClientProgressBadge({
  recordId,
  applicantId,
}: {
  recordId: string;
  applicantId: string;
}) {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  /*
    Its own permission, not `records:edit`. Everything else on this badge is
    derived from what the system saw; this is the one way a person can assert a
    milestone it never witnessed, and it is shown to the client — so it is
    granted deliberately rather than as a side effect of being able to edit.
  */
  const canMark = can('records:mark_progress');

  /** The stage whose "mark as done" form is open, or null. */
  const [marking, setMarking] = useState<ClientProgressStageState | null>(null);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.record(recordId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.applicant(applicantId) });
  };

  const clearMark = useMutation({
    mutationFn: (stage: string) => api.delete(`/records/${recordId}/client-progress/${stage}`),
    onSuccess: () => {
      toast.success('Mark withdrawn', { description: 'The stage reports what the system sees.' });
      invalidate();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not withdraw the mark'),
  });

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.clientProgress(recordId),
    queryFn: ({ signal }) =>
      api.get<ClientProgress>(`/records/${recordId}/client-progress`, undefined, signal),
    /*
      Short, because every stage the badge reports is something an operator can
      cause from this very page. Anything that moves the record invalidates the
      `records/:id` prefix this key sits under, so the badge refetches at once
      rather than sitting on a stale answer until somebody reloads.
    */
    staleTime: 5_000,
  });

  if (isLoading) return <span className="skeleton h-6 w-40 rounded-full" />;
  if (!data || !data.current) return null;

  // Amber whenever something was passed over. A record can be genuinely
  // further on than a skipped stage suggests, and the badge should say so
  // rather than presenting an unbroken run that did not happen.
  const skipped = data.stages.filter((stage) => stage.skipped);

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          title="Client progress — click for the full eleven stages"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1',
            'text-2xs font-semibold transition-colors',
            skipped.length > 0
              ? 'border-warn-ring bg-warn-tint text-warn hover:bg-warn-tint/70'
              : 'border-line bg-canvas text-ink-2 hover:bg-slate2-tint',
          )}
        >
          <Icons.ListChecks size={12} strokeWidth={ICON_STROKE} className="shrink-0" />
          <span>{data.current.label}</span>
          <span className="tabular font-normal opacity-70">
            {data.completed}/{data.total}
          </span>
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-50 w-[22rem] rounded-panel border border-line bg-white p-3 shadow-modal animate-scale-in"
        >
          <p className="mb-0.5 text-xs font-bold text-ink">Client progress</p>
          <p className="mb-2.5 text-[11px] leading-relaxed text-ink-3">
            Each stage is ticked only when it actually happened. A stage needing an employee stays
            open until they do it — nothing is completed automatically.
          </p>

          <ol className="space-y-0.5">
            {data.stages.map((stage) => (
              <li
                key={stage.code}
                className={cn(
                  'flex items-start gap-2 rounded-md px-1.5 py-1',
                  stage.code === data.current?.code ? 'bg-brand-tint' : '',
                )}
              >
                <span className="mt-px shrink-0">
                  {stage.reached ? (
                    <Icons.CheckCircle2
                      size={ICON_SIZE.sm}
                      strokeWidth={ICON_STROKE}
                      className="text-ok"
                    />
                  ) : stage.skipped ? (
                    // Passed over: the process moved beyond it and it never
                    // happened. Saying so is more use than a blank circle.
                    <Icons.XCircle
                      size={ICON_SIZE.sm}
                      strokeWidth={ICON_STROKE}
                      className="text-warn"
                    />
                  ) : (
                    <Icons.Circle
                      size={ICON_SIZE.sm}
                      strokeWidth={ICON_STROKE}
                      className="text-ink-4"
                    />
                  )}
                </span>

                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'block text-xs',
                      stage.reached ? 'font-medium text-ink' : 'text-ink-3',
                    )}
                  >
                    {stage.step}. {stage.label}
                    {stage.skipped ? (
                      <span className="ml-1.5 text-2xs font-normal text-warn">
                        never happened
                      </span>
                    ) : null}
                  </span>

                  <span className="block text-[10px] leading-snug text-ink-3">
                    {stage.reached ? (
                      <>
                        {formatDate(stage.at)}
                        {/* Provenance, always. A stage somebody typed in is not
                            the same claim as one the system watched happen, and
                            the badge says which it is. */}
                        {stage.source === 'manual' ? (
                          <>
                            {' · '}
                            <span className="font-medium text-warn">marked by hand</span>
                            {stage.mark?.markedByName ? ` by ${stage.mark.markedByName}` : ''}
                            {stage.mark?.note ? ` — ${stage.mark.note}` : ''}
                          </>
                        ) : null}
                      </>
                    ) : (
                      <>
                        {stage.evidence}
                        {stage.needsEmployeeAction ? ' Needs an employee.' : ''}
                      </>
                    )}
                  </span>
                </span>

                {/* The control sits on the stage it affects, so there is no
                    question which one is being recorded. */}
                {canMark && stage.manuallyMarkable ? (
                  <button
                    type="button"
                    onClick={() =>
                      stage.source === 'manual'
                        ? clearMark.mutate(stage.code)
                        : setMarking(stage)
                    }
                    disabled={stage.source === 'derived' && stage.reached}
                    title={
                      stage.source === 'manual'
                        ? 'Withdraw this mark'
                        : stage.reached
                          ? 'The system recorded this itself — it cannot be overridden'
                          : 'Record this stage by hand'
                    }
                    className={cn(
                      'mt-px shrink-0 rounded px-1 py-0.5 text-[10px] font-semibold transition-colors',
                      stage.source === 'manual'
                        ? 'text-warn hover:bg-warn-tint'
                        : 'text-brand hover:bg-brand-tint disabled:invisible',
                    )}
                  >
                    {stage.source === 'manual' ? 'Undo' : 'Mark'}
                  </button>
                ) : null}
              </li>
            ))}
          </ol>

          {canMark ? (
            <p className="mt-2 border-t border-line pt-2 text-[10px] leading-snug text-ink-3">
              Mark a stage only when it really happened and the system could not see it — a photo
              sent over WhatsApp, a delivery confirmed by phone. Fees Received always follows the
              ledger.
            </p>
          ) : null}
        </Popover.Content>
      </Popover.Portal>

      {marking ? (
        <MarkStageDialog
          recordId={recordId}
          stage={marking}
          onClose={() => setMarking(null)}
          onMarked={invalidate}
        />
      ) : null}
    </Popover.Root>
  );
}

/**
 * Record one stage by hand.
 *
 * Asks for the date the thing *happened*, not today: a photo that arrived last
 * Tuesday is marked as last Tuesday, so the badge reports the event's own date
 * rather than the moment somebody got round to typing it.
 */
function MarkStageDialog({
  recordId,
  stage,
  onClose,
  onMarked,
}: {
  recordId: string;
  stage: ClientProgressStageState;
  onClose: () => void;
  onMarked: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [occurredAt, setOccurredAt] = useState(today);
  const [note, setNote] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/records/${recordId}/client-progress/${stage.code}`, {
        occurredAt: new Date(`${occurredAt}T12:00:00`).toISOString(),
        note: note.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success(`${stage.label} marked`, {
        description: 'It shows as hand-marked, with your name against it.',
      });
      onClose();
      onMarked();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not mark the stage'),
  });

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={`Mark "${stage.label}" as done`}
      description={stage.evidence}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={mutation.isPending}
            disabled={!occurredAt}
            onClick={() => mutation.mutate()}
          >
            Mark as done
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="flex items-start gap-1.5 rounded-lg bg-warn-tint p-2.5 text-[11px] text-ink-2">
          <Icons.Info size={13} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0 text-warn" />
          Only for something that genuinely happened. This is recorded against your name and shows
          on the badge as marked by hand, not as something the system saw.
        </p>

        <Input
          type="date"
          label="When did it happen?"
          required
          max={today}
          value={occurredAt}
          onChange={(event) => setOccurredAt(event.target.value)}
        />

        <Textarea
          label="Note"
          rows={2}
          value={note}
          maxLength={500}
          placeholder="How you know — e.g. photo received on WhatsApp."
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
    </Dialog>
  );
}
