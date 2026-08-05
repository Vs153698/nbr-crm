import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Select, Textarea } from '@/components/ui/Field';
import { ApiError, api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-client';
import type { Lookups } from '../types';

/**
 * §11 "Assign employee" / "Assign verification team".
 *
 * Offered by the Smart Action panel at four separate stages, so it is its own
 * dialog rather than a field buried in the edit form. The remark is optional
 * but lands on the timeline, which is what makes a reassignment answerable
 * later — "why did this move to Priya on the 14th?"
 */
export function AssignRecordDialog({
  recordId,
  applicantId,
  currentUserId,
  open,
  onOpenChange,
}: {
  recordId: string;
  applicantId: string;
  currentUserId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [assignedToUserId, setAssignedToUserId] = useState(currentUserId ?? '');
  const [remark, setRemark] = useState('');

  const { data: lookups } = useQuery({
    queryKey: ['lookups'],
    queryFn: ({ signal }) => api.get<Lookups>('/lookups', undefined, signal),
    staleTime: 10 * 60_000,
    enabled: open,
  });

  const assignMutation = useMutation({
    mutationFn: () =>
      api.post(`/records/${recordId}/assign`, {
        // Empty means "nobody" — the API takes null to clear an assignment.
        assignedToUserId: assignedToUserId || null,
        remark: remark || undefined,
      }),
    onSuccess: () => {
      toast.success(assignedToUserId ? 'Record assigned' : 'Assignment cleared', {
        description: 'The change is on the timeline.',
      });
      onOpenChange(false);
      setRemark('');
      void queryClient.invalidateQueries({ queryKey: queryKeys.applicant(applicantId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.recordActions(recordId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.recordTimeline(recordId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not assign the record'),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Assign record"
      description="Who is responsible for taking this record forward?"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={assignMutation.isPending}
            onClick={() => assignMutation.mutate()}
          >
            Save assignment
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Select
          label="Assigned employee"
          value={assignedToUserId}
          onChange={(event) => setAssignedToUserId(event.target.value)}
          placeholder="Unassigned"
          options={(lookups?.staff ?? []).map((member) => ({
            value: member.id,
            label: `${member.fullName} — ${member.roleName}`,
          }))}
        />

        <Textarea
          label="Remark"
          hint="Optional. Shown on the timeline beside the reassignment."
          value={remark}
          onChange={(event) => setRemark(event.target.value)}
          rows={2}
        />
      </div>
    </Dialog>
  );
}
