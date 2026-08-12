import { computePaymentPlan, formatINR, PAYMENT_MODE, PAYMENT_MODE_LABELS } from '@nbr/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Chip } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { CardHeader, DetailRow, EmptyState } from '@/components/ui/Card';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { Input, Select, Textarea } from '@/components/ui/Field';
import { useAuth } from '@/hooks/useAuth';
import { api, ApiError } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { formatDate, formatRelative, humanise } from '@/lib/format';
import { ICON_SIZE, ICON_STROKE, Icons } from '@/lib/icons';
import { RowActions } from '@/components/ui/RowActions';
import { FilePreviewSheet } from '@/components/ui/FilePreviewSheet';
import { queryKeys } from '@/lib/query-client';
import type { Lookups, PaymentSummary } from '../types';
import { useAutoOpen } from '@/hooks/useAutoOpen';

/**
 * W-10 Payment tab (§9, M-03).
 *
 * The plan preview is computed with the same shared helper the server uses, so
 * the figure shown in the modal is byte-identical to the one written to the
 * database — no "the total changed when I saved it".
 */
export function PaymentTab({
  recordId,
  applicantId,
  autoOpen,
  onAutoOpened,
  onSettled,
}: {
  recordId: string;
  applicantId: string;
  autoOpen?: string | null;
  onAutoOpened?: () => void;
  /**
   * The invoice has just been settled in full.
   *
   * Told directly rather than left for the page to notice: the server advances
   * the record to Certificate Verification on settlement, and the operator
   * should land on the certificate panel in the same gesture. Waiting for the
   * refetch to come back and diffing the status works too, but it is a slower
   * and less certain route to a navigation we already know we want.
   */
  onSettled?: () => void;
}) {
  const queryClient = useQueryClient();
  const { can } = useAuth();

  const [planOpen, setPlanOpen] = useState(false);
  /** Invoice number being previewed in the side sheet, or null. */
  const [previewInvoice, setPreviewInvoice] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [reverseTarget, setReverseTarget] = useState<string | null>(null);

  useAutoOpen(
    autoOpen,
    { 'payment-plan': () => setPlanOpen(true), payment: () => setPayOpen(true) },
    onAutoOpened,
  );

  const { data: payment, isLoading } = useQuery({
    queryKey: queryKeys.payment(recordId),
    queryFn: ({ signal }) => api.get<PaymentSummary | null>('/payments', { recordId }, signal),
  });

  const { data: lookups } = useQuery({
    queryKey: ['lookups'],
    queryFn: ({ signal }) => api.get<Lookups>('/lookups', undefined, signal),
    staleTime: 10 * 60_000,
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.payment(recordId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.applicant(applicantId) });
    // One prefix: the action panel, timeline and client-progress badge all
    // hang off it, so none of them can be left stale.
    void queryClient.invalidateQueries({ queryKey: queryKeys.record(recordId) });
  }

  /**
   * Open the invoice PDF, in the browser or as a download.
   *
   * The signed URL is fetched and opened in the same gesture rather than
   * rendered into a link: the signature is short-lived, and a link sitting on
   * the page for ten minutes is a broken one by the time anybody clicks it.
   */
  async function openInvoice(disposition: 'inline' | 'attachment') {
    try {
      const doc = await api.get<{ url: string }>(
        `/records/${recordId}/documents/invoice`,
        disposition === 'inline' ? { mode: 'inline' } : undefined,
      );
      window.open(doc.url, '_blank', 'noopener,noreferrer');
    } catch (error: unknown) {
      toast.error(error instanceof ApiError ? error.message : 'Could not open the invoice');
    }
  }

  const invoiceMutation = useMutation({
    mutationFn: () => api.post<{ invoiceNumber: string }>(`/payments/${payment?.id}/invoice`),
    onSuccess: (result) => {
      toast.success(`Invoice ${result.invoiceNumber} generated`);
      invalidate();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not generate the invoice'),
  });

  const reverseMutation = useMutation({
    mutationFn: (transactionId: string) =>
      api.post(`/payments/transactions/${transactionId}/reverse`, {
        reason: 'Reversed by staff — entered in error',
      }),
    onSuccess: () => {
      toast.success('Payment reversed', {
        description: 'A correcting entry was added; the original stays in the ledger.',
      });
      setReverseTarget(null);
      invalidate();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not reverse the payment'),
  });

  if (isLoading) return <div className="skeleton h-48" />;

  if (!payment) {
    return (
      <>
        <EmptyState
          icon={Icons.IndianRupee}
          title="No payment raised yet"
          description="Set the package and amount to raise a payment and start the clock on its due date."
          action={
            can('payments:create') ? (
              <Button variant="primary" icon={Icons.Plus} onClick={() => setPlanOpen(true)}>
                Raise payment
              </Button>
            ) : null
          }
        />
        {planOpen ? (
          <PaymentPlanDialog
            recordId={recordId}
            packages={lookups?.packages ?? []}
            onClose={() => setPlanOpen(false)}
            onSaved={invalidate}
          />
        ) : null}
      </>
    );
  }

  const settled = payment.status === 'paid';

  return (
    <div className="space-y-4">
      <CardHeader
        title="Payment"
        subtitle={payment.packageName}
        icon={Icons.IndianRupee}
        action={
          <div className="flex flex-wrap gap-2">
            {can('payments:edit') ? (
              <Button size="sm" variant="secondary" icon={Icons.PenLine} onClick={() => setPlanOpen(true)}>
                Edit plan
              </Button>
            ) : null}
            {can('payments:export') && payment.invoices.length === 0 ? (
              <Button
                size="sm"
                variant="secondary"
                icon={Icons.FileText}
                loading={invoiceMutation.isPending}
                onClick={() => invoiceMutation.mutate()}
              >
                Generate invoice
              </Button>
            ) : null}
            {can('payments:create') && !settled ? (
              <Button size="sm" variant="success" icon={Icons.Plus} onClick={() => setPayOpen(true)}>
                Record payment
              </Button>
            ) : null}
          </div>
        }
      />

      {/* Money breakdown — every line the invoice will carry. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <dl className="rounded-lg border border-line p-3">
          <DetailRow label="Package" value={payment.packageName} />
          <DetailRow label="Amount" value={formatINR(payment.amount)} />
          <DetailRow label="Discount" value={`− ${formatINR(payment.discount)}`} />
          <DetailRow label="Taxable value" value={formatINR(payment.taxableValue)} />
          <DetailRow label={`GST @ ${payment.gstPercent}%`} value={formatINR(payment.gstAmount)} />
          <div className="mt-1.5 border-t border-line pt-1.5">
            <DetailRow
              label="Total payable"
              value={<span className="text-sm font-bold">{formatINR(payment.finalAmount)}</span>}
            />
          </div>
        </dl>

        <div
          className={cn(
            'rounded-lg border p-3',
            settled
              ? 'border-ok-ring bg-ok-tint'
              : payment.overdue
                ? 'border-danger-ring bg-danger-tint'
                : 'border-warn-ring bg-warn-tint',
          )}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-2xs font-semibold uppercase tracking-wider text-ink-3">Status</span>
            <Chip tone={settled ? 'green' : payment.overdue ? 'red' : 'orange'}>
              {humanise(payment.status)}
            </Chip>
          </div>

          <dl>
            <DetailRow label="Received" value={formatINR(payment.amountPaid)} />
            <DetailRow
              label="Balance due"
              value={
                <span className={cn('font-bold', settled ? 'text-ok' : 'text-danger')}>
                  {formatINR(payment.balanceDue)}
                </span>
              }
            />
            <DetailRow label="Due date" value={formatDate(payment.dueDate)} />
            {payment.daysRemaining !== null && !settled ? (
              <DetailRow
                label="Days remaining"
                value={
                  payment.overdue
                    ? `${Math.abs(payment.daysRemaining)} overdue`
                    : String(payment.daysRemaining)
                }
              />
            ) : null}
            <DetailRow label="Reminders sent" value={payment.reminderCount} />
            {payment.settledAt ? (
              <DetailRow label="Settled" value={formatDate(payment.settledAt)} />
            ) : null}
          </dl>
        </div>
      </div>

      {/* Payment history — reversals shown, never hidden. */}
      <div>
        <h4 className="mb-2 text-xs font-semibold text-ink">
          Payment history ({payment.transactions.length})
        </h4>
        {payment.transactions.length === 0 ? (
          <p className="rounded-lg border border-line p-3 text-xs text-ink-3">
            No payments recorded yet.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {payment.transactions.map((transaction) => (
              <li
                key={transaction.id}
                className={cn(
                  'flex flex-wrap items-center gap-3 rounded-lg border p-2.5',
                  transaction.isReversal ? 'border-danger-ring bg-danger-tint/40' : 'border-line',
                )}
              >
                <span
                  className={cn(
                    'grid h-7 w-7 shrink-0 place-items-center rounded-md',
                    transaction.isReversal ? 'bg-danger text-white' : 'bg-ok-tint text-ok',
                  )}
                >
                  {transaction.isReversal ? (
                    <Icons.Undo2 size={14} strokeWidth={2} />
                  ) : (
                    <Icons.Check size={14} strokeWidth={2.4} />
                  )}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="tabular text-sm font-semibold text-ink">
                    {formatINR(transaction.amount)}
                    {transaction.isReversal ? (
                      <span className="ml-1.5 text-2xs font-normal text-danger">reversal</span>
                    ) : null}
                  </p>
                  <p className="text-[10px] text-ink-3">
                    {PAYMENT_MODE_LABELS[transaction.mode as keyof typeof PAYMENT_MODE_LABELS] ??
                      transaction.mode}
                    {transaction.transactionRef ? ` · ${transaction.transactionRef}` : ''} ·{' '}
                    {formatDate(transaction.paidOn)} · {transaction.recordedByName}
                  </p>
                  {transaction.remarks ? (
                    <p className="mt-0.5 text-[10px] italic text-ink-2">{transaction.remarks}</p>
                  ) : null}
                </div>

                {can('payments:edit') && !transaction.isReversal ? (
                  <RowActions
                    label="Transaction actions"
                    actions={[
                      {
                        id: 'reverse',
                        label: 'Reverse this payment',
                        icon: Icons.RotateCcw,
                        danger: true,
                        onSelect: () => setReverseTarget(transaction.id),
                      },
                    ]}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {payment.invoices.length > 0 ? (
        <div>
          <h4 className="mb-2 text-xs font-semibold text-ink">Invoices</h4>
          <ul className="space-y-1.5">
            {payment.invoices.map((invoice) => (
              <li
                key={invoice.id}
                className="flex items-center gap-3 rounded-lg border border-line p-2.5"
              >
                <Icons.FileText size={ICON_SIZE.md} strokeWidth={ICON_STROKE} className="text-ink-3" />
                <div className="min-w-0 flex-1">
                  <p className="tabular truncate text-xs font-medium text-ink">
                    {invoice.invoiceNumber}
                  </p>
                  <p className="text-[10px] text-ink-3">
                    {formatDate(invoice.issuedOn)} · {formatINR(invoice.finalAmount)}
                  </p>
                </div>
                {invoice.cancelledAt ? <Chip tone="red">Cancelled</Chip> : null}

                {/*
                  Preview, View and Download.

                  Preview opens the PDF in the side sheet — the point being that
                  an employee checks the layout, the applicant's details, the
                  amount and the GST *before* this goes to a customer, and
                  downloading a file to check it is a poor substitute for
                  looking at it. View is the same document in a full browser
                  tab, for reading a long one properly.
                */}
                {can('payments:export') ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={Icons.Eye}
                      onClick={() => setPreviewInvoice(invoice.invoiceNumber)}
                    >
                      Preview
                    </Button>
                    <RowActions
                      label={`Invoice ${invoice.invoiceNumber}`}
                      actions={[
                        {
                          id: 'view',
                          label: 'View in new tab',
                          icon: Icons.ExternalLink,
                          onSelect: () => void openInvoice('inline'),
                        },
                        {
                          id: 'download',
                          label: 'Download PDF',
                          icon: Icons.Download,
                          onSelect: () => void openInvoice('attachment'),
                        },
                      ]}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* The invoice, in place. Same sheet that previews evidence and
          attachments, so it behaves identically to every other document. */}
      {previewInvoice ? (
        <FilePreviewSheet
          downloadPath={`/records/${recordId}/documents/invoice`}
          fileName={`${previewInvoice}.pdf`}
          subtitle="Check the layout, applicant details, amount and GST before sharing this."
          onClose={() => setPreviewInvoice(null)}
        />
      ) : null}

      {planOpen ? (
        <PaymentPlanDialog
          recordId={recordId}
          packages={lookups?.packages ?? []}
          existing={payment}
          onClose={() => setPlanOpen(false)}
          onSaved={invalidate}
        />
      ) : null}

      {payOpen ? (
        <RecordPaymentDialog
          payment={payment}
          onClose={() => setPayOpen(false)}
          onSaved={invalidate}
          onSettled={onSettled}
        />
      ) : null}

      <ConfirmDialog
        open={reverseTarget !== null}
        onOpenChange={(open) => !open && setReverseTarget(null)}
        title="Reverse this payment?"
        message={
          <>
            A correcting entry is added to the ledger. The original stays visible — nothing is
            deleted, because a payment record that can vanish is worth nothing in a dispute.
          </>
        }
        confirmLabel="Reverse payment"
        loading={reverseMutation.isPending}
        onConfirm={() => reverseTarget && reverseMutation.mutate(reverseTarget)}
      />
    </div>
  );
}

function PaymentPlanDialog({
  recordId,
  packages,
  existing,
  onClose,
  onSaved,
}: {
  recordId: string;
  packages: Lookups['packages'];
  existing?: PaymentSummary;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [packageId, setPackageId] = useState('');
  const [packageName, setPackageName] = useState(existing?.packageName ?? '');
  const [amount, setAmount] = useState(existing?.amount ?? '');
  const [gstPercent, setGstPercent] = useState(existing?.gstPercent ?? '18.00');
  const [discount, setDiscount] = useState(existing?.discount ?? '0.00');
  const [dueDate, setDueDate] = useState(existing?.dueDate?.slice(0, 10) ?? '');
  const [notes, setNotes] = useState('');

  // Computed with the same helper the server uses — the preview and the saved
  // figure cannot disagree.
  const preview = useMemo(() => {
    try {
      return computePaymentPlan({ amount: amount || '0', gstPercent, discount: discount || '0' });
    } catch {
      return null;
    }
  }, [amount, gstPercent, discount]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.post<{ finalAmount: string }>('/payments/plan', {
        recordId,
        packageId: packageId || undefined,
        packageName,
        amount,
        gstPercent,
        discount: discount || '0.00',
        dueDate: dueDate || undefined,
        notes: notes || undefined,
      }),
    onSuccess: (result) => {
      toast.success(`Payment raised — ${formatINR(result.finalAmount)}`);
      onClose();
      onSaved();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not raise the payment'),
  });

  return (
    <Dialog
      open
      onOpenChange={onClose}
      title={existing ? 'Edit payment plan' : 'Raise payment'}
      description="GST is charged on the discounted amount."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={saveMutation.isPending}
            disabled={!packageName.trim() || !amount}
            onClick={() => saveMutation.mutate()}
          >
            {existing ? 'Update plan' : 'Raise payment'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Select
          label="Package"
          placeholder="Choose a package"
          value={packageId}
          onChange={(event) => {
            const selected = packages.find((p) => p.id === event.target.value);
            setPackageId(event.target.value);
            if (selected) {
              setPackageName(selected.name);
              setAmount(selected.amount);
              setGstPercent(selected.gstPercent);
            }
          }}
          options={packages.map((p) => ({
            value: p.id,
            label: `${p.name} — ${formatINR(p.amount)}`,
          }))}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Package name"
            required
            value={packageName}
            onChange={(event) => setPackageName(event.target.value)}
            hint="Snapshotted — renaming a package later won't change this invoice."
          />
          <Input
            label="Amount (₹)"
            required
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
          />
          <Input
            label="Discount (₹)"
            value={discount}
            onChange={(event) => setDiscount(event.target.value)}
            inputMode="decimal"
          />
          <Input
            label="GST %"
            value={gstPercent}
            onChange={(event) => setGstPercent(event.target.value)}
            inputMode="decimal"
          />
          <Input
            label="Due date"
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
            containerClassName="sm:col-span-2"
          />
        </div>

        {preview ? (
          <dl className="rounded-lg border border-brand-ring bg-brand-tint p-3">
            <DetailRow label="Taxable value" value={formatINR(preview.taxableValue)} />
            <DetailRow label={`GST @ ${preview.gstPercent}%`} value={formatINR(preview.gstAmount)} />
            <div className="mt-1 border-t border-brand-ring pt-1">
              <DetailRow
                label="Total payable"
                value={<span className="text-sm font-bold text-brand">{formatINR(preview.finalAmount)}</span>}
              />
            </div>
          </dl>
        ) : null}

        <Textarea
          label="Notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={2}
        />
      </div>
    </Dialog>
  );
}

function RecordPaymentDialog({
  payment,
  onClose,
  onSaved,
  onSettled,
}: {
  payment: PaymentSummary;
  onClose: () => void;
  onSaved: () => void;
  /** Called only when this payment cleared the balance. */
  onSettled?: () => void;
}) {
  const [amount, setAmount] = useState(payment.balanceDue);
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [mode, setMode] = useState<string>(PAYMENT_MODE.UPI);
  const [transactionRef, setTransactionRef] = useState('');
  const [remarks, setRemarks] = useState('');

  // Generated once per dialog so a double-click cannot record two payments.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const saveMutation = useMutation({
    mutationFn: () =>
      api.post<{ settlement: { isSettled: boolean; balanceDue: string } }>(
        '/payments/transactions',
        {
          paymentId: payment.id,
          amount,
          paidOn,
          mode,
          transactionRef: transactionRef || undefined,
          remarks: remarks || undefined,
          idempotencyKey,
        },
      ),
    onSuccess: (result) => {
      toast.success(
        result.settlement.isSettled
          ? 'Payment complete'
          : `₹${result.settlement.balanceDue} still outstanding`,
      );
      onClose();
      onSaved();

      /*
        Settled in full — the fee is done and the certificate is what is owed
        next, so the operator is taken there rather than left looking at a
        ledger with nothing outstanding on it.

        Only on settlement. A part payment leaves money owed and the record at
        Payment Pending, and moving off the ledger would hide the work that is
        still here.
      */
      if (result.settlement.isSettled) onSettled?.();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not record the payment'),
  });

  return (
    <Dialog
      open
      onOpenChange={onClose}
      title="Record payment"
      description={`${payment.packageName} — ${formatINR(payment.balanceDue)} outstanding`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="success"
            loading={saveMutation.isPending}
            disabled={!amount || Number(amount) <= 0}
            onClick={() => saveMutation.mutate()}
          >
            Record {amount ? formatINR(amount) : ''}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <dl className="rounded-lg bg-canvas p-3">
          <DetailRow label="Total payable" value={formatINR(payment.finalAmount)} />
          <DetailRow label="Received so far" value={formatINR(payment.amountPaid)} />
          <DetailRow
            label="Balance due"
            value={<span className="font-bold">{formatINR(payment.balanceDue)}</span>}
          />
        </dl>

        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Amount received (₹)"
            required
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            autoFocus
            hint="Partial payments are fine."
          />
          <Input
            label="Date"
            type="date"
            value={paidOn}
            onChange={(event) => setPaidOn(event.target.value)}
          />
          <Select
            label="Mode"
            value={mode}
            onChange={(event) => setMode(event.target.value)}
            options={Object.values(PAYMENT_MODE).map((value) => ({
              value,
              label: PAYMENT_MODE_LABELS[value],
            }))}
          />
          <Input
            label="Transaction ID"
            value={transactionRef}
            onChange={(event) => setTransactionRef(event.target.value)}
            placeholder="UPI ref / UTR"
          />
        </div>

        <Textarea
          label="Remarks"
          value={remarks}
          onChange={(event) => setRemarks(event.target.value)}
          rows={2}
        />

        {Number(amount) >= Number(payment.balanceDue) && Number(payment.balanceDue) > 0 ? (
          <p className="flex items-start gap-1.5 rounded-lg bg-ok-tint p-2.5 text-[11px] text-ok">
            <Icons.CheckCircle2 size={13} strokeWidth={2} className="mt-0.5 shrink-0" />
            This settles the balance — the payment status moves to Paid and the record can proceed to
            certificate.
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
