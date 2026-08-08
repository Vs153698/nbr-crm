import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  DEFAULT_DEPARTMENTS,
  EMPLOYEE_STATUS,
  EMPLOYEE_STATUS_META,
  EMPLOYMENT_TYPE,
  EMPLOYMENT_TYPE_LABELS,
} from '@nbr/shared';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/Field';
import { ApiError, api } from '@/lib/api-client';
import { ICON_STROKE, Icons } from '@/lib/icons';
import { employeeKeys, type EmployeeDetail, type EmployeeRow } from './types';

const EMPTY_FORM = {
  fullName: '',
  employeeCode: '',
  mobile: '',
  alternatePhone: '',
  workEmail: '',
  personalEmail: '',
  dateOfBirth: '',
  department: '',
  designation: '',
  employmentType: EMPLOYMENT_TYPE.FULL_TIME as string,
  status: EMPLOYEE_STATUS.ACTIVE as string,
  joinedOn: '',
  exitedOn: '',
  workLocation: '',
  reportsToEmployeeId: '',
  addressLine: '',
  city: '',
  state: '',
  pincode: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
  emergencyContactRelation: '',
  notes: '',
  isDirectoryVisible: true,
};

/** Mirrors `employeeCodeSchema` — the server rejects the same shapes. */
const EMPLOYEE_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9/_-]*$/;

function employeeCodeError(code: string): string | undefined {
  const value = code.trim();
  if (value.length === 0) return undefined;
  if (value.length < 2) return 'An employee ID needs at least 2 characters.';
  if (value.length > 30) return 'Keep it to 30 characters or fewer.';
  if (!EMPLOYEE_CODE_PATTERN.test(value)) return 'Use letters, numbers, and - / _ only.';
  return undefined;
}

