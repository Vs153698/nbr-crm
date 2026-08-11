import type { ReactNode } from 'react';
import { Chip } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';
import { humanise } from '@/lib/format';
import { ICON_STROKE, type LucideIcon } from '@/lib/icons';
import { TONE_CLASSES } from '@/lib/format';

/**
 * A labelled block on the profile.
 *
 * Every section of the profile is one of these, so the heading weight, the icon
 * treatment and the divider are decided once rather than per tab.
 */
export function Section({
  title,
  icon: Icon,
  action,
  children,
  className,
}: {
  title: string;
  icon?: LucideIcon;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-card border border-line bg-white shadow-card', className)}>
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          {Icon ? (
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-brand-tint text-brand">
              <Icon size={15} strokeWidth={ICON_STROKE} />
            </span>
          ) : null}
          <h3 className="truncate text-sm font-semibold text-ink">{title}</h3>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Label above value — the reading order for a form-like block of facts. */
export function Info({
  label,
  value,
  className,
}: {
  label: string;
  value: ReactNode;
  className?: string;
}) {
  const empty = value === null || value === undefined || value === '';

  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-[11px] uppercase tracking-wide text-ink-3">{label}</dt>
      <dd className={cn('mt-0.5 break-words text-sm', empty ? 'text-ink-4' : 'font-medium text-ink')}>
        {empty ? 'Not recorded' : value}
      </dd>
    </div>
  );
}

/** The two-column grid the Personal, Emergency and Employment blocks share. */
export function InfoGrid({ children }: { children: ReactNode }) {
  return <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">{children}</dl>;
}

/**
 * A small figure with a label — the compact cousin of `StatCard`.
 *
 * Used inside a tab where a full stat card would be too heavy but a bare number
 * would have nothing to explain it.
 */
export function Metric({
  label,
  value,
  tone = 'slate',
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  tone?: keyof typeof TONE_CLASSES;
  icon?: LucideIcon;
}) {
  return (
    <div className="rounded-lg border border-line bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wide text-ink-3">{label}</span>
        {Icon ? (
          <span className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-md', TONE_CLASSES[tone].card)}>
            <Icon size={13} strokeWidth={ICON_STROKE} />
          </span>
        ) : null}
      </div>
      <p className="tabular mt-1 text-lg font-bold leading-none text-ink">{value}</p>
    </div>
  );
}

/**
 * A status chip driven by one of the HR `*_STATUS_META` tables.
 *
 * Those tables narrow `tone` to their own small unions, which do not line up
 * with each other; this takes the label and tone directly so each caller reads
 * its own meta table and nothing has to be cast.
 */
export function StatusChip({
  label,
  tone,
}: {
  label: string;
  tone: keyof typeof TONE_CLASSES;
}) {
  return <Chip tone={tone}>{label}</Chip>;
}

/**
 * An audit action code as a sentence: `employee.payslip_generated` →
 * "Payslip generated".
 */
export function actionLabel(action: string): string {
  const [, rest] = action.split('.');
  return humanise(rest ?? action);
}
