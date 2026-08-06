import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { ICON_SIZE, ICON_STROKE, Icons, type LucideIcon } from '@/lib/icons';

/**
 * C-01 Buttons.
 *
 * One primary per view; destructive actions are always red and always paired
 * with a confirm dialog by the caller. Every button shows a spinner while
 * saving and disables itself, because a double-submitted payment form is a
 * real problem, not a cosmetic one.
 */
const button = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-semibold',
    'transition-colors duration-150 select-none',
    'disabled:pointer-events-none disabled:opacity-40',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-brand text-white hover:bg-brand-hover shadow-sm',
        secondary: 'bg-white text-ink border border-line hover:bg-canvas hover:border-ink-4/50',
        ghost: 'text-ink-2 hover:bg-slate2-tint hover:text-ink',
        success: 'bg-ok text-white hover:brightness-95 shadow-sm',
        warning: 'bg-warn text-white hover:brightness-95 shadow-sm',
        danger: 'bg-danger text-white hover:brightness-95 shadow-sm',
        // Brand-correct WhatsApp green — a generic green would read as "success".
        whatsapp: 'bg-[#25D366] text-[#04301A] hover:brightness-95 shadow-sm',
        link: 'text-brand hover:underline underline-offset-4 px-0',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-9 px-3.5 text-sm',
        lg: 'h-11 px-5 text-sm',
        icon: 'h-9 w-9 p-0',
      },
      block: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'secondary', size: 'md', block: false },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  loading?: boolean;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, block, icon: Icon, iconRight: IconRight, loading, children, disabled, type = 'button', ...props },
  ref,
) {
  const iconSize = size === 'sm' ? ICON_SIZE.sm : ICON_SIZE.md;

  return (
    <button
      ref={ref}
      type={type}
      // A loading button must also be unclickable, not merely look busy.
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(button({ variant, size, block }), className)}
      {...props}
    >
      {loading ? (
        <Icons.Loader2 size={iconSize} strokeWidth={ICON_STROKE} className="animate-spin" />
      ) : Icon ? (
        <Icon size={iconSize} strokeWidth={ICON_STROKE} />
      ) : null}
      {children}
      {IconRight && !loading ? <IconRight size={iconSize} strokeWidth={ICON_STROKE} /> : null}
    </button>
  );
});
