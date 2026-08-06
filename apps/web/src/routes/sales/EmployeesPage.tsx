import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  DEFAULT_DEPARTMENTS,
  EMPLOYEE_STATUS,
  EMPLOYEE_STATUS_META,
  EMPLOYMENT_TYPE,
  EMPLOYMENT_TYPE_LABELS,
  type EmployeeStatus,
} from '@nbr/shared';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, QueryError } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Badge';
import { Dialog } from '@/components/ui/Dialog';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/Field';
import { PageHeader } from '@/components/layout/AppShell';
import { RowActions } from '@/components/ui/RowActions';

import { useAuth } from '@/hooks/useAuth';
import { ApiError, api } from '@/lib/api-client';
import { formatDate, initials } from '@/lib/format';
import { Icons } from '@/lib/icons';

interface EmployeeRow {
  id: string;
  employeeCode: string;
  fullName: string;
  workEmail: string | null;
  mobile: string;
  department: string | null;
  designation: string | null;
  employmentType: string;
  status: string;
  joinedOn: string | null;
  workLocation: string | null;
  userId: string | null;
  reportsToEmployeeId: string | null;
}

interface EmployeeDetail extends EmployeeRow {
  personalEmail: string | null;
  alternatePhone: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;
  exitedOn: string | null;
  notes: string | null;
  reportsToName: string | null;
  reports: Array<{ id: string; fullName: string; designation: string | null }>;
}

/**
 * The staff directory.
 *
 * Separate from Users & Roles, which governs who can sign in. Plenty of
 * employees have no login at all, and a person's employment record outlives any
 * account they were given.
 */
