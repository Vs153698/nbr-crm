import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useState } from 'react';
import { StatusBadge } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';
import { ICON_STROKE, Icons } from '@/lib/icons';
import { ChangeStageDialog } from './ChangeStageDialog';
import type { AvailableTransition } from '../types';

/**
 * The status badge, with the stage change attached to it.
 *
 * Changing a record's stage lived only at the bottom of the Next Steps panel,
 * behind a text link. The badge is where everyone looks to find out what stage
 * a record is at, so it is the obvious place to change it — and an operator who
 * has just read the stage should not have to hunt for the control that sets it.
 *
 * Blocked steps are listed and disabled rather than hidden. "Why can't I move
 * this on?" is answered in place by the guard's own reason, instead of leaving
 * an operator to guess from a menu that is simply shorter than they expected.
 */
export function StatusBadgeMenu({
  recordId,
  applicantId,
  status,
  statusLabel,
  transitions,
  canChange,
}: {
  recordId: string;
  applicantId: string;
  status: string;
  statusLabel: string;
  transitions: readonly AvailableTransition[];
  /** False hides the menu entirely and leaves a plain badge. */
  canChange: boolean;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [target, setTarget] = useState<string | undefined>(undefined);

  // Nothing to offer and nothing to explain — a menu here would open onto an
  // empty list, which reads as broken rather than as "there is nowhere to go".
  if (!canChange || transitions.length === 0) return <StatusBadge status={status} />;

  const available = transitions.filter((transition) => transition.available);
  const blocked = transitions.filter((transition) => !transition.available);

  function open(nextStatus?: string) {
    setTarget(nextStatus);
    setDialogOpen(true);
  }

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            title="Change stage"
            className="group inline-flex items-center gap-1 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-brand-ring"
          >
            <StatusBadge status={status} />
            <Icons.ChevronDown
              size={13}
              strokeWidth={ICON_STROKE}
              className="text-ink-3 transition-colors group-hover:text-ink"
              aria-hidden
            />
            <span className="sr-only">Change stage from {statusLabel}</span>
          </button>
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={6}
            className="z-50 w-72 rounded-panel border border-line bg-white p-1 shadow-modal animate-scale-in"
          >
            <p className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-ink-4">
              Move to
            </p>

            {available.length === 0 ? (
              <p className="px-2.5 pb-2 text-[11px] text-ink-3">
                Nothing is available from {statusLabel}.
              </p>
            ) : (
              available.map((transition) => (
                <DropdownMenu.Item
                  key={transition.to}
                  onSelect={() => open(transition.to)}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-xs outline-none',
                    'text-ink-2 data-[highlighted]:bg-brand-tint data-[highlighted]:text-brand',
                  )}
                >
                  <Icons.ArrowRight size={13} strokeWidth={ICON_STROKE} className="shrink-0" />
                  <span className="flex-1">{transition.label}</span>
                  {transition.requiresOverride ? (
                    <Icons.ShieldAlert
                      size={12}
                      strokeWidth={ICON_STROKE}
                      className="shrink-0 text-warn"
                      aria-label="Admin override"
                    />
                  ) : null}
                </DropdownMenu.Item>
              ))
            )}

            {blocked.length > 0 ? (
              <>
                <DropdownMenu.Separator className="my-1 h-px bg-line" />
                <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-4">
                  Waiting on
                </p>
                {blocked.map((transition) => (
                  <div key={transition.to} className="px-2.5 py-1.5">
                    <p className="text-xs font-medium text-ink-3">{transition.label}</p>
                    <p className="mt-0.5 text-[11px] leading-snug text-ink-4">
                      {transition.blockedReason}
                    </p>
                  </div>
                ))}
              </>
            ) : null}

            <DropdownMenu.Separator className="my-1 h-px bg-line" />
            <DropdownMenu.Item
              onSelect={() => open(undefined)}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-ink-2 outline-none data-[highlighted]:bg-slate2-tint data-[highlighted]:text-ink"
            >
              <Icons.RotateCcw size={13} strokeWidth={ICON_STROKE} className="shrink-0" />
              Change stage with a remark…
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      {/*
        Remounted per opening via `key`, so the dialog starts on the stage that
        was just picked rather than on whatever the previous opening left behind.
      */}
      {dialogOpen ? (
        <ChangeStageDialog
          key={target ?? 'any'}
          recordId={recordId}
          applicantId={applicantId}
          currentLabel={statusLabel}
          transitions={transitions}
          initialTarget={target}
          open
          onOpenChange={setDialogOpen}
        />
      ) : null}
    </>
  );
}
