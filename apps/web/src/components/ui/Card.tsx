import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { ICON_SIZE, ICON_STROKE, Icons, type LucideIcon } from '@/lib/icons';
import { TONE_CLASSES } from '@/lib/format';
import type { StatusTone } from '@nbr/shared';

export function Card({
  children,
  className,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section
      className={cn(
        'rounded-card border border-line bg-white shadow-card',
        padded && 'p-4',
        className,
      )}
    >
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  icon: Icon,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <header className={cn('mb-3 flex items-start justify-between gap-3', className)}>
      <div className="flex min-w-0 items-start gap-2.5">
        {Icon ? (
          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-brand-tint text-brand">
            <Icon size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />
          </span>
        ) : null}
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-ink">{title}</h3>
          {subtitle ? <p className="mt-0.5 text-xs text-ink-3">{subtitle}</p> : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

/**
 * C-05 Stat card.
 *
 * Values come from Redis-cached counters, so the dashboard renders instantly.
 * Clicking through pre-filters the applicant list — a count nobody can act on
 * is decoration, so every card that represents a queue is a link.
 */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'slate',
  to,
  loading,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon: LucideIcon;
  tone?: StatusTone;
  to?: string;
  loading?: boolean;
}) {
  const toneClass = TONE_CLASSES[tone];

  const inner = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="text-2xs font-semibold uppercase tracking-wider text-ink-3">{label}</span>
        <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-md', toneClass.card)}>
          <Icon size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />
        </span>
      </div>

      {loading ? (
        <div className="skeleton mt-2 h-7 w-20" />
      ) : (
        <p className="tabular mt-1.5 text-2xl font-bold leading-none tracking-tight text-ink">
          {value}
        </p>
      )}

      {hint ? <p className="mt-1.5 text-xs text-ink-3">{hint}</p> : null}
    </>
  );

  const base =
    'block rounded-card border border-line bg-white p-4 shadow-card transition-shadow duration-150';

  if (to && !loading) {
    return (
      <Link
        to={to}
        className={cn(base, 'group hover:border-brand-ring hover:shadow-raised')}
        aria-label={`${label}: ${String(value)}. View list.`}
      >
        {inner}
        <span className="mt-2 inline-flex items-center gap-1 text-2xs font-semibold text-brand opacity-0 transition-opacity group-hover:opacity-100">
          View all
          <Icons.ChevronRight size={12} strokeWidth={ICON_STROKE} />
        </span>
      </Link>
    );
  }

  return <div className={base}>{inner}</div>;
}

/** C-08 Empty state — always paired with the action that resolves it. */
export function EmptyState({
  icon: Icon = Icons.Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      <span className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-slate2-tint text-ink-3">
        <Icon size={22} strokeWidth={ICON_STROKE} />
      </span>
      <h4 className="text-sm font-semibold text-ink">{title}</h4>
      {description ? <p className="mt-1 max-w-sm text-xs text-ink-3">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/**
 * Failed-query state.
 *
 * Distinct from `EmptyState` on purpose: rendering "nothing here" when the
 * request actually failed tells an operator a queue is clear when it may be
 * full, which is the worst possible lie for this product to tell.
 */
export function QueryError({
  title = "Couldn't load this",
  description = 'The server did not respond as expected.',
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <EmptyState
      icon={Icons.ShieldAlert}
      title={title}
      description={description}
      action={
        onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="text-xs font-semibold text-brand hover:underline"
          >
            Try again
          </button>
        ) : undefined
      }
    />
  );
}

/** Label/value row used across every summary card on the profile. */
export function DetailRow({
  label,
  value,
  className,
}: {
  label: string;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-3 py-1.5', className)}>
      <dt className="shrink-0 text-xs text-ink-3">{label}</dt>
      <dd className="min-w-0 text-right text-xs font-medium text-ink">{value ?? '—'}</dd>
    </div>
  );
}