export function EmployeeDialog({
  employeeId,
  onClose,
  onSaved,
}: {
  employeeId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = employeeId === null;
  const [form, setForm] = useState(EMPTY_FORM);
  const [loaded, setLoaded] = useState(isNew);
  /**
   * New joiners normally arrive with an ID already decided — printed on the
   * card, quoted by payroll — so the field is typed in. Auto-allocation stays
   * available for the case where HR has not assigned one yet.
   */
  const [autoAllocate, setAutoAllocate] = useState(false);

  const { data: colleagues } = useQuery({
    queryKey: ['employees', 'all-for-manager'],
    queryFn: ({ signal }) => api.get<{ items: EmployeeRow[] }>('/employees', { limit: 200 }, signal),
  });

  const { data: detail } = useQuery({
    queryKey: employeeKeys.detail(employeeId ?? ''),
    enabled: !isNew,
    queryFn: ({ signal }) =>
      api.get<EmployeeDetail>(`/employees/${employeeId}`, undefined, signal),
  });

  /**
   * Fill the form from whatever the query has, once.
   *
   * Deliberately an effect on the *data* rather than work done inside
   * `queryFn`: opening the profile first caches this record, and a cached read
   * never calls `queryFn` — so populating there left the form stuck on its
   * skeleton for anyone who arrived via the profile's Edit button. Guarding on
   * `loaded` is what stops a background refetch overwriting what is being typed.
   */
  useEffect(() => {
    if (loaded || !detail) return;
    setForm({
      ...EMPTY_FORM,
      ...Object.fromEntries(Object.entries(detail).map(([key, value]) => [key, value ?? ''])),
      isDirectoryVisible: true,
    } as typeof EMPTY_FORM);
    setLoaded(true);
  }, [detail, loaded]);

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const codeError = autoAllocate ? undefined : employeeCodeError(form.employeeCode);
  const codeMissing = isNew && !autoAllocate && form.employeeCode.trim().length === 0;

  const save = useMutation({
    mutationFn: () => {
      // Empty strings are "not provided", not "set to blank" — the API's
      // optional fields would otherwise reject an empty email as malformed.
      const payload: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(form)) {
        if (value === '' || value === null) continue;
        // Omitting the code is what asks the server to allocate one.
        if (key === 'employeeCode' && autoAllocate) continue;
        payload[key] = value;
      }
      return isNew
        ? api.post<{ employeeCode: string }>('/employees', payload)
        : api.put(`/employees/${employeeId}`, payload);
    },
    onSuccess: (result: unknown) => {
      const code = (result as { employeeCode?: string } | undefined)?.employeeCode;
      toast.success(
        isNew ? `Employee added${code ? ` — ${code}` : ''}` : 'Employee updated',
      );
      onClose();
      onSaved();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not save the employee'),
  });

  return (
    <Dialog
      open
      onOpenChange={onClose}
      title={isNew ? 'Add employee' : 'Edit employee'}
      description="Directory record. A login account is optional and linked separately."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={
              !form.fullName.trim() ||
              form.mobile.trim().length < 10 ||
              Boolean(codeError) ||
              codeMissing
            }
            onClick={() => save.mutate()}
          >
            {isNew ? 'Add employee' : 'Save changes'}
          </Button>
        </>
      }
    >
      {!loaded ? (
        <div className="skeleton h-72" />
      ) : (
        <div className="space-y-4">
          {/* The ID leads the form because it is the field HR is holding a
              printed card to fill in, and burying it invites a blank. */}
          <section className="rounded-card border border-brand-ring bg-brand-tint/50 p-3">
            <div className="mb-2 flex items-center gap-2">
              <Icons.ScanBarcode
                size={16}
                strokeWidth={ICON_STROKE}
                className="text-brand"
                aria-hidden
              />
              <p className="text-[10px] font-semibold uppercase tracking-wider text-brand">
                Employee ID
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Employee ID"
                required={isNew && !autoAllocate}
                value={autoAllocate ? '' : form.employeeCode}
                disabled={autoAllocate}
                onChange={(event) => set('employeeCode')(event.target.value.toUpperCase())}
                placeholder="NBREMP014"
                error={codeError}
                hint={
                  autoAllocate
                    ? 'The next ID in sequence is allocated when you save.'
                    : 'Type the ID from the joining paperwork. Stored in capitals.'
                }
                className="tabular font-mono"
                autoComplete="off"
                spellCheck={false}
              />
              <div className="flex items-end pb-1.5">
                <Checkbox
                  label="Allocate one automatically"
                  hint="Use when no ID has been assigned yet."
                  checked={autoAllocate}
                  onChange={(event) => setAutoAllocate(event.target.checked)}
                />
              </div>
            </div>
          </section>

          <section>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
              Person
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Full name"
                required
                value={form.fullName}
                onChange={(event) => set('fullName')(event.target.value)}
              />
              <Input
                label="Mobile"
                required
                value={form.mobile}
                onChange={(event) => set('mobile')(event.target.value)}
              />
              <Input
                label="Alternate phone"
                value={form.alternatePhone}
                onChange={(event) => set('alternatePhone')(event.target.value)}
              />
              <Input
                label="Work email"
                type="email"
                value={form.workEmail}
                onChange={(event) => set('workEmail')(event.target.value)}
              />
              <Input
                label="Personal email"
                type="email"
                value={form.personalEmail}
                onChange={(event) => set('personalEmail')(event.target.value)}
              />
              <Input
                type="date"
                label="Date of birth"
                value={form.dateOfBirth}
                onChange={(event) => set('dateOfBirth')(event.target.value)}
              />
            </div>
          </section>

          <section>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
              Employment
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label="Department"
                value={form.department}
                onChange={(event) => set('department')(event.target.value)}
                placeholder="Select a department"
                options={DEFAULT_DEPARTMENTS.map((name) => ({ value: name, label: name }))}
              />
              <Input
                label="Designation"
                value={form.designation}
                onChange={(event) => set('designation')(event.target.value)}
              />
              <Select
                label="Employment type"
                value={form.employmentType}
                onChange={(event) => set('employmentType')(event.target.value)}
                options={Object.values(EMPLOYMENT_TYPE).map((value) => ({
                  value,
                  label: EMPLOYMENT_TYPE_LABELS[value],
                }))}
              />
              <Select
                label="Status"
                value={form.status}
                onChange={(event) => set('status')(event.target.value)}
                options={Object.entries(EMPLOYEE_STATUS_META).map(([value, meta]) => ({
                  value,
                  label: meta.label,
                }))}
              />
              <Input
                type="date"
                label="Joined on"
                value={form.joinedOn}
                onChange={(event) => set('joinedOn')(event.target.value)}
              />
              <Input
                type="date"
                label="Exited on"
                value={form.exitedOn}
                onChange={(event) => set('exitedOn')(event.target.value)}
              />
              <Input
                label="Work location"
                value={form.workLocation}
                onChange={(event) => set('workLocation')(event.target.value)}
              />
              <Select
                label="Reports to"
                value={form.reportsToEmployeeId}
                onChange={(event) => set('reportsToEmployeeId')(event.target.value)}
                placeholder="Nobody"
                options={(colleagues?.items ?? [])
                  // Excluding self keeps the org chart from looping; the server
                  // refuses it too.
                  .filter((person) => person.id !== employeeId)
                  .map((person) => ({
                    value: person.id,
                    label: `${person.fullName}${person.designation ? ` — ${person.designation}` : ''}`,
                  }))}
              />
            </div>
          </section>

          <section>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
              Contact &amp; emergency
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Address"
                value={form.addressLine}
                onChange={(event) => set('addressLine')(event.target.value)}
                containerClassName="sm:col-span-2"
              />
              <Input
                label="City"
                value={form.city}
                onChange={(event) => set('city')(event.target.value)}
              />
              <Input
                label="State"
                value={form.state}
                onChange={(event) => set('state')(event.target.value)}
              />
              <Input
                label="PIN code"
                value={form.pincode}
                onChange={(event) => set('pincode')(event.target.value)}
              />
              <Input
                label="Emergency contact"
                value={form.emergencyContactName}
                onChange={(event) => set('emergencyContactName')(event.target.value)}
              />
              <Input
                label="Emergency phone"
                value={form.emergencyContactPhone}
                onChange={(event) => set('emergencyContactPhone')(event.target.value)}
              />
              <Input
                label="Relationship"
                value={form.emergencyContactRelation}
                onChange={(event) => set('emergencyContactRelation')(event.target.value)}
              />
            </div>
          </section>

          <Textarea
            label="Notes"
            value={form.notes}
            onChange={(event) => set('notes')(event.target.value)}
            rows={2}
          />

          <Checkbox
            label="Show in the directory"
            checked={form.isDirectoryVisible}
            onChange={(event) =>
              setForm((current) => ({ ...current, isDirectoryVisible: event.target.checked }))
            }
          />

          {isNew ? (
            <p className="rounded-lg border border-line bg-canvas px-3 py-2 text-[11px] text-ink-3">
              Onboarding documents — offer letter, ID proof, certificates — are attached from the
              employee&apos;s profile once the record exists.
            </p>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}
