import { STATUS_META, type RecordStatus, type StatusTone } from '@nbr/shared';

/** IST everywhere — the API stores UTC, the UI renders Indian time (§assumptions). */
const IST = 'Asia/Kolkata';

const dateFormatter = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: IST,
});

const dateTimeFormatter = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
  timeZone: IST,
});

const timeFormatter = new Intl.DateTimeFormat('en-IN', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
  timeZone: IST,
});

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? '—' : dateFormatter.format(date);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? '—' : dateTimeFormatter.format(date);
}

export function formatTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? '—' : timeFormatter.format(date);
}

/** "3 minutes ago", "in 2 days" — for timelines and due dates. */
export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) return '';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';

  const deltaSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  const absolute = Math.abs(deltaSeconds);

  const relative = new Intl.RelativeTimeFormat('en-IN', { numeric: 'auto' });

  if (absolute < 60) return relative.format(deltaSeconds, 'second');
  if (absolute < 3600) return relative.format(Math.round(deltaSeconds / 60), 'minute');
  if (absolute < 86_400) return relative.format(Math.round(deltaSeconds / 3600), 'hour');
  if (absolute < 2_592_000) return relative.format(Math.round(deltaSeconds / 86_400), 'day');
  if (absolute < 31_536_000) return relative.format(Math.round(deltaSeconds / 2_592_000), 'month');
  return relative.format(Math.round(deltaSeconds / 31_536_000), 'year');
}

/** Human file size — 1.4 MB rather than 1468006 bytes. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Rupees, grouped the Indian way — ₹1,25,000 rather than ₹125,000.
 *
 * Amounts arrive from the API as decimal *strings* (numeric columns), never as
 * JavaScript numbers, because 45000.10 has no exact float. They are parsed here
 * only to group the digits; nothing downstream does arithmetic on the result.
 * Paise are dropped unless there are any, since a salary of ₹45,000.00 reads as
 * noise while a deduction of ₹6,666.67 does not.
 */
export function formatMoney(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(amount)) return '—';

  const hasPaise = Math.round(amount * 100) % 100 !== 0;
  return `₹${amount.toLocaleString('en-IN', {
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

/** Initials for an avatar placeholder. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts.at(-1)![0]}`.toUpperCase();
}

/** Turn any enum-ish code into a readable label: `payment_pending` → `Payment pending`. */
export function humanise(value: string | null | undefined): string {
  if (!value) return '—';
  const spaced = value.replace(/[_-]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function statusLabel(status: string): string {
  return STATUS_META[status as RecordStatus]?.label ?? humanise(status);
}

export function statusTone(status: string): StatusTone {
  return STATUS_META[status as RecordStatus]?.tone ?? 'slate';
}

/**
 * Tailwind classes per semantic tone. Defined once so a status badge, a stat
 * card and a flag chip showing the same meaning are literally the same colour
 * (§C-03 "Same colour = same meaning everywhere").
 */
export const TONE_CLASSES: Record<StatusTone, { badge: string; dot: string; card: string }> = {
  blue: { badge: 'bg-info-tint text-info', dot: 'bg-info', card: 'bg-info-tint text-info' },
  orange: { badge: 'bg-warn-tint text-warn', dot: 'bg-warn', card: 'bg-warn-tint text-warn' },
  green: { badge: 'bg-ok-tint text-ok', dot: 'bg-ok', card: 'bg-ok-tint text-ok' },
  red: { badge: 'bg-danger-tint text-danger', dot: 'bg-danger', card: 'bg-danger-tint text-danger' },
  purple: {
    badge: 'bg-purple-tint text-purple',
    dot: 'bg-purple',
    card: 'bg-purple-tint text-purple',
  },
  teal: { badge: 'bg-teal-tint text-teal', dot: 'bg-teal', card: 'bg-teal-tint text-teal' },
  indigo: { badge: 'bg-brand-tint text-brand', dot: 'bg-brand', card: 'bg-brand-tint text-brand' },
  slate: {
    badge: 'bg-slate2-tint text-slate2',
    dot: 'bg-slate2',
    card: 'bg-slate2-tint text-slate2',
  },
};
