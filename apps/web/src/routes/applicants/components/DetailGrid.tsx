import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { ICON_STROKE, type LucideIcon } from '@/lib/icons';

export interface DetailField {
  readonly icon?: LucideIcon;
  readonly label: string;
  readonly value: ReactNode;
  /** Render across the full width — addresses, titles, anything long. */
  readonly wide?: boolean;
  /** Values that are read digit by digit: IDs, phone numbers, amounts. */
  readonly mono?: boolean;
}

/**
 * A block of labelled facts that does not fold.
 *
 * The label sits *above* its value rather than beside it. That single choice is
 * what makes this survive a narrow screen: a label-left/value-right row has two
 * things competing for one line, so as the column narrows the value wraps into
 * a ragged column, gets clipped, or pushes the whole page sideways. Stacking
 * gives each the full width of its cell and the grid simply drops to one column.
 *
 * Borrowed from the applicant screen on the NBR website, which has been read by
 * operators for years and does exactly this.
 */
export function DetailGrid({
  fields,
  columns = 2,
  className,
}: {
  fields: readonly DetailField[];
  /** Cap at the widest breakpoint. Always one column on a phone. */
  columns?: 2 | 3;
  className?: string;
}) {
  const shown = fields.filter((field) => field.value !== null && field.value !== undefined);
  if (shown.length === 0) return null;

  return (
    <dl
      className={cn(
        'grid grid-cols-1 gap-x-6 gap-y-4',
        columns === 3 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2',
        className,
      )}
    >
      {shown.map((field) => (
        <div
          key={field.label}
          className={cn('flex min-w-0 items-start gap-2.5', field.wide && 'sm:col-span-full')}
        >
          {field.icon ? (
            <span
              className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-tint text-brand"
              aria-hidden
            >
              <field.icon size={13} strokeWidth={ICON_STROKE} />
            </span>
          ) : null}

          <div className="min-w-0 flex-1">
            <dt className="text-[10px] font-bold uppercase tracking-wider text-ink-4">
              {field.label}
            </dt>
            {/* `break-words` rather than `truncate`: an email or a long record
                title is a fact the operator needs in full, and hiding its tail
                behind an ellipsis is worse than letting it take two lines. */}
            <dd
              className={cn(
                'mt-0.5 break-words text-sm font-medium text-ink',
                field.mono && 'tabular font-mono',
              )}
            >
              {field.value}
            </dd>
          </div>
        </div>
      ))}
    </dl>
  );
}

/** An em dash reads as "we hold nothing here", which an empty cell does not. */
export const EMPTY = <span className="text-ink-4">—</span>;

export function orEmpty(value: string | null | undefined): ReactNode {
  return value && value.trim().length > 0 ? value : EMPTY;
}
