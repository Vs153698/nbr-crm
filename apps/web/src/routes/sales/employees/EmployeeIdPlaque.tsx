import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/cn';
import { ICON_SIZE, ICON_STROKE, Icons } from '@/lib/icons';

/**
 * The employee ID, given the weight it actually carries.
 *
 * This is the number payroll, attendance and every internal form quote, and it
 * is the first thing anyone opening a profile is looking for — so it is set in
 * tabular monospace at a size you can read across a desk, not filed as the
 * fourth row of a definition list.
 *
 * Copying it is one click because the alternative is transcribing it by eye
 * into a payroll sheet, which is where a digit gets dropped.
 */
export function EmployeeIdPlaque({ employeeCode }: { employeeCode: string }) {
  const [copied, setCopied] = useState(false);

  // The tick is a confirmation, not a state: it must fall back to the copy
  // affordance on its own, or the control looks permanently spent.
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(employeeCode);
      setCopied(true);
    } catch {
      // Denied clipboard permission, or an insecure origin. Saying so beats a
      // silent no-op that leaves the user thinking they have it.
      toast.error('Could not copy — select the ID and copy it manually.');
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-card border border-brand-ring bg-brand-tint px-3 py-2">
      <Icons.ScanBarcode
        size={ICON_SIZE.lg}
        strokeWidth={ICON_STROKE}
        className="shrink-0 text-brand"
        aria-hidden
      />
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-brand/70">
          Employee ID
        </p>
        <p className="tabular truncate font-mono text-base font-bold leading-tight text-navy">
          {employeeCode}
        </p>
      </div>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={`Copy employee ID ${employeeCode}`}
        className={cn(
          'grid h-7 w-7 shrink-0 place-items-center rounded-md transition-colors',
          copied ? 'text-ok' : 'text-brand hover:bg-white/70',
        )}
      >
        {copied ? (
          <Icons.Check size={ICON_SIZE.sm} strokeWidth={2.5} />
        ) : (
          <Icons.Copy size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />
        )}
      </button>
    </div>
  );
}
