import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_DEPARTMENTS,
  EMPLOYEE_STATUS_META,
  type EmployeeStatus,
} from '@nbr/shared';
import { Button } from '@/components/ui/Button';
import { Card, QueryError } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Badge';
import { Input, Select } from '@/components/ui/Field';
import { PageHeader } from '@/components/layout/AppShell';
import { RowActions } from '@/components/ui/RowActions';

import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api-client';
import { formatDate, initials } from '@/lib/format';
import { Icons } from '@/lib/icons';
import { DeleteEmployeeDialog } from './DeleteEmployeeDialog';
import { EmployeeDetailDialog } from './EmployeeDetailDialog';
import { EmployeeDialog } from './EmployeeDialog';
import { employeeKeys, type EmployeeRow } from './types';

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
    queryKey: employeeKeys.list(search, department, status),
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
            placeholder="Name, ID, designation or phone"
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

                {/* The ID reads as an identifier rather than a table cell —
                    it is what payroll and attendance quote. */}
                <p className="tabular mt-3 rounded-md bg-canvas px-2 py-1 font-mono text-xs font-bold text-navy">
                  {employee.employeeCode}
                </p>

                <dl className="mt-2 space-y-1 text-[11px]">
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
        <EmployeeDetailDialog
          employeeId={viewing}
          onClose={() => setViewing(null)}
          onEdit={
            can('employees:edit')
              ? () => {
                  const employee = data?.items.find((row) => row.id === viewing);
                  setViewing(null);
                  if (employee) setEditing(employee);
                }
              : undefined
          }
        />
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
