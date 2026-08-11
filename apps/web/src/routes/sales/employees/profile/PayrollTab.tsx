import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { PAYSLIP_STATUS, PAYSLIP_STATUS_META, type PayslipStatus } from '@nbr/shared';
import { Chip } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, QueryError } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Textarea } from '@/components/ui/Field';
import { FilePreviewSheet } from '@/components/ui/FilePreviewSheet';
import { RowActions } from '@/components/ui/RowActions';
import { useAuth } from '@/hooks/useAuth';
import { api, ApiError } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/format';
import { ICON_STROKE, Icons } from '@/lib/icons';
import { GeneratePayslipDialog } from './GeneratePayslipDialog';
import { Metric, Section } from './shared';
import { employeeKeys, type EmployeeDetail, type Payslip } from '../types';

/**
 * Payroll: the salary on record and every payslip issued from it.
 *
 * A slip is never edited. A wrong one is cancelled — it stays on the record,
 * struck through — and a new one is generated, because a payslip is a statement
 * that was handed to someone, and rewriting history there is the one thing
 * payroll must not do.
 */
export function PayrollTab({ employee }: { employee: EmployeeDetail }) {
  const { can } = useAuth();
  const canEdit = can('employees:edit');

  const [generateOpen, setGenerateOpen] = useState(false);
  const [previewing, setPreviewing] = useState<Payslip | null>(null);
  const [cancelling, setCancelling] = useState<Payslip | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: employeeKeys.payslips(employee.id),
    queryFn: ({ signal }) =>
      api.get<Payslip[]>(`/employees/${employee.id}/payslips`, undefined, signal),
  });

  /**
   * Fetch the signed URL and open it in the same gesture.
   *
   * The signature is short-lived, so a link rendered onto the page would be
   * broken by the time anyone clicked it.
   */
  async function download(payslip: Payslip) {
    try {
      const file = await api.get<{ url: string }>(`/payslips/${payslip.id}/pdf`);
      window.open(file.url, '_blank', 'noopener,noreferrer');
    } catch (error: unknown) {
      toast.error(error instanceof ApiError ? error.message : 'Could not open the payslip');
    }
  }

  const issued = (data ?? []).filter((payslip) => payslip.status !== PAYSLIP_STATUS.CANCELLED);
  const yearToDate = issued
    .filter((payslip) => payslip.periodYear === new Date().getFullYear())
    .reduce((total, payslip) => total + Number(payslip.netPay), 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Monthly salary" value={formatMoney(employee.monthlySalary)} icon={Icons.Wallet} tone="green" />
        <Metric label="Annual CTC" value={formatMoney(employee.ctc)} icon={Icons.TrendingUp} tone="blue" />
        <Metric label="Payslips issued" value={issued.length} icon={Icons.FileText} tone="slate" />
        <Metric
          label={`Net paid in ${new Date().getFullYear()}`}
          value={formatMoney(yearToDate)}
          icon={Icons.IndianRupee}
          tone="indigo"
        />
      </div>

      {isError ? (
        <Card>
          <QueryError title="Couldn't load the payslips" onRetry={() => void refetch()} />
        </Card>
      ) : isLoading || !data ? (
        <div className="skeleton h-56" />
      ) : (
        <Section
          title="Payslips"
          icon={Icons.Wallet}
          action={
            canEdit ? (
              <Button size="sm" variant="primary" icon={Icons.Plus} onClick={() => setGenerateOpen(true)}>
                Generate payslip
              </Button>
            ) : null
          }
        >
          {data.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-3">
              No payslips yet. Generating one freezes that month's basic pay and attendance onto the
              slip.
            </p>
          ) : (
            <div className="scrollbar-slim overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line text-2xs uppercase tracking-wider text-ink-3">
                    <th scope="col" className="px-2 py-2 text-left font-semibold">Period</th>
                    <th scope="col" className="px-2 py-2 text-left font-semibold">Number</th>
                    <th scope="col" className="px-2 py-2 text-right font-semibold">Gross</th>
                    <th scope="col" className="px-2 py-2 text-right font-semibold">Deductions</th>
                    <th scope="col" className="px-2 py-2 text-right font-semibold">Net pay</th>
                    <th scope="col" className="px-2 py-2 text-left font-semibold">Days</th>
                    <th scope="col" className="px-2 py-2 text-left font-semibold">Status</th>
                    <th scope="col" className="w-12 px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {data.map((payslip) => {
                    const meta = PAYSLIP_STATUS_META[payslip.status as PayslipStatus];
                    const cancelled = payslip.status === PAYSLIP_STATUS.CANCELLED;

                    return (
                      <tr
                        key={payslip.id}
                        className={cancelled ? 'border-b border-line/70 opacity-60' : 'border-b border-line/70'}
                      >
                        <td className="px-2 py-2">
                          <p className={cancelled ? 'text-xs font-medium text-ink-2 line-through' : 'text-xs font-medium text-ink'}>
                            {payslip.periodLabel}
                          </p>
                          <p className="text-[11px] text-ink-3">{formatDate(payslip.createdAt)}</p>
                        </td>
                        <td className="tabular px-2 py-2 font-mono text-[11px] text-ink-2">
                          {payslip.payslipNumber}
                        </td>
                        <td className="tabular px-2 py-2 text-right text-xs text-ink-2">
                          {formatMoney(payslip.grossPay)}
                        </td>
                        <td className="tabular px-2 py-2 text-right text-xs text-ink-2">
                          {formatMoney(payslip.totalDeductions)}
                        </td>
                        <td className="tabular px-2 py-2 text-right text-xs font-bold text-ink">
                          {formatMoney(payslip.netPay)}
                        </td>
                        <td className="tabular px-2 py-2 text-xs text-ink-3">
                          {payslip.payableDays} / {payslip.workingDays}
                        </td>
                        <td className="px-2 py-2">
                          <Chip tone={meta?.tone ?? 'slate'}>{meta?.label ?? payslip.status}</Chip>
                        </td>
                        <td className="px-2 py-2 text-right">
                          <RowActions
                            label={`Actions for payslip ${payslip.payslipNumber}`}
                            actions={[
                              {
                                id: 'preview',
                                label: 'Preview',
                                icon: Icons.Eye,
                                onSelect: () => setPreviewing(payslip),
                              },
                              {
                                id: 'download',
                                label: 'Download PDF',
                                icon: Icons.Download,
                                onSelect: () => void download(payslip),
                              },
                              ...(canEdit && !cancelled
                                ? [
                                    {
                                      id: 'cancel',
                                      label: 'Cancel payslip',
                                      icon: Icons.Undo2,
                                      danger: true,
                                      onSelect: () => setCancelling(payslip),
                                    },
                                  ]
                                : []),
                            ]}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}

      {!employee.monthlySalary ? (
        <div className="flex gap-2.5 rounded-card border border-warn-ring bg-warn-tint p-3">
          <Icons.AlertCircle size={16} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0 text-warn" />
          <p className="text-xs text-ink-2">
            No monthly salary is recorded, so a payslip cannot be pro-rated. Set one from{' '}
            <span className="font-semibold">Edit employee</span>.
          </p>
        </div>
      ) : null}

      {generateOpen ? (
        <GeneratePayslipDialog employee={employee} onClose={() => setGenerateOpen(false)} />
      ) : null}

      {previewing ? (
        <FilePreviewSheet
          downloadPath={`/payslips/${previewing.id}/pdf`}
          fileName={`${previewing.payslipNumber}.pdf`}
          subtitle={`${previewing.periodLabel} · net pay ${formatMoney(previewing.netPay)}`}
          onClose={() => setPreviewing(null)}
        />
      ) : null}

      {cancelling ? (
        <CancelPayslipDialog
          employeeId={employee.id}
          payslip={cancelling}
          onClose={() => setCancelling(null)}
        />
      ) : null}
    </div>
  );
}

function CancelPayslipDialog({
  employeeId,
  payslip,
  onClose,
}: {
  employeeId: string;
  payslip: Payslip;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/employees/${employeeId}/payslips/${payslip.id}/cancel`, { reason: reason.trim() }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['employee', employeeId] });
      toast.success('Payslip cancelled', {
        description: 'It stays on the record. Generate a replacement for that month.',
      });
      onClose();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not cancel the payslip'),
  });

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={`Cancel ${payslip.payslipNumber}`}
      description={`${payslip.periodLabel} · net pay ${formatMoney(payslip.netPay)}`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
            Keep it
          </Button>
          <Button
            variant="danger"
            loading={mutation.isPending}
            disabled={reason.trim().length === 0}
            onClick={() => mutation.mutate()}
          >
            Cancel payslip
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-ink-2">
          The slip stays on the record, marked cancelled, so the history of what was issued is
          intact. A replacement can then be generated for the same month.
        </p>
        <Textarea
          label="Reason"
          required
          rows={3}
          value={reason}
          maxLength={500}
          placeholder="Why is this slip being withdrawn?"
          onChange={(event) => setReason(event.target.value)}
        />
      </div>
    </Dialog>
  );
}
