import * as Tabs from '@radix-ui/react-tabs';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  EMPLOYEE_STATUS_META,
  EMPLOYMENT_TYPE_LABELS,
  isOnProbation,
  tenureLabel,
  type EmployeeStatus,
  type EmploymentType,
} from '@nbr/shared';
import { Chip } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState, QueryError } from '@/components/ui/Card';
import { RowActions } from '@/components/ui/RowActions';
import { useAuth } from '@/hooks/useAuth';
import { api, ApiError } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { formatDate, initials } from '@/lib/format';
import { ICON_STROKE, Icons, type LucideIcon } from '@/lib/icons';
import { DeleteEmployeeDialog } from './DeleteEmployeeDialog';
import { EmployeeDialog } from './EmployeeDialog';
import { OnboardingDocuments } from './OnboardingDocuments';
import { ActivityTab } from './profile/ActivityTab';
import { AttendanceTab } from './profile/AttendanceTab';
import { EmploymentTab } from './profile/EmploymentTab';
import { LeaveTab } from './profile/LeaveTab';
import { OverviewTab } from './profile/OverviewTab';
import { PayrollTab } from './profile/PayrollTab';
import { PerformanceTab } from './profile/PerformanceTab';
import { TimelineTab } from './profile/TimelineTab';
import { employeeKeys, type EmployeeDetail } from './types';

const TABS: ReadonlyArray<{ value: string; label: string; icon: LucideIcon }> = [
  { value: 'overview', label: 'Overview', icon: Icons.LayoutDashboard },
  { value: 'employment', label: 'Employment', icon: Icons.Briefcase },
  { value: 'attendance', label: 'Attendance', icon: Icons.CalendarCheck2 },
  { value: 'leave', label: 'Leave', icon: Icons.CalendarDays },
  { value: 'payroll', label: 'Payroll', icon: Icons.Wallet },
  { value: 'performance', label: 'Performance', icon: Icons.TrendingUp },
  { value: 'documents', label: 'Documents', icon: Icons.FileText },
  { value: 'activity', label: 'Activity', icon: Icons.History },
  { value: 'timeline', label: 'Timeline', icon: Icons.ListChecks },
];

/**
 * The employee profile — a full page, not a dialog.
 *
 * Attendance, leave and payroll each carry their own month, their own filters
 * and their own dialogs. A modal could hold the joining file and little else,
 * and it could not be linked to; a manager sending "have a look at Priya's
 * leave" needs a URL.
 *
 * Each tab fetches its own data on mount, so opening the profile costs one
 * request for the record plus one for the overview, and nothing for the six
 * tabs nobody opened.
 */
