import * as RadixDialog from '@radix-ui/react-dialog';
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { ICON_SIZE, ICON_STROKE, Icons } from '@/lib/icons';
import { Button } from './Button';
import { Input } from './Field';

/**
 * Modal shell (§10).
 *
 * Every create/update action opens as a centred modal over a dimmed backdrop so
 * the employee never loses the context of the profile they are working on.
 * Radix handles focus trapping, restore-on-close, Escape and `aria-modal` —
 * all things a hand-rolled modal gets subtly wrong.
 */
export function Dialog({
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
  size?: 'sm' | 'md' | 'lg';
}) {
  const width = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl' }[size];

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-navy/40 backdrop-blur-[2px] animate-fade-in" />
        <RadixDialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2',
            'rounded-panel bg-white shadow-modal animate-scale-in',
            'max-h-[calc(100vh-3rem)] overflow-hidden flex flex-col',
            width,
          )}
        >
          <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
            <div className="min-w-0">
              <RadixDialog.Title className="text-sm font-semibold text-ink">{title}</RadixDialog.Title>
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

          <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

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

/**
 * M-12 Danger confirm.
 *
 * Irreversible actions require the user to type an exact confirmation string.
 * A single "Are you sure?" click is muscle memory after the third time; typing
 * `NBRAP12548` is not.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  message,
  confirmLabel = 'Confirm',
  confirmPhrase,
  variant = 'danger',
  loading,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  /** When set, the confirm button stays disabled until this is typed exactly. */
  confirmPhrase?: string;
  variant?: 'danger' | 'primary' | 'warning';
  loading?: boolean;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState('');
  const satisfied = !confirmPhrase || typed.trim() === confirmPhrase;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setTyped('');
        onOpenChange(next);
      }}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button variant={variant} onClick={onConfirm} loading={loading} disabled={!satisfied}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex gap-3">
        <span
          className={cn(
            'grid h-9 w-9 shrink-0 place-items-center rounded-full',
            variant === 'danger' ? 'bg-danger-tint text-danger' : 'bg-warn-tint text-warn',
          )}
        >
          <Icons.ShieldAlert size={ICON_SIZE.lg} strokeWidth={ICON_STROKE} />
        </span>
        <div className="min-w-0 flex-1 text-sm text-ink-2">{message}</div>
      </div>

      {confirmPhrase ? (
        <div className="mt-4">
          <Input
            label={`Type ${confirmPhrase} to confirm`}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={confirmPhrase}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      ) : null}
    </Dialog>
  );
}
