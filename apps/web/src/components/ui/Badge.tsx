import { FLAG_META, type FlagCode } from '@nbr/shared';
import { cn } from '@/lib/cn';
import { statusLabel, statusTone, TONE_CLASSES } from '@/lib/format';
import { ICON_SIZE, ICON_STROKE, iconByName } from '@/lib/icons';

/**
 * C-03 Status badges.
 *
 * The status → colour mapping lives in one place (`TONE_CLASSES` keyed off the
 * shared `STATUS_META`), so a status shown on the dashboard, in the list and on
 * the profile is always the same colour. No screen hand-styles a status.
 */
export function StatusBadge({
  status,
  size = 'md',
  className,
}: {
  status: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const tone = TONE_CLASSES[statusTone(status)];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-semibold uppercase tracking-wide',
        size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-2xs',
        tone.badge,
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', tone.dot)} aria-hidden />
      {statusLabel(status)}
    </span>
  );
}

/**
 * C-04 Restriction flags (§20).
 *
 * Flags sit next to the applicant's name on every screen. The tooltip carries
 * the consequence — "blocks new records", "hides outreach" — because a chip
 * alone doesn't tell a new employee why an action disappeared.
 */
const FLAG_TONE: Record<string, string> = {
  red: 'bg-danger-tint text-danger ring-1 ring-danger-ring',
  orange: 'bg-warn-tint text-warn ring-1 ring-warn-ring',
  amber: 'bg-warn-tint text-warn ring-1 ring-warn-ring',
  gold: 'bg-gold-tint text-gold ring-1 ring-gold-ring',
  slate: 'bg-slate2-tint text-slate2 ring-1 ring-slate2-ring',
  blue: 'bg-info-tint text-info ring-1 ring-info-ring',
};

export function FlagChip({ flag, className }: { flag: string; className?: string }) {
  const meta = FLAG_META[flag as FlagCode];
  if (!meta) return null;

  const Icon = iconByName(meta.icon);

  const consequences = [
    meta.blocksNewRecords ? 'blocks new applications' : null,
    meta.blocksOutreach ? 'hides email & WhatsApp actions' : null,
    meta.blocksErasure ? 'prevents data erasure' : null,
  ].filter(Boolean);

  return (
    <span
      title={consequences.length > 0 ? `${meta.label} — ${consequences.join(', ')}` : meta.label}
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-2xs font-semibold',
        FLAG_TONE[meta.tone] ?? FLAG_TONE.slate,
        className,
      )}
    >
      <Icon size={ICON_SIZE.sm - 2} strokeWidth={ICON_STROKE} />
      {meta.label}
    </span>
  );
}

/** Neutral chip for counts, categories and other non-semantic labels. */
export function Chip({
  children,
  tone = 'slate',
  className,
}: {
  children: React.ReactNode;
  tone?: keyof typeof TONE_CLASSES;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-2xs font-medium',
        TONE_CLASSES[tone].badge,
        className,
      )}
    >
      {children}
    </span>
  );
}