export default function EmployeeProfilePage() {
  const { id = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { can } = useAuth();

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const activeTab = searchParams.get('tab') ?? 'overview';

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: employeeKeys.detail(id),
    queryFn: ({ signal }) => api.get<EmployeeDetail>(`/employees/${id}`, undefined, signal),
    enabled: Boolean(id),
  });

  function setTab(tab: string) {
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    setSearchParams(next, { replace: true });
  }

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: employeeKeys.detail(id) });
    void queryClient.invalidateQueries({ queryKey: ['employees'] });
  };

  /**
   * A failed load is not the same as a missing employee.
   *
   * A 500 or a restarting API told as "not found" would have someone hunting
   * for a record that was never deleted.
   */
  if (isError) {
    const missing = error instanceof ApiError && error.status === 404;

    return (
      <div className="p-5">
        {missing ? (
          <EmptyState
            icon={Icons.Search}
            title="Employee not found"
            description="This record may have been removed, or the link is wrong."
            action={
              <Link to="/employees" className="text-xs font-semibold text-brand hover:underline">
                Back to Employees
              </Link>
            }
          />
        ) : (
          <Card>
            <QueryError
              title="Couldn't load this profile"
              description={
                error instanceof ApiError
                  ? error.message
                  : 'The server did not respond. It may be restarting.'
              }
              onRetry={() => void refetch()}
            />
          </Card>
        )}
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-4 p-4 sm:p-5">
        <div className="skeleton h-5 w-64" />
        <div className="skeleton h-28" />
        <div className="skeleton h-72" />
      </div>
    );
  }

  const employee = data;
  const statusMeta = EMPLOYEE_STATUS_META[employee.status as EmployeeStatus];
  const probation = isOnProbation(employee.probationEndsOn);
  const tenure = tenureLabel(employee.joinedOn);

  return (
    <div className="p-4 sm:p-5">
      {/* Breadcrumb — the profile sits two levels deep and the sidebar only
          marks the section, not where inside it you are. */}
      <nav aria-label="Breadcrumb" className="mb-2">
        <ol className="flex flex-wrap items-center gap-1 text-xs text-ink-3">
          <li>
            <Link to="/" className="transition-colors hover:text-brand">
              Dashboard
            </Link>
          </li>
          <li aria-hidden>
            <Icons.ChevronRight size={12} strokeWidth={ICON_STROKE} />
          </li>
          <li>
            <Link to="/employees" className="transition-colors hover:text-brand">
              Employees
            </Link>
          </li>
          <li aria-hidden>
            <Icons.ChevronRight size={12} strokeWidth={ICON_STROKE} />
          </li>
          <li className="truncate font-medium text-ink-2" aria-current="page">
            {employee.fullName}
          </li>
        </ol>
      </nav>

      <Link
        to="/employees"
        className="mb-4 inline-flex items-center gap-1 text-xs font-medium text-ink-3 transition-colors hover:text-brand"
      >
        <Icons.ChevronLeft size={14} strokeWidth={ICON_STROKE} />
        Back to Employees
      </Link>

      {/* ── Identity header ─────────────────────────────────────────────── */}
      <Card className="mb-4">
        <div className="flex flex-wrap items-start gap-4">
          <span className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-navy text-lg font-bold text-white">
            {initials(employee.fullName)}
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-bold tracking-tight text-ink">{employee.fullName}</h1>
              <Chip tone={statusMeta?.tone ?? 'slate'}>
                {statusMeta?.label ?? employee.status}
              </Chip>
              {/* Probation changes what a manager can do — confirm, extend or
                  let go — so it belongs beside the status, not buried in
                  Employment. */}
              {probation ? <Chip tone="orange">On probation</Chip> : null}
            </div>

            <p className="mt-0.5 text-xs text-ink-3">{employee.designation ?? 'Designation not set'}</p>

            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
              <HeaderFact icon={Icons.ScanBarcode} value={employee.employeeCode} mono />
              <HeaderFact icon={Icons.Building2} value={employee.department ?? '—'} />
              <HeaderFact
                icon={Icons.Briefcase}
                value={
                  EMPLOYMENT_TYPE_LABELS[employee.employmentType as EmploymentType] ??
                  employee.employmentType
                }
              />
              <HeaderFact
                icon={Icons.CalendarClock}
                value={
                  employee.joinedOn
                    ? `Joined ${formatDate(employee.joinedOn)}${tenure ? ` · ${tenure}` : ''}`
                    : 'Joining date not set'
                }
              />
              <HeaderFact
                icon={Icons.UserRoundCheck}
                value={
                  employee.reportsToEmployeeId && employee.reportsToName ? (
                    <Link
                      to={`/employees/${employee.reportsToEmployeeId}`}
                      className="font-medium text-brand hover:underline"
                    >
                      {employee.reportsToName}
                    </Link>
                  ) : (
                    'No reporting manager'
                  )
                }
              />
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {can('employees:edit') ? (
              <Button variant="secondary" icon={Icons.PenLine} onClick={() => setEditOpen(true)}>
                Edit employee
              </Button>
            ) : null}
            <RowActions
              label={`More actions for ${employee.fullName}`}
              actions={[
                {
                  id: 'attendance',
                  label: 'Attendance register',
                  icon: Icons.CalendarCheck2,
                  onSelect: () => setTab('attendance'),
                },
                {
                  id: 'leave',
                  label: 'Leave record',
                  icon: Icons.CalendarDays,
                  onSelect: () => setTab('leave'),
                },
                {
                  id: 'payroll',
                  label: 'Payslips',
                  icon: Icons.Wallet,
                  onSelect: () => setTab('payroll'),
                },
                {
                  id: 'documents',
                  label: 'Documents',
                  icon: Icons.FileText,
                  onSelect: () => setTab('documents'),
                },
                ...(can('employees:delete')
                  ? [
                      {
                        id: 'delete',
                        label: 'Delete record',
                        icon: Icons.Trash2,
                        danger: true,
                        onSelect: () => setDeleteOpen(true),
                      },
                    ]
                  : []),
              ]}
            />
          </div>
        </div>
      </Card>

      {/* ── Tabs ────────────────────────────────────────────────────────── */}
      <Tabs.Root value={activeTab} onValueChange={setTab}>
        <Tabs.List className="scrollbar-slim mb-4 flex w-full min-w-0 gap-1 overflow-x-auto rounded-card border border-line bg-white p-1 shadow-card">
          {TABS.map((tab) => (
            <Tabs.Trigger
              key={tab.value}
              value={tab.value}
              className={cn(
                'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium transition-colors',
                'text-ink-2 hover:bg-slate2-tint hover:text-ink',
                'data-[state=active]:bg-brand-tint data-[state=active]:font-semibold data-[state=active]:text-brand',
              )}
            >
              <tab.icon size={14} strokeWidth={ICON_STROKE} aria-hidden />
              {tab.label}
              {tab.value === 'documents' && employee.documentCount > 0 ? (
                <span className="tabular rounded bg-slate2-tint px-1 text-[9px] font-semibold text-ink-2">
                  {employee.documentCount}
                </span>
              ) : null}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        {/* Radix unmounts inactive panels by default, so each tab's queries run
            when it is first opened rather than all nine on page load. */}
        <Tabs.Content value="overview">
          <OverviewTab employee={employee} onOpenTab={setTab} />
        </Tabs.Content>
        <Tabs.Content value="employment">
          <EmploymentTab employee={employee} />
        </Tabs.Content>
        <Tabs.Content value="attendance">
          <AttendanceTab employeeId={employee.id} />
        </Tabs.Content>
        <Tabs.Content value="leave">
          <LeaveTab employeeId={employee.id} />
        </Tabs.Content>
        <Tabs.Content value="payroll">
          <PayrollTab employee={employee} />
        </Tabs.Content>
        <Tabs.Content value="performance">
          <PerformanceTab employee={employee} />
        </Tabs.Content>
        <Tabs.Content value="documents">
          <Card padded={false} className="p-4">
            <OnboardingDocuments employeeId={employee.id} />
          </Card>
        </Tabs.Content>
        <Tabs.Content value="activity">
          <ActivityTab employeeId={employee.id} />
        </Tabs.Content>
        <Tabs.Content value="timeline">
          <TimelineTab employee={employee} />
        </Tabs.Content>
      </Tabs.Root>

      {editOpen ? (
        <EmployeeDialog
          employeeId={employee.id}
          onClose={() => setEditOpen(false)}
          onSaved={invalidate}
        />
      ) : null}

      {deleteOpen ? (
        <DeleteEmployeeDialog
          employee={employee}
          onClose={() => setDeleteOpen(false)}
          onDeleted={invalidate}
        />
      ) : null}
    </div>
  );
}

function HeaderFact({
  icon: Icon,
  value,
  mono,
}: {
  icon: LucideIcon;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <span className="flex items-center gap-1">
      <Icon size={12} strokeWidth={ICON_STROKE} className="shrink-0 text-ink-3" aria-hidden />
      <span className={cn(mono && 'tabular font-mono font-semibold')}>{value}</span>
    </span>
  );
}
