import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_DEPARTMENTS,
  EMPLOYEE_STATUS_META,
  EMPLOYMENT_TYPE_LABELS,
  type EmployeeStatus,
  type EmploymentType,
} from '@nbr/shared';
import { Button } from '@/components/ui/Button';
import { Card, QueryError, StatCard } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Badge';
import { Column, DataTable } from '@/components/ui/DataTable';
import { Input, Select } from '@/components/ui/Field';
import { PageHeader } from '@/components/layout/AppShell';
import { RowActions } from '@/components/ui/RowActions';

import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { formatDate, initials } from '@/lib/format';
import { ICON_STROKE, Icons } from '@/lib/icons';
import { DeleteEmployeeDialog } from './DeleteEmployeeDialog';
import { EmployeeDialog } from './EmployeeDialog';
import { employeeKeys, type EmployeeRow, type EmployeeStats } from './types';

/** Page sizes offered under the table. */
const PAGE_SIZES = [10, 25, 50] as const;

/**
 * The staff directory.
 *
 * Separate from Users & Roles, which governs who can sign in. Plenty of
 * employees have no login at all, and a person's employment record outlives any
 * account they were given.
 *
 * A row opens the full profile at `/employees/:id` rather than a dialog. The
 * profile carries attendance, leave and payroll now — far more than a modal can
 * hold, and all of it worth linking to directly.
 */
