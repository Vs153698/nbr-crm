import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * A single keycap.
 *
 * `tone="dark"` is for the navy chrome; the default suits light surfaces.
 * Rendered as `<kbd>` so assistive tech announces it as a key, and the label
 * is spelled out for screen readers because "⌘" is announced as "at sign" or
 * dropped entirely by most of them.
 */
export function Kbd({
  children,
  label,
  tone = 'light',
  className,
}: {
  children: ReactNode;
  label?: string;
  tone?: 'light' | 'dark';
  className?: string;
}) {
  return (
    <kbd
      className={cn(
        'inline-flex h-[19px] min-w-[19px] items-center justify-center rounded px-1.5',
        'font-sans text-[10px] font-semibold leading-none',
        tone === 'dark'
          ? 'border border-white/15 bg-white/10 text-white/70'
          : 'border border-line bg-white text-ink-3 shadow-[0_1px_0_rgba(16,24,43,.06)]',
        className,
      )}
    >
      {label ? <span className="sr-only">{label}</span> : null}
      <span aria-hidden={label ? true : undefined}>{children}</span>
    </kbd>
  );
}
