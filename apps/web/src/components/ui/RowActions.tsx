import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { ICON_SIZE, ICON_STROKE, Icons } from '@/lib/icons';
import type { LucideIcon } from 'lucide-react';

export interface RowAction {
  /** Stable key; also the fallback label for screen readers. */
  id: string;
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  /** Renders in red and sits below a separator. */
  danger?: boolean;
  disabled?: boolean;
  /** Reason shown when disabled, so a greyed-out item explains itself. */
  disabledReason?: string;
}

/**
 * The three-dot menu at the end of a table row.
 *
 * Rows previously carried two or three buttons each, which had three problems:
 * the actions column grew wider than the data it sat beside, adding a fourth
 * action meant redesigning the table, and the row's visual weight went to the
 * controls rather than the record. Collapsing them behind one trigger keeps
 * every table the same width regardless of how many actions a row has.
 *
 * Destructive items are separated and coloured, because "Delete" sitting
 * directly under "Edit" at the same weight is how people delete things they
 * meant to edit.
 */
export function RowActions({
  actions,
  label = 'Row actions',
  align = 'end',
}: {
  actions: RowAction[];
  label?: string;
  align?: 'start' | 'end';
}) {
  const visible = actions.filter(Boolean);
  if (visible.length === 0) return null;

  const safe = visible.filter((action) => !action.danger);
  const destructive = visible.filter((action) => action.danger);

  const renderItem = (action: RowAction) => {
    const Icon = action.icon;
    return (
      <DropdownMenu.Item
        key={action.id}
        disabled={action.disabled}
        title={action.disabled ? action.disabledReason : undefined}
        onSelect={(event) => {
          // Radix closes on select; preventing default lets the handler open a
          // dialog without the menu's own focus restore fighting it.
          event.preventDefault();
          if (!action.disabled) action.onSelect();
        }}
        className={cn(
          'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs outline-none',
          'data-[highlighted]:bg-canvas',
          action.danger ? 'text-danger data-[highlighted]:bg-danger-tint' : 'text-ink-2',
          action.disabled && 'cursor-not-allowed opacity-45',
        )}
      >
        {Icon ? <Icon size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} className="shrink-0" /> : null}
        <span className="whitespace-nowrap">{action.label}</span>
      </DropdownMenu.Item>
    );
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            'grid h-7 w-7 place-items-center rounded-md text-ink-3 transition-colors',
            'hover:bg-canvas hover:text-ink data-[state=open]:bg-canvas data-[state=open]:text-ink',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring',
          )}
        >
          <Icons.MoreVertical size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          sideOffset={4}
          className={cn(
            'z-50 min-w-44 rounded-card border border-line bg-white p-1 shadow-lg',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          )}
        >
          {safe.map(renderItem)}
          {destructive.length > 0 && safe.length > 0 ? (
            <DropdownMenu.Separator className="my-1 h-px bg-line" />
          ) : null}
          {destructive.map(renderItem)}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** Wrapper that right-aligns the trigger in a table cell. */
export function RowActionsCell({ children }: { children: ReactNode }) {
  return <div className="flex justify-end">{children}</div>;
}