export default function EmployeesPage() {
  const queryClient = useQueryClient();
  const { can } = useAuth();

  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<EmployeeRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<EmployeeRow | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['employees', search, department, status],
    queryFn: ({ signal }) =>
      api.get<{ items: EmployeeRow[] }>(
        '/employees',
        { q: search || undefined, department: department || undefined, status: status || undefined },
        signal,
      ),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['employees'] });

  return (
    <div className="p-4 sm:p-5">
      <PageHeader
        title="Employees"
        subtitle="Everyone who works here, whether or not they have a login."
        actions={
          can('employees:create') ? (
            <Button variant="primary" icon={Icons.Plus} onClick={() => setCreating(true)}>
              Add employee
            </Button>
          ) : undefined
        }
      />

      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-2">
          <Input
            label="Search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name, code, designation or phone"
            containerClassName="w-64"
          />
          <Select
            label="Department"
            value={department}
            onChange={(event) => setDepartment(event.target.value)}
            placeholder="All departments"
            options={DEFAULT_DEPARTMENTS.map((name) => ({ value: name, label: name }))}
            containerClassName="w-48"
          />
          <Select
            label="Status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            placeholder="Any status"
            options={Object.entries(EMPLOYEE_STATUS_META).map(([value, meta]) => ({
              value,
              label: meta.label,
            }))}
            containerClassName="w-40"
          />
        </div>
      </Card>

      {isError ? (
        <Card>
          <QueryError title="Couldn't load the directory" onRetry={() => void refetch()} />
        </Card>
      ) : isLoading ? (
        <div className="skeleton h-64" />
      ) : (data?.items.length ?? 0) === 0 ? (
        <Card>
          <p className="py-10 text-center text-sm text-ink-3">
            No employees match. Add one to start the directory.
          </p>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data!.items.map((employee) => {
            const meta = EMPLOYEE_STATUS_META[employee.status as EmployeeStatus];
            return (
              <Card key={employee.id} className="flex flex-col">
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-tint text-xs font-semibold text-brand">
                    {initials(employee.fullName)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{employee.fullName}</p>
                    <p className="truncate text-[11px] text-ink-3">
                      {employee.designation ?? '—'}
                      {employee.department ? ` · ${employee.department}` : ''}
                    </p>
                  </div>
                  <Chip tone={meta?.tone ?? 'slate'}>{meta?.label ?? employee.status}</Chip>
                </div>

                <dl className="mt-3 space-y-1 text-[11px]">
                  <div className="flex justify-between gap-2">
                    <dt className="text-ink-3">Employee ID</dt>
                    <dd className="tabular font-medium text-ink">{employee.employeeCode}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-ink-3">Mobile</dt>
                    <dd className="tabular text-ink-2">{employee.mobile}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-ink-3">Joined</dt>
                    <dd className="text-ink-2">
                      {employee.joinedOn ? formatDate(employee.joinedOn) : '—'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-ink-3">Login</dt>
                    <dd className="text-ink-2">{employee.userId ? 'Linked' : 'None'}</dd>
                  </div>
                </dl>

                <div className="mt-3 flex items-center justify-between border-t border-line pt-2.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={Icons.FileText}
                    onClick={() => setViewing(employee.id)}
                  >
                    Details
                  </Button>
                  <RowActions
                    label={`Actions for ${employee.fullName}`}
                    actions={[
                      ...(can('employees:edit')
                        ? [
                            {
                              id: 'edit',
                              label: 'Edit employee',
                              icon: Icons.PenLine,
                              onSelect: () => setEditing(employee),
                            },
                          ]
                        : []),
                      ...(can('employees:delete')
                        ? [
                            {
                              id: 'delete',
                              label: 'Delete record',
                              icon: Icons.Trash2,
                              danger: true,
                              onSelect: () => setDeleting(employee),
                            },
                          ]
                        : []),
                    ]}
                  />
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {creating || editing ? (
        <EmployeeDialog
          employeeId={editing?.id ?? null}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={invalidate}
        />
      ) : null}

      {viewing ? (
        <EmployeeDetailDialog employeeId={viewing} onClose={() => setViewing(null)} />
      ) : null}

      {deleting ? (
        <DeleteEmployeeDialog
          employee={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={invalidate}
        />
      ) : null}
    </div>
  );
}

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

function EmployeeDialog({
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

  const { data: colleagues } = useQuery({
    queryKey: ['employees', 'all-for-manager'],
    queryFn: ({ signal }) => api.get<{ items: EmployeeRow[] }>('/employees', { limit: 200 }, signal),
  });

  // Load the existing record once, then leave the form alone so typing is not
  // overwritten by a background refetch.
  useQuery({
    queryKey: ['employee', employeeId],
    enabled: !isNew && !loaded,
    queryFn: async ({ signal }) => {
      const detail = await api.get<EmployeeDetail>(`/employees/${employeeId}`, undefined, signal);
      setForm({
        ...EMPTY_FORM,
        ...Object.fromEntries(
          Object.entries(detail).map(([key, value]) => [key, value ?? '']),
        ),
        isDirectoryVisible: true,
      } as typeof EMPTY_FORM);
      setLoaded(true);
      return detail;
    },
  });

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const save = useMutation({
    mutationFn: () => {
      // Empty strings are "not provided", not "set to blank" — the API's
      // optional fields would otherwise reject an empty email as malformed.
      const payload: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(form)) {
        if (value === '' || value === null) continue;
        payload[key] = value;
      }
      return isNew
        ? api.post<{ employeeCode: string }>('/employees', payload)
        : api.put(`/employees/${employeeId}`, payload);
    },
    onSuccess: () => {
      toast.success(isNew ? 'Employee added' : 'Employee updated');
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
            disabled={!form.fullName.trim() || form.mobile.trim().length < 10}
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
                label="Employee ID"
                value={form.employeeCode}
                onChange={(event) => set('employeeCode')(event.target.value)}
                hint={isNew ? 'Left blank, one is allocated automatically.' : undefined}
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
              Contact & emergency
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
        </div>
      )}
    </Dialog>
  );
}

function EmployeeDetailDialog({
  employeeId,
  onClose,
}: {
  employeeId: string;
  onClose: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['employee', employeeId],
    queryFn: ({ signal }) => api.get<EmployeeDetail>(`/employees/${employeeId}`, undefined, signal),
  });

  const Row = ({ label, value }: { label: string; value: string | null | undefined }) => (
    <div className="flex justify-between gap-3 border-b border-line/60 py-1.5 text-xs last:border-0">
      <dt className="text-ink-3">{label}</dt>
      <dd className="text-right font-medium text-ink">{value || '—'}</dd>
    </div>
  );

  return (
    <Dialog
      open
      onOpenChange={onClose}
      title={data?.fullName ?? 'Employee'}
      description={data ? `${data.employeeCode} · ${data.designation ?? 'No designation'}` : ''}
      size="lg"
      footer={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      {isLoading || !data ? (
        <div className="skeleton h-64" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader title="Employment" icon={Icons.Shield} />
            <dl>
              <Row label="Department" value={data.department} />
              <Row label="Designation" value={data.designation} />
              <Row
                label="Type"
                value={
                  EMPLOYMENT_TYPE_LABELS[
                    data.employmentType as keyof typeof EMPLOYMENT_TYPE_LABELS
                  ]
                }
              />
              <Row
                label="Status"
                value={EMPLOYEE_STATUS_META[data.status as EmployeeStatus]?.label}
              />
              <Row label="Joined" value={data.joinedOn ? formatDate(data.joinedOn) : null} />
              <Row label="Exited" value={data.exitedOn ? formatDate(data.exitedOn) : null} />
              <Row label="Location" value={data.workLocation} />
              <Row label="Reports to" value={data.reportsToName} />
              <Row label="Login account" value={data.userId ? 'Linked' : 'None'} />
            </dl>
          </Card>

          <Card>
            <CardHeader title="Contact" icon={Icons.Phone} />
            <dl>
              <Row label="Mobile" value={data.mobile} />
              <Row label="Alternate" value={data.alternatePhone} />
              <Row label="Work email" value={data.workEmail} />
              <Row label="Personal email" value={data.personalEmail} />
              <Row
                label="Address"
                value={[data.addressLine, data.city, data.state, data.pincode]
                  .filter(Boolean)
                  .join(', ')}
              />
              <Row label="Date of birth" value={data.dateOfBirth ? formatDate(data.dateOfBirth) : null} />
            </dl>
          </Card>

          <Card>
            <CardHeader title="Emergency contact" icon={Icons.AlertCircle} />
            <dl>
              <Row label="Name" value={data.emergencyContactName} />
              <Row label="Phone" value={data.emergencyContactPhone} />
              <Row label="Relationship" value={data.emergencyContactRelation} />
            </dl>
          </Card>

          <Card>
            <CardHeader title={`Direct reports (${data.reports.length})`} icon={Icons.Users} />
            {data.reports.length === 0 ? (
              <p className="py-3 text-xs text-ink-3">Nobody reports to this person.</p>
            ) : (
              <ul className="space-y-1">
                {data.reports.map((person) => (
                  <li key={person.id} className="text-xs text-ink-2">
                    {person.fullName}
                    {person.designation ? (
                      <span className="text-ink-3"> — {person.designation}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {data.notes ? (
            <Card className="sm:col-span-2">
              <CardHeader title="Notes" icon={Icons.StickyNote} />
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-ink-2">{data.notes}</p>
            </Card>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}

/**
 * Deleting a directory record.
 *
 * Rarely the right action — an employee who has left is marked Exited, because
 * audit entries and the records they handled all point at them. The server
 * refuses outright while anyone still reports to them.
 */
function DeleteEmployeeDialog({
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
      api.delete(`/employees/${employee.id}${reason ? `?reason=${encodeURIComponent(reason)}` : ''}`),
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
