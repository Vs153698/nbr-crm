import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { MONTH_LABELS } from '@nbr/shared';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input, Select, Textarea } from '@/components/ui/Field';
import { api, ApiError } from '@/lib/api-client';
import { formatMoney } from '@/lib/format';
import { ICON_STROKE, Icons } from '@/lib/icons';
import type { EmployeeDetail } from '../types';

interface Line {
  /** Local key only — the API takes label/amount. */
  key: string;
  label: string;
  amount: string;
}

function emptyLine(): Line {
  return { key: crypto.randomUUID(), label: '', amount: '' };
}

/**
 * Generate one month's payslip.
 *
 * The basic pay and the attendance are read from the record on the server and
 * frozen onto the slip — they are not asked for here, because a payslip that
 * disagreed with the register would be worse than none. Only the allowances and
 * one-off deductions are entered, since those are the part no system can infer.
 *
 * Loss of pay is computed by the server from the month's register and appears
 * as its own deduction line on the slip.
 */
export function GeneratePayslipDialog({
  employee,
  onClose,
}: {
  employee: EmployeeDetail;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const now = new Date();

  // Payroll is run for the month just finished, so that is the sensible default.
  const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const [periodMonth, setPeriodMonth] = useState(previous.getMonth() + 1);
  const [periodYear, setPeriodYear] = useState(previous.getFullYear());
  const [earnings, setEarnings] = useState<Line[]>([]);
  const [deductions, setDeductions] = useState<Line[]>([]);
  const [remarks, setRemarks] = useState('');

  const usable = (lines: Line[]) =>
    lines
      .filter((line) => line.label.trim() && Number(line.amount) > 0)
      .map((line) => ({ label: line.label.trim(), amount: line.amount }));

  const mutation = useMutation({
    mutationFn: () =>
      api.post<{ id: string; payslipNumber: string; netPay: string }>(
        `/employees/${employee.id}/payslips`,
        {
          periodMonth,
          periodYear,
          earnings: usable(earnings),
          deductions: usable(deductions),
          remarks: remarks.trim() || undefined,
        },
      ),
    onSuccess: (payslip) => {
      void queryClient.invalidateQueries({ queryKey: ['employee', employee.id] });
      toast.success(`Payslip ${payslip.payslipNumber} generated`, {
        description: `Net pay ${formatMoney(payslip.netPay)}.`,
      });
      onClose();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not generate the payslip'),
  });

  const years = Array.from({ length: 5 }, (_, index) => now.getFullYear() - index);

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Generate payslip"
      description={`Basic pay and attendance are taken from ${employee.fullName}'s record.`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={mutation.isPending}
            disabled={!employee.monthlySalary}
            onClick={() => mutation.mutate()}
          >
            Generate
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!employee.monthlySalary ? (
          <div className="flex gap-2.5 rounded-lg border border-warn-ring bg-warn-tint p-3">
            <Icons.AlertCircle size={16} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0 text-warn" />
            <p className="text-xs text-ink-2">
              No monthly salary is recorded for this employee. Set one from{' '}
              <span className="font-semibold">Edit employee</span> before generating a payslip —
              there is nothing to pro-rate without it.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-line bg-canvas p-3">
            <p className="text-xs text-ink-3">Basic pay, taken from the record</p>
            <p className="tabular mt-0.5 text-lg font-bold leading-none text-ink">
              {formatMoney(employee.monthlySalary)}
            </p>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Month"
            required
            value={String(periodMonth)}
            onChange={(event) => setPeriodMonth(Number(event.target.value))}
            options={MONTH_LABELS.map((label, index) => ({
              value: String(index + 1),
              label,
            }))}
          />
          <Select
            label="Year"
            required
            value={String(periodYear)}
            onChange={(event) => setPeriodYear(Number(event.target.value))}
            options={years.map((year) => ({ value: String(year), label: String(year) }))}
          />
        </div>

        <LineEditor
          title="Additional earnings"
          hint="Allowances, incentives, arrears. Basic pay is already included."
          lines={earnings}
          onChange={setEarnings}
        />

        <LineEditor
          title="Deductions"
          hint="Professional tax, PF, advances. Loss of pay is added automatically from the register."
          lines={deductions}
          onChange={setDeductions}
        />

        <Textarea
          label="Remarks"
          rows={2}
          value={remarks}
          maxLength={500}
          placeholder="Optional — printed on the slip."
          onChange={(event) => setRemarks(event.target.value)}
        />
      </div>
    </Dialog>
  );
}

function LineEditor({
  title,
  hint,
  lines,
  onChange,
}: {
  title: string;
  hint: string;
  lines: Line[];
  onChange: (lines: Line[]) => void;
}) {
  const total = lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0);

  return (
    <div className="rounded-lg border border-line p-3">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-xs font-semibold text-ink">{title}</h4>
          <p className="mt-0.5 text-[11px] text-ink-3">{hint}</p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          icon={Icons.Plus}
          onClick={() => onChange([...lines, emptyLine()])}
        >
          Add line
        </Button>
      </div>

      {lines.length === 0 ? (
        <p className="py-1 text-xs text-ink-4">None.</p>
      ) : (
        <div className="space-y-2">
          {lines.map((line) => (
            <div key={line.key} className="flex items-end gap-2">
              <Input
                placeholder="Label"
                value={line.label}
                maxLength={60}
                containerClassName="flex-1"
                onChange={(event) =>
                  onChange(
                    lines.map((row) =>
                      row.key === line.key ? { ...row, label: event.target.value } : row,
                    ),
                  )
                }
              />
              <Input
                type="number"
                min={0}
                step="0.01"
                placeholder="Amount"
                value={line.amount}
                containerClassName="w-32"
                onChange={(event) =>
                  onChange(
                    lines.map((row) =>
                      row.key === line.key ? { ...row, amount: event.target.value } : row,
                    ),
                  )
                }
              />
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Remove ${line.label || 'line'}`}
                icon={Icons.Trash2}
                onClick={() => onChange(lines.filter((row) => row.key !== line.key))}
              />
            </div>
          ))}

          <p className="tabular pt-1 text-right text-xs font-semibold text-ink-2">
            {formatMoney(total)}
          </p>
        </div>
      )}
    </div>
  );
}