export default function EmployeesPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { can } = useAuth();

  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [status, setStatus] = useState('');
  const [employmentType, setEmploymentType] = useState('');
  const [view, setView] = useState<'table' | 'grid'>('table');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(25);
  const [editing, setEditing] = useState<EmployeeRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<EmployeeRow | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: employeeKeys.list(search, department, status, employmentType),
    queryFn: ({ signal }) =>
      api.get<{ items: EmployeeRow[] }>(
        '/employees',
        {
          q: search || undefined,
          department: department || undefined,
          status: status || undefined,
          employmentType: employmentType || undefined,
        },
        signal,
      ),
  });

  const { data: stats } = useQuery({
    queryKey: employeeKeys.stats(),
    queryFn: ({ signal }) => api.get<EmployeeStats>('/employees/stats', undefined, signal),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['employees'] });

  const items = data?.items ?? [];

  /**
   * Paging is done here rather than on the server.
   *
   * The directory is a few hundred people at most and the endpoint already
   * returns the filtered set in one query; asking the API for a slice would add
   * a round trip per page for a list that fits comfortably in memory. The
   * applicant list, at twelve thousand rows, is the one that pages server-side.
   */
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = useMemo(
    () => items.slice(currentPage * pageSize, currentPage * pageSize + pageSize),
    [items, currentPage, pageSize],
  );

  function resetPage<T>(set: (value: T) => void) {
    return (value: T) => {
      setPage(0);
      set(value);
    };
  }

  const filtersApplied = Boolean(search || department || status || employmentType);

  const columns: ReadonlyArray<Column<EmployeeRow>> = [
    {
      key: 'employee',
      header: 'Employee',
      maxWidth: 'none',
      render: (employee) => (
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-tint text-2xs font-semibold text-brand">
            {initials(employee.fullName)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink">{employee.fullName}</p>
            <p className="tabular truncate font-mono text-[11px] text-ink-3">
              {employee.employeeCode}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'designation',
      header: 'Designation',
      hideBelow: 'md',
      truncate: true,
      render: (employee) => (
        <span className="text-xs text-ink-2">{employee.designation ?? '—'}</span>
      ),
    },
    {
      key: 'department',
      header: 'Department',
      hideBelow: 'sm',
      render: (employee) =>
        employee.department ? <Chip tone="slate">{employee.department}</Chip> : <span className="text-xs text-ink-4">—</span>,
    },
    {
      key: 'contact',
      header: 'Contact',
      hideBelow: 'lg',
      truncate: true,
      render: (employee) => (
        <div className="min-w-0">
          <p className="tabular truncate text-xs text-ink-2">{employee.mobile}</p>
          <p className="truncate text-[11px] text-ink-3">{employee.workEmail ?? '—'}</p>
        </div>
      ),
    },
    {
      key: 'reportsTo',
      header: 'Reporting manager',
      hideBelow: 'xl',
      truncate: true,
      render: (employee) =>
        employee.reportsToName ? (
          <div className="min-w-0">
            <p className="truncate text-xs text-ink-2">{employee.reportsToName}</p>
            {employee.reportsToDesignation ? (
              <p className="truncate text-[11px] text-ink-3">{employee.reportsToDesignation}</p>
            ) : null}
          </div>
        ) : (
          <span className="text-xs text-ink-4">—</span>
        ),
    },
    {
      key: 'joinedOn',
      header: 'Joined',
      hideBelow: 'lg',
      width: '110px',
      render: (employee) => (
        <span className="tabular text-xs text-ink-2">
          {employee.joinedOn ? formatDate(employee.joinedOn) : '—'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '130px',
      render: (employee) => {
        const meta = EMPLOYEE_STATUS_META[employee.status as EmployeeStatus];
        return <Chip tone={meta?.tone ?? 'slate'}>{meta?.label ?? employee.status}</Chip>;
      },
    },
    {
      key: 'actions',
      header: '',
      width: '52px',
      align: 'right',
      render: (employee) => (
        // The menu sits inside a clickable row, so its own clicks must not also
        // navigate — otherwise "Delete record" opens the profile behind the
        // confirmation.
        <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
          <RowActions
            label={`Actions for ${employee.fullName}`}
            actions={[
              {
                id: 'view',
                label: 'View profile',
                icon: Icons.User,
                onSelect: () => navigate(`/employees/${employee.id}`),
              },
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
      ),
    },
  ];

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

      {/* Headline counts, from one aggregate query rather than counting the
          page in the browser — the cards describe the whole directory, not
          whatever the current filter happens to show. */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard
          label="Total employees"
          value={stats?.total ?? 0}
          icon={Icons.Users}
          tone="indigo"
          loading={!stats}
        />
        <StatCard
          label="Active"
          value={stats?.active ?? 0}
          hint={stats ? `${stats.activePercent}% of the directory` : undefined}
          icon={Icons.UserRoundCheck}
          tone="green"
          loading={!stats}
        />
        <StatCard
          label="On leave"
          value={stats?.onLeave ?? 0}
          hint={stats ? `${stats.onLeavePercent}% of the directory` : undefined}
          icon={Icons.CalendarDays}
          tone="orange"
          loading={!stats}
        />
        <StatCard
          label="Joined this month"
          value={stats?.newJoiners ?? 0}
          icon={Icons.UserPlus}
          tone="blue"
          loading={!stats}
        />
        <StatCard
          label="Departments"
          value={stats?.departments ?? 0}
          icon={Icons.Building2}
          tone="slate"
          loading={!stats}
        />
      </div>

      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-2">
          <Input
            label="Search"
            value={search}
            onChange={(event) => resetPage(setSearch)(event.target.value)}
            placeholder="Name, ID, designation or phone"
            prefix={<Icons.Search size={14} strokeWidth={ICON_STROKE} />}
            containerClassName="min-w-[220px] flex-1"
          />
          <Select
            label="Department"
            value={department}
            onChange={(event) => resetPage(setDepartment)(event.target.value)}
            placeholder="All departments"
            options={DEFAULT_DEPARTMENTS.map((name) => ({ value: name, label: name }))}
            containerClassName="w-44"
          />
          <Select
            label="Status"
            value={status}
            onChange={(event) => resetPage(setStatus)(event.target.value)}
            placeholder="Any status"
            options={Object.entries(EMPLOYEE_STATUS_META).map(([value, meta]) => ({
              value,
              label: meta.label,
            }))}
            containerClassName="w-36"
          />
          <Select
            label="Type"
            value={employmentType}
            onChange={(event) => resetPage(setEmploymentType)(event.target.value)}
            placeholder="Any type"
            options={Object.entries(EMPLOYMENT_TYPE_LABELS).map(([value, label]) => ({
              value,
              label,
            }))}
            containerClassName="w-36"
          />

          {filtersApplied ? (
            <Button
              variant="ghost"
              icon={Icons.X}
              onClick={() => {
                setSearch('');
                setDepartment('');
                setStatus('');
                setEmploymentType('');
                setPage(0);
              }}
            >
              Clear
            </Button>
          ) : null}

          {/* Table for scanning a hundred people, cards for browsing a team. */}
          <div className="ml-auto flex items-center gap-1 rounded-lg border border-line bg-white p-0.5">
            {(
              [
                { id: 'table', label: 'Table view', icon: Icons.ListChecks },
                { id: 'grid', label: 'Card view', icon: Icons.LayoutGrid },
              ] as const
            ).map((option) => (
              <button
                key={option.id}
                type="button"
                aria-label={option.label}
                aria-pressed={view === option.id}
                onClick={() => setView(option.id)}
                className={cn(
                  'grid h-8 w-8 place-items-center rounded-md transition-colors',
                  view === option.id
                    ? 'bg-brand-tint text-brand'
                    : 'text-ink-3 hover:bg-slate2-tint hover:text-ink',
                )}
              >
                <option.icon size={15} strokeWidth={ICON_STROKE} />
              </button>
            ))}
          </div>
        </div>
      </Card>

      {isError ? (
        <Card>
          <QueryError title="Couldn't load the directory" onRetry={() => void refetch()} />
        </Card>
      ) : view === 'grid' ? (
        <EmployeeCards
          employees={visible}
          loading={isLoading}
          onOpen={(employee) => navigate(`/employees/${employee.id}`)}
        />
      ) : (
        <Card padded={false}>
          <DataTable
            columns={columns}
            rows={visible}
            rowKey={(employee) => employee.id}
            loading={isLoading}
            onRowClick={(employee) => navigate(`/employees/${employee.id}`)}
            emptyState={
              <p className="py-12 text-center text-sm text-ink-3">
                {filtersApplied
                  ? 'No employees match these filters.'
                  : 'No employees yet. Add one to start the directory.'}
              </p>
            }
          />
        </Card>
      )}

      {!isError && !isLoading && items.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-white px-4 py-2.5 shadow-card">
          <p className="tabular text-xs text-ink-3">
            Showing{' '}
            <span className="font-semibold text-ink-2">
              {currentPage * pageSize + 1}–{currentPage * pageSize + visible.length}
            </span>{' '}
            of <span className="font-semibold text-ink-2">{items.length}</span>{' '}
            {items.length === 1 ? 'employee' : 'employees'}
          </p>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-ink-3">
              Rows
              <select
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setPage(0);
                }}
                className="h-7 cursor-pointer rounded-md border border-line bg-white px-1.5 text-xs"
              >
                {PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage((value) => Math.max(0, value - 1))}
                disabled={currentPage === 0}
                aria-label="Previous page"
                className="grid h-7 w-7 place-items-center rounded-md border border-line bg-white text-ink-2 transition-colors hover:bg-canvas disabled:opacity-35"
              >
                <Icons.ChevronLeft size={14} strokeWidth={ICON_STROKE} />
              </button>
              <span className="tabular px-1 text-xs text-ink-3">
                {currentPage + 1} / {pageCount}
              </span>
              <button
                type="button"
                onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
                disabled={currentPage >= pageCount - 1}
                aria-label="Next page"
                className="grid h-7 w-7 place-items-center rounded-md border border-line bg-white text-ink-2 transition-colors hover:bg-canvas disabled:opacity-35"
              >
                <Icons.ChevronRight size={14} strokeWidth={ICON_STROKE} />
              </button>
            </div>
          </div>
        </div>
      ) : null}

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

/** The card view — the same rows, laid out for browsing rather than scanning. */
function EmployeeCards({
  employees,
  loading,
  onOpen,
}: {
  employees: readonly EmployeeRow[];
  loading: boolean;
  onOpen: (employee: EmployeeRow) => void;
}) {
  if (loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="skeleton h-40" />
        ))}
      </div>
    );
  }

  if (employees.length === 0) {
    return (
      <Card>
        <p className="py-10 text-center text-sm text-ink-3">No employees match.</p>
      </Card>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {employees.map((employee) => {
        const meta = EMPLOYEE_STATUS_META[employee.status as EmployeeStatus];
        return (
          <button
            key={employee.id}
            type="button"
            onClick={() => onOpen(employee)}
            className="rounded-card border border-line bg-white p-4 text-left shadow-card transition-shadow hover:border-brand-ring hover:shadow-raised"
          >
            <div className="flex items-start gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-tint text-sm font-semibold text-brand">
                {initials(employee.fullName)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{employee.fullName}</p>
                <p className="truncate text-[11px] text-ink-3">{employee.designation ?? '—'}</p>
              </div>
              <Chip tone={meta?.tone ?? 'slate'}>{meta?.label ?? employee.status}</Chip>
            </div>

            <p className="tabular mt-3 rounded-md bg-canvas px-2 py-1 font-mono text-xs font-bold text-navy">
              {employee.employeeCode}
            </p>

            <dl className="mt-2 space-y-1 text-[11px]">
              <div className="flex justify-between gap-2">
                <dt className="text-ink-3">Department</dt>
                <dd className="truncate text-ink-2">{employee.department ?? '—'}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink-3">Reports to</dt>
                <dd className="truncate text-ink-2">{employee.reportsToName ?? '—'}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink-3">Joined</dt>
                <dd className="text-ink-2">
                  {employee.joinedOn ? formatDate(employee.joinedOn) : '—'}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink-3">Type</dt>
                <dd className="text-ink-2">
                  {EMPLOYMENT_TYPE_LABELS[employee.employmentType as EmploymentType] ??
                    employee.employmentType}
                </dd>
              </div>
            </dl>
          </button>
        );
      })}
    </div>
  );
}
