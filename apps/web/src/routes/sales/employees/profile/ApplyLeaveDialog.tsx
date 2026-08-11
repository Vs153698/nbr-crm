import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { LEAVE_TYPE, LEAVE_TYPE_LABELS, type LeaveType } from '@nbr/shared';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input, Select, Textarea } from '@/components/ui/Field';
import { api, ApiError } from '@/lib/api-client';

const MS_PER_DAY = 86_400_000;

/**
 * Calendar days in an inclusive range, as a first guess at the days claimed.
 *
 * Only a guess: the field stays editable because a public holiday inside the
 * range should not be charged to a balance, and half-days are real. The server
 * stores what is submitted, not what is derived here.
 */
function spanDays(from: string, to: string): number {
  if (!from || !to) return 0;
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;
  return Math.round((end - start) / MS_PER_DAY) + 1;
}

/** Apply for leave on someone's behalf. Approval is a separate decision. */
export function ApplyLeaveDialog({
  employeeId,
  onClose,
}: {
  employeeId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const [leaveType, setLeaveType] = useState<LeaveType>(LEAVE_TYPE.CASUAL);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [days, setDays] = useState('');
  const [reason, setReason] = useState('');
  /** Once the days are typed by hand, the dates stop overwriting them. */
  const [daysTouched, setDaysTouched] = useState(false);

  const suggested = useMemo(() => spanDays(fromDate, toDate), [fromDate, toDate]);

  useEffect(() => {
    if (!daysTouched && suggested > 0) setDays(String(suggested));
  }, [suggested, daysTouched]);

  const rangeInvalid = Boolean(fromDate && toDate && new Date(toDate) < new Date(fromDate));

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/employees/${employeeId}/leave`, {
        leaveType,
        fromDate,
        toDate,
        days: Number(days),
        reason: reason.trim(),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['employee', employeeId] });
      toast.success('Leave request recorded', { description: 'It is pending a decision.' });
      onClose();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not record the request'),
  });

  const ready = fromDate && toDate && !rangeInvalid && Number(days) >= 0.5 && reason.trim().length > 0;

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Apply for leave"
      description="Recorded as pending — approving it is a separate step."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={mutation.isPending}
            disabled={!ready}
            onClick={() => mutation.mutate()}
          >
            Submit request
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Select
          label="Leave type"
          required
          value={leaveType}
          onChange={(event) => setLeaveType(event.target.value as LeaveType)}
          options={Object.entries(LEAVE_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            type="date"
            label="From"
            required
            value={fromDate}
            onChange={(event) => setFromDate(event.target.value)}
          />
          <Input
            type="date"
            label="To"
            required
            value={toDate}
            error={rangeInvalid ? 'The end date cannot be before the start date.' : undefined}
            onChange={(event) => setToDate(event.target.value)}
          />
        </div>

        <Input
          type="number"
          label="Days claimed"
          required
          min={0.5}
          step={0.5}
          value={days}
          hint={
            suggested > 0
              ? `${suggested} calendar day${suggested === 1 ? '' : 's'} in this range — adjust for holidays or a half day.`
              : 'Half days are allowed.'
          }
          onChange={(event) => {
            setDaysTouched(true);
            setDays(event.target.value);
          }}
        />

        <Textarea
          label="Reason"
          required
          rows={3}
          value={reason}
          maxLength={1000}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>
    </Dialog>
  );
}
