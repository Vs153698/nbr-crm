import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Field';
import { ApiError, api } from '@/lib/api-client';
import type { EmployeeRow } from './types';

/**
 * Deleting a directory record.
 *
 * Rarely the right action — an employee who has left is marked Exited, because
 * audit entries and the records they handled all point at them. The server
 * refuses outright while anyone still reports to them.
 */
export function DeleteEmployeeDialog({
  employee,
  onClose,
  onDeleted,
}: {
  employee: EmployeeRow;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [reason, setReason] = useState('');

  const remove = useMutation({
    mutationFn: () =>
      api.delete(
        `/employees/${employee.id}${reason ? `?reason=${encodeURIComponent(reason)}` : ''}`,
      ),
    onSuccess: () => {
      toast.success('Employee record deleted');
      onClose();
      onDeleted();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not delete the record'),
  });

  return (
    <Dialog
      open
      onOpenChange={onClose}
      title={`Delete ${employee.fullName}?`}
      description={employee.employeeCode}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
            Delete record
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="rounded-lg border border-warn-ring bg-warn-tint p-2.5 text-[11px] leading-relaxed text-warn">
          If this person has left, set their status to <b>Exited</b> instead. Deleting is for a
          record created in error — audit entries and the work they handled still refer to them.
        </div>
        <Input
          label="Reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Why is this being deleted?"
        />
      </div>
    </Dialog>
  );
}
