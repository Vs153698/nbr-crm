import { GENDER } from '@nbr/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input, Select } from '@/components/ui/Field';
import { api, ApiError } from '@/lib/api-client';
import { ICON_SIZE, ICON_STROKE, Icons } from '@/lib/icons';
import { queryKeys } from '@/lib/query-client';
import type { ApplicantProfile } from '../types';

/**
 * Edit the master profile (P1-08).
 *
 * Sends `expectedUpdatedAt` with the save. If someone else changed the record
 * while this dialog was open, the API refuses the write rather than silently
 * overwriting their edit — the optimistic lock from §6 "Concurrency". The user
 * gets told to reload instead of losing a colleague's work without knowing.
 */
export function EditApplicantDialog({
  profile,
  open,
  onOpenChange,
}: {
  profile: ApplicantProfile['applicant'];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    fullName: profile.fullName,
    fatherName: profile.fatherName ?? '',
    motherName: profile.motherName ?? '',
    dateOfBirth: profile.dateOfBirth ?? '',
    gender: profile.gender ?? '',
    mobile: profile.mobile,
    whatsapp: profile.whatsapp ?? '',
    email: profile.email,
    addressLine: profile.addressLine ?? '',
    city: profile.city ?? '',
    state: profile.state ?? '',
    country: profile.country,
    pincode: profile.pincode ?? '',
    nationality: profile.nationality ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  const saveMutation = useMutation({
    mutationFn: () =>
      api.put(`/applicants/${profile.id}`, {
        applicant: {
          fullName: form.fullName,
          fatherName: form.fatherName || undefined,
          motherName: form.motherName || undefined,
          dateOfBirth: form.dateOfBirth || undefined,
          gender: form.gender || undefined,
          mobile: form.mobile,
          whatsapp: form.whatsapp || undefined,
          email: form.email,
          addressLine: form.addressLine || undefined,
          city: form.city || undefined,
          state: form.state || undefined,
          country: form.country,
          pincode: form.pincode || undefined,
          nationality: form.nationality || undefined,
        },
        // The optimistic lock: the server compares this against the row's
        // current updatedAt and rejects the write if they differ.
        expectedUpdatedAt: profile.updatedAt,
      }),
    onSuccess: () => {
      toast.success('Profile updated', { description: 'The change is on the timeline.' });
      onOpenChange(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.applicant(profile.id) });
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        if (error.code === 'STALE_WRITE') {
          toast.error('Someone else changed this profile', { description: error.message });
          return;
        }
        if (error.code === 'DUPLICATE_VALUE') {
          toast.error('That value is already in use', { description: error.message });
          return;
        }

        const fieldErrors: Record<string, string> = {};
        for (const { name, message } of error.fieldErrors) {
          fieldErrors[name.split('.').pop() ?? name] = message;
        }
        setErrors(fieldErrors);
        toast.error(error.message);
      } else {
        toast.error('Could not save the changes');
      }
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Edit applicant"
      description={`${profile.applicantCode} — changes are recorded on the timeline and in the audit log.`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={saveMutation.isPending}
            disabled={!form.fullName.trim() || !form.mobile.trim() || !form.email.trim()}
            onClick={() => {
              setErrors({});
              saveMutation.mutate();
            }}
          >
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="flex items-start gap-2 rounded-lg bg-canvas p-2.5 text-[11px] leading-relaxed text-ink-3">
          <Icons.Info size={13} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0" />
          Identity documents are edited separately and are never shown in full here. Changing the
          mobile number is checked against every other profile.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Full name"
            required
            value={form.fullName}
            onChange={(event) => set('fullName')(event.target.value)}
            error={errors.fullName}
            containerClassName="sm:col-span-2"
            autoFocus
          />
          <Input
            label="Father's name"
            value={form.fatherName}
            onChange={(event) => set('fatherName')(event.target.value)}
          />
          <Input
            label="Mother's name"
            value={form.motherName}
            onChange={(event) => set('motherName')(event.target.value)}
          />
          <Input
            label="Date of birth"
            type="date"
            value={form.dateOfBirth}
            onChange={(event) => set('dateOfBirth')(event.target.value)}
            max={new Date().toISOString().slice(0, 10)}
            error={errors.dateOfBirth}
          />
          <Select
            label="Gender"
            placeholder="Select"
            value={form.gender}
            onChange={(event) => set('gender')(event.target.value)}
            options={Object.values(GENDER).map((value) => ({
              value,
              label: value.charAt(0).toUpperCase() + value.slice(1),
            }))}
          />
          <Input
            label="Mobile"
            required
            value={form.mobile}
            onChange={(event) => set('mobile')(event.target.value)}
            error={errors.mobile}
            inputMode="tel"
            prefix={<Icons.Phone size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />}
          />
          <Input
            label="WhatsApp"
            value={form.whatsapp}
            onChange={(event) => set('whatsapp')(event.target.value)}
            inputMode="tel"
          />
          <Input
            label="Email"
            type="email"
            required
            value={form.email}
            onChange={(event) => set('email')(event.target.value)}
            error={errors.email}
            containerClassName="sm:col-span-2"
            prefix={<Icons.Mail size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />}
          />
          <Input
            label="Address"
            value={form.addressLine}
            onChange={(event) => set('addressLine')(event.target.value)}
            containerClassName="sm:col-span-2"
          />
          <Input label="City" value={form.city} onChange={(event) => set('city')(event.target.value)} />
          <Input label="State" value={form.state} onChange={(event) => set('state')(event.target.value)} />
          <Input
            label="Country"
            value={form.country}
            onChange={(event) => set('country')(event.target.value)}
          />
          <Input
            label="PIN code"
            value={form.pincode}
            onChange={(event) => set('pincode')(event.target.value)}
            error={errors.pincode}
            inputMode="numeric"
          />
          <Input
            label="Nationality"
            value={form.nationality}
            onChange={(event) => set('nationality')(event.target.value)}
            containerClassName="sm:col-span-2"
          />
        </div>
      </div>
    </Dialog>
  );
}
