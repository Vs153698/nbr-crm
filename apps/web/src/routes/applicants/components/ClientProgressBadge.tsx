import * as Popover from '@radix-ui/react-popover';
import { type ClientProgress } from '@nbr/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
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
export function ClientProgressBadge({ recordId }: { recordId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['records', recordId, 'client-progress'],
    queryFn: ({ signal }) =>
      api.get<ClientProgress>(`/records/${recordId}/client-progress`, undefined, signal),
    staleTime: 30_000,
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
                      formatDate(stage.at)
                    ) : (
                      <>
                        {stage.evidence}
                        {stage.needsEmployeeAction ? ' Needs an employee.' : ''}
                      </>
                    )}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
