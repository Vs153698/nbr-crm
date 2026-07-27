import { APPLICATION_SOURCE, APPLICATION_SOURCE_LABELS, RECORD_STATUS, RECORD_TYPE } from '@nbr/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/Field';
import { api, ApiError } from '@/lib/api-client';
import { ICON_SIZE, ICON_STROKE, Icons } from '@/lib/icons';
import { queryKeys } from '@/lib/query-client';
import type { Lookups } from '../types';

/**
 * Open another record on an existing profile (§4).
 *
 * The applicant's personal details are deliberately absent from this form —
 * they are already on file. Re-entering them would be how a second, subtly
 * different copy of the same person gets created, which is exactly what the
 * one-profile rule exists to prevent.
 */
export function AddRecordDialog({
  applicantId,
  applicantCode,
  applicantName,
  isBlacklisted,
  canOverride,
  open,
  onOpenChange,
}: {
  applicantId: string;
  applicantCode: string;
  applicantName: string;
  isBlacklisted: boolean;
  canOverride: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();

  const [recordTitle, setRecordTitle] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [recordType, setRecordType] = useState<string>(RECORD_TYPE.INDIVIDUAL);
  const [achievementDate, setAchievementDate] = useState('');
  const [location, setLocation] = useState('');
  const [participantCount, setParticipantCount] = useState('1');
  const [source, setSource] = useState<string>(APPLICATION_SOURCE.WALK_IN);
  const [initialStatus, setInitialStatus] = useState<string>(RECORD_STATUS.NEW_LEAD);
  const [internalRemarks, setInternalRemarks] = useState('');
  const [override, setOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');

  const { data: lookups } = useQuery({
    queryKey: ['lookups'],
    queryFn: ({ signal }) => api.get<Lookups>('/lookups', undefined, signal),
    staleTime: 10 * 60_000,
    enabled: open,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.post<{ recordId: string; recordCode: string }>(`/applicants/${applicantId}/records`, {
        source,
        initialStatus,
        internalRemarks: internalRemarks || undefined,
        achievement: {
          recordTitle,
          categoryId,
          recordType,
          achievementDate: achievementDate || undefined,
          location: location || undefined,
          participantCount: Number(participantCount) || 1,
        },
        override,
        overrideReason: overrideReason || undefined,
      }),
    onSuccess: (result) => {
      toast.success(`Record ${result.recordCode} opened`, {
        description: `Added to ${applicantCode} — ${applicantName}.`,
      });
      onOpenChange(false);
      setRecordTitle('');
      setCategoryId('');
      void queryClient.invalidateQueries({ queryKey: queryKeys.applicant(applicantId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError && error.code === 'BLACKLIST_BLOCKED') {
        toast.error('Blacklisted applicant', { description: error.message });
        return;
      }
      toast.error(error instanceof ApiError ? error.message : 'Could not open the record');
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Open another record"
      description={`${applicantCode} — ${applicantName}. Personal details stay on the existing profile.`}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={createMutation.isPending}
            disabled={!recordTitle.trim() || !categoryId || (isBlacklisted && !override)}
            onClick={() => createMutation.mutate()}
          >
            Open record
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="flex items-start gap-2 rounded-lg bg-brand-tint p-2.5 text-[11px] leading-relaxed text-ink-2">
          <Icons.Info size={13} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0 text-brand" />
          One applicant keeps one permanent profile. This adds a further record to it, so the whole
          history — every record, certificate and payment — stays together on one screen.
        </p>

        {isBlacklisted ? (
          <div className="space-y-2 rounded-lg border border-danger-ring bg-danger-tint p-3">
            <p className="flex items-start gap-2 text-xs font-semibold text-danger">
              <Icons.Ban size={14} strokeWidth={2} className="mt-0.5 shrink-0" />
              This applicant is blacklisted — new applications are blocked.
            </p>
            {canOverride ? (
              <>
                <Checkbox
                  label="Override the blacklist and open this record anyway"
                  checked={override}
                  onChange={(event) => setOverride(event.target.checked)}
                />
                {override ? (
                  <Input
                    placeholder="Reason — recorded in the audit log"
                    value={overrideReason}
                    onChange={(event) => setOverrideReason(event.target.value)}
                  />
                ) : null}
              </>
            ) : (
              <p className="text-[11px] text-ink-2">
                An Admin with override permission must do this.
              </p>
            )}
          </div>
        ) : null}

        <Input
          label="Record title"
          required
          value={recordTitle}
          onChange={(event) => setRecordTitle(event.target.value)}
          autoFocus
          placeholder="e.g. Most push-ups in one hour"
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Category"
            required
            placeholder="Select a category"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
            options={(lookups?.categories ?? []).map((category) => ({
              value: category.id,
              label: category.name,
            }))}
          />
          <Select
            label="Record type"
            value={recordType}
            onChange={(event) => setRecordType(event.target.value)}
            options={[
              { value: RECORD_TYPE.INDIVIDUAL, label: 'Individual' },
              { value: RECORD_TYPE.GROUP, label: 'Group' },
            ]}
          />
          <Input
            label="Date of achievement"
            type="date"
            value={achievementDate}
            onChange={(event) => setAchievementDate(event.target.value)}
          />
          <Input
            label="Location"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
          />
          <Input
            label="Participants"
            type="number"
            min={1}
            value={participantCount}
            onChange={(event) => setParticipantCount(event.target.value)}
          />
          <Select
            label="Source"
            value={source}
            onChange={(event) => setSource(event.target.value)}
            options={Object.values(APPLICATION_SOURCE)
              .filter((value) => value !== APPLICATION_SOURCE.NBR_WEBSITE_SYNC)
              .map((value) => ({ value, label: APPLICATION_SOURCE_LABELS[value] }))}
          />
        </div>

        <Select
          label="Starting status"
          value={initialStatus}
          onChange={(event) => setInitialStatus(event.target.value)}
          options={[
            { value: RECORD_STATUS.NEW_LEAD, label: 'New Lead' },
            { value: RECORD_STATUS.APPLICATION_SUBMITTED, label: 'Application Submitted' },
            { value: RECORD_STATUS.UNDER_REVIEW, label: 'Under Review' },
          ]}
        />

        <Textarea
          label="Internal remarks"
          value={internalRemarks}
          onChange={(event) => setInternalRemarks(event.target.value)}
          rows={2}
        />
      </div>
    </Dialog>
  );
}
