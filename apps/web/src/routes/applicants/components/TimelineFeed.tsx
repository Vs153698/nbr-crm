import { useInfiniteQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Card';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { formatDateTime, formatRelative } from '@/lib/format';
import { ICON_SIZE, ICON_STROKE, Icons, type LucideIcon } from '@/lib/icons';
import type { TimelineEntry } from '../types';

/**
 * Icon and colour per timeline event type (§13).
 * Grouped by prefix so a new `payment.*` event inherits the right treatment
 * without another entry here.
 */
function eventStyle(eventType: string): { icon: LucideIcon; tone: string } {
  const [domain] = eventType.split('.');

  switch (domain) {
    case 'applicant':
      return { icon: Icons.User, tone: 'bg-info-tint text-info' };
    case 'record':
      return eventType.includes('status')
        ? { icon: Icons.RotateCcw, tone: 'bg-brand-tint text-brand' }
        : { icon: Icons.FileText, tone: 'bg-info-tint text-info' };
    case 'evidence':
    case 'attachment':
      return { icon: Icons.Upload, tone: 'bg-slate2-tint text-slate2' };
    case 'payment':
      return { icon: Icons.IndianRupee, tone: 'bg-ok-tint text-ok' };
    case 'certificate':
      return { icon: Icons.Award, tone: 'bg-teal-tint text-teal' };
    case 'publication':
      return { icon: Icons.Newspaper, tone: 'bg-purple-tint text-purple' };
    case 'dispatch':
      return { icon: Icons.Truck, tone: 'bg-info-tint text-info' };
    case 'communication':
      return { icon: Icons.Mail, tone: 'bg-purple-tint text-purple' };
    case 'blacklist':
    case 'flag':
      return { icon: Icons.ShieldAlert, tone: 'bg-danger-tint text-danger' };
    case 'note':
      return { icon: Icons.StickyNote, tone: 'bg-warn-tint text-warn' };
    case 'task':
      return { icon: Icons.ClipboardCheck, tone: 'bg-slate2-tint text-slate2' };
    case 'privacy':
      return { icon: Icons.Shield, tone: 'bg-purple-tint text-purple' };
    default:
      return { icon: Icons.Info, tone: 'bg-slate2-tint text-slate2' };
  }
}

/**
 * The automatic timeline (§13, W-14).
 *
 * Read-only by construction — there is no edit or delete affordance anywhere in
 * this component, because the database rejects both. Cursor-paginated, so a
 * profile with 400 events loads the first 30 and fetches more on demand.
 */
export function TimelineFeed({
  recordId,
  applicantId,
  limit = 30,
  compact,
}: {
  recordId?: string;
  applicantId?: string;
  limit?: number;
  compact?: boolean;
}) {
  const scope = recordId ? `/records/${recordId}/timeline` : `/applicants/${applicantId}/timeline`;

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: recordId ? ['records', recordId, 'timeline'] : ['applicants', applicantId, 'timeline'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api.get<{ items: TimelineEntry[]; nextCursor: string | null }>(
        scope,
        { cursor: pageParam, limit },
        signal,
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(recordId ?? applicantId),
  });

  const entries = data?.pages.flatMap((page) => page.items) ?? [];

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="flex gap-3">
            <div className="skeleton h-7 w-7 shrink-0 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <div className="skeleton h-3.5 w-2/3" />
              <div className="skeleton h-2.5 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return <EmptyState icon={Icons.Clock} title="No activity yet" />;
  }

  return (
    <div>
      <ol className="relative space-y-0">
        {entries.map((entry, index) => {
          const { icon: Icon, tone } = eventStyle(entry.eventType);
          const isLast = index === entries.length - 1;

          return (
            <li key={entry.id} className="relative flex gap-3 pb-4 last:pb-0">
              {/* Connector line, stopped short on the final item. */}
              {!isLast ? (
                <span
                  className="absolute left-[13px] top-7 h-[calc(100%-1rem)] w-px bg-line"
                  aria-hidden
                />
              ) : null}

              <span
                className={cn(
                  'relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full ring-4 ring-white',
                  tone,
                )}
              >
                <Icon size={13} strokeWidth={2} />
              </span>

              <div className="min-w-0 flex-1 pt-0.5">
                <p className={cn('text-ink', compact ? 'text-xs' : 'text-sm')}>{entry.summary}</p>
                <p className="mt-0.5 text-[10px] text-ink-3" title={formatDateTime(entry.occurredAt)}>
                  {entry.actorKind === 'system'
                    ? 'System'
                    : entry.actorKind === 'integration'
                      ? 'NBR website'
                      : entry.actorName}
                  {' · '}
                  {formatDateTime(entry.occurredAt)}
                  {' · '}
                  {formatRelative(entry.occurredAt)}
                </p>

                {/* Status changes carry a remark worth surfacing inline. */}
                {typeof entry.meta?.remark === 'string' && entry.meta.remark ? (
                  <p className="mt-1.5 rounded-md border-l-2 border-line bg-canvas px-2.5 py-1.5 text-[11px] italic text-ink-2">
                    “{entry.meta.remark}”
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {hasNextPage ? (
        <div className="mt-2 flex justify-center">
          <Button
            variant="ghost"
            size="sm"
            loading={isFetchingNextPage}
            onClick={() => void fetchNextPage()}
            icon={Icons.ChevronDown}
          >
            Load older activity
          </Button>
        </div>
      ) : (
        <p className="mt-3 flex items-center justify-center gap-1 text-[10px] text-ink-4">
          <Icons.Lock size={10} strokeWidth={ICON_STROKE} />
          Timeline is permanent and cannot be edited
        </p>
      )}
    </div>
  );
}
