import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { ATTENDANCE_STATUS, ATTENDANCE_STATUS_META, type AttendanceStatus } from '@nbr/shared';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input, Select, Textarea } from '@/components/ui/Field';
import { api, ApiError } from '@/lib/api-client';

/** Today, as the `yyyy-mm-dd` a date input expects, in local time. */
function todayValue(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

/**
 * Mark or correct one day in the register.
 *
 * The API is idempotent on (employee, date): re-marking a day corrects it
 * rather than adding a second row, so this dialog doubles as the edit form and
 * there is never more than one answer for a date.
 */
export function MarkAttendanceDialog({
  employeeId,
  onClose,
  initialDate,
}: {
  employeeId: string;
  onClose: () => void;
  initialDate?: string;
}) {
  const queryClient = useQueryClient();

  const [onDate, setOnDate] = useState(initialDate ?? todayValue());
  const [status, setStatus] = useState<AttendanceStatus>(ATTENDANCE_STATUS.PRESENT);
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [remarks, setRemarks] = useState('');

  // Times only make sense for a day the person actually worked.
  const timesApply =
    status === ATTENDANCE_STATUS.PRESENT ||
    status === ATTENDANCE_STATUS.HALF_DAY ||
    status === ATTENDANCE_STATUS.WORK_FROM_HOME;

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/employees/${employeeId}/attendance`, {
        onDate,
        status,
        checkInAt: timesApply && checkIn ? new Date(`${onDate}T${checkIn}`).toISOString() : undefined,
        checkOutAt:
          timesApply && checkOut ? new Date(`${onDate}T${checkOut}`).toISOString() : undefined,
        remarks: remarks.trim() || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['employee', employeeId] });
      toast.success('Attendance marked', {
        description: `${ATTENDANCE_STATUS_META[status].label} on ${onDate}.`,
      });
      onClose();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not mark attendance'),
  });

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Mark attendance"
      description="Marking a day that already has an entry corrects it."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button variant="primary" loading={mutation.isPending} onClick={() => mutation.mutate()}>
            Save entry
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            type="date"
            label="Date"
            required
            value={onDate}
            max={todayValue()}
            onChange={(event) => setOnDate(event.target.value)}
          />
          <Select
            label="Status"
            required
            value={status}
            onChange={(event) => setStatus(event.target.value as AttendanceStatus)}
            options={Object.entries(ATTENDANCE_STATUS_META).map(([value, meta]) => ({
              value,
              label: meta.label,
            }))}
          />
        </div>

        {timesApply ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              type="time"
              label="Check in"
              value={checkIn}
              onChange={(event) => setCheckIn(event.target.value)}
            />
            <Input
              type="time"
              label="Check out"
              value={checkOut}
              hint="Hours worked are computed from these."
              onChange={(event) => setCheckOut(event.target.value)}
            />
          </div>
        ) : null}

        <Textarea
          label="Remarks"
          rows={3}
          value={remarks}
          maxLength={500}
          placeholder="Optional — why the day was marked this way."
          onChange={(event) => setRemarks(event.target.value)}
        />
      </div>
    </Dialog>
  );
}
