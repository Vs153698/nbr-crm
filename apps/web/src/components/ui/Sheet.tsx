import * as RadixDialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { ICON_SIZE, ICON_STROKE, Icons } from '@/lib/icons';

/**
 * Side sheet.
 *
 * The counterpart to `Dialog`: a modal is for a decision that interrupts, a
 * sheet is for looking at something alongside what you were already reading.
 * Previewing a scanned contract belongs here — the profile behind it stays on
 * screen, and closing the sheet returns you to exactly where you were rather
 * than to a page that has re-rendered underneath.
 *
 * Radix supplies the same focus trap, Escape handling and `aria-modal` as the
 * modal; only the geometry differs.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** `lg` is for document and image previews, which need the width. */
  size?: 'md' | 'lg';
}) {
  const width = { md: 'sm:max-w-lg', lg: 'sm:max-w-3xl' }[size];

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-navy/40 backdrop-blur-[2px] animate-fade-in" />
        <RadixDialog.Content
          className={cn(
            'fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-white shadow-modal',
            'animate-slide-in-right',
            width,
          )}
        >
          <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
            <div className="min-w-0">
              <RadixDialog.Title className="truncate text-sm font-semibold text-ink">
                {title}
              </RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="mt-0.5 text-xs text-ink-3">
                  {description}
                </RadixDialog.Description>
              ) : null}
            </div>
            <RadixDialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-ink-3 transition-colors hover:bg-slate2-tint hover:text-ink"
              >
                <Icons.X size={ICON_SIZE.md} strokeWidth={ICON_STROKE} />
              </button>
            </RadixDialog.Close>
          </header>

          <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto">{children}</div>

          {footer ? (
            <footer className="flex items-center justify-end gap-2 border-t border-line bg-canvas px-5 py-3">
              {footer}
            </footer>
          ) : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
