import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { ICON_SIZE, ICON_STROKE, Icons } from '@/lib/icons';

/**
 * C-02 Inputs & form fields.
 *
 * The label, hint and error are wired together with real `id`/`aria-describedby`
 * relationships rather than being placed near each other visually — a screen
 * reader must announce "Mobile, invalid, Enter a 10-digit number", not just
 * "Mobile".
 */
interface FieldShellProps {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: (ids: { inputId: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

export function Field({ label, hint, error, required, className, children }: FieldShellProps) {
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;

  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label ? (
        <label htmlFor={inputId} className="text-xs font-semibold text-ink-2">
          {label}
          {required ? <span className="ml-0.5 text-danger">*</span> : null}
        </label>
      ) : null}

      {children({ inputId, describedBy, invalid: Boolean(error) })}

      {error ? (
        <p id={errorId} role="alert" className="flex items-center gap-1 text-xs text-danger">
          <Icons.XCircle size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} className="shrink-0" />
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const controlBase = [
  'w-full rounded-lg border bg-white px-3 text-sm text-ink',
  'placeholder:text-ink-4 transition-colors',
  'disabled:cursor-not-allowed disabled:bg-canvas disabled:text-ink-3',
];

const controlState = (invalid: boolean) =>
  invalid
    ? 'border-danger focus-visible:ring-danger'
    : 'border-line hover:border-ink-4/60 focus-visible:ring-brand';

// `prefix` and `suffix` are also (unrelated) DOM attributes, so they are
// omitted from the base type before being redeclared as slots.
export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix' | 'suffix'> {
  label?: string;
  hint?: string;
  error?: string;
  prefix?: ReactNode;
  suffix?: ReactNode;
  containerClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, required, prefix, suffix, className, containerClassName, ...props },
  ref,
) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={containerClassName}>
      {({ inputId, describedBy, invalid }) => (
        <div className="relative flex items-center">
          {prefix ? (
            <span className="pointer-events-none absolute left-3 text-ink-3">{prefix}</span>
          ) : null}
          <input
            ref={ref}
            id={inputId}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            required={required}
            className={cn(
              controlBase,
              controlState(invalid),
              'h-9',
              prefix ? 'pl-9' : '',
              suffix ? 'pr-9' : '',
              className,
            )}
            {...props}
          />
          {suffix ? <span className="absolute right-3 text-ink-3">{suffix}</span> : null}
        </div>
      )}
    </Field>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
  containerClassName?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, required, className, containerClassName, rows = 4, ...props },
  ref,
) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={containerClassName}>
      {({ inputId, describedBy, invalid }) => (
        <textarea
          ref={ref}
          id={inputId}
          rows={rows}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          required={required}
          className={cn(controlBase, controlState(invalid), 'resize-y py-2 leading-relaxed', className)}
          {...props}
        />
      )}
    </Field>
  );
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
  error?: string;
  placeholder?: string;
  containerClassName?: string;
  options: ReadonlyArray<{ value: string; label: string; disabled?: boolean }>;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, required, placeholder, options, className, containerClassName, ...props },
  ref,
) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={containerClassName}>
      {({ inputId, describedBy, invalid }) => (
        <div className="relative">
          <select
            ref={ref}
            id={inputId}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            required={required}
            className={cn(
              controlBase,
              controlState(invalid),
              'h-9 cursor-pointer appearance-none pr-9',
              className,
            )}
            {...props}
          >
            {placeholder ? (
              <option value="">{placeholder}</option>
            ) : null}
            {options.map((option) => (
              <option key={option.value} value={option.value} disabled={option.disabled}>
                {option.label}
              </option>
            ))}
          </select>
          <Icons.ChevronDown
            size={ICON_SIZE.sm}
            strokeWidth={ICON_STROKE}
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-3"
          />
        </div>
      )}
    </Field>
  );
});

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  hint?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, hint, className, ...props },
  ref,
) {
  const id = useId();
  return (
    <div className="flex items-start gap-2.5">
      <input
        ref={ref}
        id={id}
        type="checkbox"
        className={cn(
          'mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-line text-brand',
          'focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1',
          className,
        )}
        {...props}
      />
      <div className="min-w-0">
        <label htmlFor={id} className="cursor-pointer text-sm text-ink">
          {label}
        </label>
        {hint ? <p className="text-xs text-ink-3">{hint}</p> : null}
      </div>
    </div>
  );
});
