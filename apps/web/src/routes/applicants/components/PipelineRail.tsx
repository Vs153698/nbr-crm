import { LEGACY_PIPELINE, legacyPipelineIndex, type RecordStatus } from '@nbr/shared';
import { cn } from '@/lib/cn';
import { ICON_STROKE, Icons, type LucideIcon } from '@/lib/icons';

/** One icon per step, in the pipeline's own order. */
const STEP_ICONS: readonly LucideIcon[] = [
  Icons.FileText,
  Icons.Eye,
  Icons.CheckCircle2,
  Icons.CreditCard,
  Icons.Package,
];

/**
 * Where the application has got to, in the website's own five steps.
 *
 * The CRM's seventeen statuses are the truth underneath and still drive its
 * queues and reports — but they are more detail than anyone wants when the
 * question is simply "how far along is this?". These are the same five steps,
 * with the same names, that the website's admin panel shows, so an operator
 * moving between the two systems is reading one answer rather than translating.
 *
 * Rejected and closed records are off the rail entirely, and saying so plainly
 * beats drawing a progress bar for something that stopped.
 */
export function PipelineRail({ status }: { status: RecordStatus }) {
  const current = legacyPipelineIndex(status);

  if (current < 0) {
    const stopped = status === 'rejected' ? 'Rejected' : 'Closed';
    return (
      <div className="flex items-center gap-2 rounded-lg border border-danger-ring bg-danger-tint px-3 py-2">
        <Icons.XCircle size={14} strokeWidth={ICON_STROKE} className="shrink-0 text-danger" />
        <p className="text-xs font-semibold text-danger">
          {stopped} — this application is not progressing.
        </p>
      </div>
    );
  }

  return (
    <ol className="flex flex-col gap-0 sm:flex-row sm:items-start">
      {LEGACY_PIPELINE.map((step, index) => {
        const done = index < current;
        const active = index === current;
        const Icon = STEP_ICONS[index] ?? Icons.Clock;
        const last = index === LEGACY_PIPELINE.length - 1;

        return (
          <li key={step.stage} className="flex min-w-0 gap-2.5 sm:flex-1 sm:flex-col sm:gap-1.5">
            {/* Marker plus its connector. Horizontal on a wide screen, vertical
                on a phone — the same rail read in whichever direction there is
                room for, rather than a five-column grid squeezed to nothing. */}
            <div className="flex flex-col items-center sm:w-full sm:flex-row">
              <span
                className={cn(
                  'grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition-colors',
                  active
                    ? 'border-brand bg-brand text-white'
                    : done
                      ? 'border-ok bg-ok text-white'
                      : 'border-line bg-white text-ink-4',
                )}
                aria-hidden
              >
                <Icon size={11} strokeWidth={2.25} />
              </span>

              {!last ? (
                <span
                  className={cn(
                    'rounded-full transition-colors',
                    'my-0.5 h-5 w-0.5 sm:my-0 sm:ml-1 sm:h-0.5 sm:w-full',
                    done ? 'bg-ok/50' : 'bg-line',
                  )}
                  aria-hidden
                />
              ) : null}
            </div>

            <p
              className={cn(
                'min-w-0 pb-3 text-xs sm:pb-0',
                active
                  ? 'font-semibold text-brand'
                  : done
                    ? 'font-medium text-ok'
                    : 'text-ink-4',
              )}
            >
              {step.label}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
