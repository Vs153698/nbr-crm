import {
  forwardRef,
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/cn';
import { ICON_SIZE, ICON_STROKE, Icons } from '@/lib/icons';

/**
 * Form controls for the dark brand surface.
 *
 * The shared `Field`/`Button` components are built for the light application
 * chrome — `bg-white`, `text-ink`, `border-line` — and recolouring them would
 * have meant either a theme layer touching every screen at once, or props that
 * only one page passes. Neither is worth it for the three controls a sign-in
 * form has. These stay local until a second dark screen needs them.
 *
 * The accessibility wiring matches the shared components exactly: real
 * `htmlFor`, `aria-describedby` and `aria-invalid`, so a screen reader
 * announces the field, its state and its error together.
 */
export interface BrandInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix' | 'suffix'> {
  label: string;
  error?: string;
  prefix?: ReactNode;
  suffix?: ReactNode;
}

export const BrandInput = forwardRef<HTMLInputElement, BrandInputProps>(function BrandInput(
  { label, error, prefix, suffix, className, id, ...props },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={inputId}
        className="text-[11px] font-semibold uppercase tracking-[0.09em] text-nbr-text-3"
      >
        {label}
      </label>

      <div className="relative flex items-center">
        {prefix ? (
          <span className="pointer-events-none absolute left-3.5 text-nbr-text-4">{prefix}</span>
        ) : null}

        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={cn(
            'h-11 w-full rounded-lg border bg-nbr-bg text-sm text-white',
            'placeholder:text-nbr-text-4 transition-colors duration-150',
            'focus:outline-none focus-visible:border-nbr-orange focus-visible:ring-2 focus-visible:ring-nbr-orange/30',
            'autofill:shadow-[inset_0_0_0_1000px_#0D1B2A] autofill:[-webkit-text-fill-color:#fff]',
            error ? 'border-danger' : 'border-nbr-line hover:border-nbr-edge',
            prefix ? 'pl-10' : 'pl-3.5',
            suffix ? 'pr-11' : 'pr-3.5',
            className,
          )}
          {...props}
        />

        {suffix ? <span className="absolute right-3">{suffix}</span> : null}
      </div>

      {error ? (
        <p id={errorId} role="alert" className="flex items-center gap-1 text-xs text-danger">
          <Icons.XCircle size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} className="shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  );
});

/** Checkbox with a real input underneath, so it stays keyboard-operable. */
export function BrandCheckbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="group inline-flex cursor-pointer select-none items-center gap-2">
      <span className="relative flex h-[17px] w-[17px] items-center justify-center">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="peer absolute h-full w-full cursor-pointer opacity-0"
        />
        <span
          aria-hidden
          className={cn(
            'grid h-[17px] w-[17px] place-items-center rounded border transition-colors duration-150',
            'peer-focus-visible:ring-2 peer-focus-visible:ring-nbr-orange/40',
            checked
              ? 'border-nbr-orange bg-nbr-orange text-white'
              : 'border-nbr-edge bg-nbr-bg group-hover:border-nbr-text-4',
          )}
        >
          {checked ? <Icons.Check size={11} strokeWidth={3} /> : null}
        </span>
      </span>
      <span className="text-xs text-nbr-text-2">{label}</span>
    </label>
  );
}

/**
 * Primary action. Flat orange — the brand does not use gradients, and a
 * gradient on the one control the whole page exists for would be the most
 * conspicuous place to break that.
 */
export function BrandButton({
  children,
  loading,
  loadingLabel = 'Signing in…',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  loadingLabel?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={loading}
      className={cn(
        'inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg',
        'bg-nbr-orange text-sm font-bold tracking-wide text-white',
        'transition-colors duration-150 hover:bg-nbr-orange-hover',
        // White ring, dark offset: an orange ring on an orange button is
        // invisible, which is the one place a focus indicator must not be.
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-nbr-surface',
        'disabled:cursor-not-allowed disabled:opacity-60',
      )}
      {...props}
    >
      {loading ? (
        <>
          <Icons.Loader2 size={16} strokeWidth={2.4} className="animate-spin" />
          {loadingLabel}
        </>
      ) : (
        <>
          {children}
          <Icons.ArrowRight size={16} strokeWidth={2.4} />
        </>
      )}
    </button>
  );
}

/** Secondary action. Outlined rather than filled — one orange button per screen. */
export function BrandButtonSecondary({
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg',
        'border border-nbr-edge bg-transparent text-sm font-semibold text-nbr-text-2',
        'transition-colors duration-150 hover:border-nbr-text-4 hover:text-white',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-nbr-orange/30',
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/** "Back to sign in" and friends — a quiet tertiary route out of the screen. */
export function BrandBackLink({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-nbr-text-3 transition-colors group-hover:text-white">
      <Icons.ChevronLeft size={14} strokeWidth={2.4} />
      {children}
    </span>
  );
}
