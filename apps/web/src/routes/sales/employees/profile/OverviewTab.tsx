import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  EMPLOYEE_STATUS_META,
  EMPLOYMENT_TYPE_LABELS,
  type EmployeeStatus,
  type EmploymentType,
} from '@nbr/shared';
import { Button } from '@/components/ui/Button';
import { Card, StatCard } from '@/components/ui/Card';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api-client';
import { formatDate, formatMoney, formatRelative, humanise } from '@/lib/format';
import { Icons } from '@/lib/icons';
import { ApplyLeaveDialog } from './ApplyLeaveDialog';
import { GeneratePayslipDialog } from './GeneratePayslipDialog';
import { MarkAttendanceDialog } from './MarkAttendanceDialog';
import { actionLabel, Info, InfoGrid, Section } from './shared';
import { employeeKeys, type EmployeeDetail, type EmployeeOverview } from '../types';

/**
 * The landing tab of the profile.
 *
 * Answers the questions asked about an employee most often — when did they
 * join, where do they sit, what do they earn, are they still on probation —
 * and then the blocks of detail underneath. Everything deeper (a month of
 * attendance, the leave ledger, every payslip) lives in its own tab.
 */
export function OverviewTab({
  employee,
  onOpenTab,
}: {
  employee: EmployeeDetail;
  onOpenTab: (tab: string) => void;
}) {
  const { can } = useAuth();
  const canEdit = can('employees:edit');

  const [attendanceOpen, setAttendanceOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [payslipOpen, setPayslipOpen] = useState(false);

  const { data: overview, isLoading } = useQuery({
    queryKey: employeeKeys.overview(employee.id),
    queryFn: ({ signal }) =>
      api.get<EmployeeOverview>(`/employees/${employee.id}/overview`, undefined, signal),
  });

  const statusMeta = EMPLOYEE_STATUS_META[employee.status as EmployeeStatus];

  return (
    <div className="space-y-4">
      {/* ── Five summary cards ──────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard
          label="Joining date"
          value={employee.joinedOn ? formatDate(employee.joinedOn) : 'Not set'}
          icon={Icons.CalendarClock}
          tone="blue"
        />
        <StatCard
          label="Work location"
          value={employee.workLocation ?? 'Not set'}
          icon={Icons.MapPin}
          tone="indigo"
        />
        <StatCard
          label="Monthly salary"
          value={formatMoney(employee.monthlySalary)}
          hint={employee.ctc ? `CTC ${formatMoney(employee.ctc)}` : undefined}
          icon={Icons.Wallet}
          tone="green"
        />
        <StatCard
          label="Employee status"
          value={statusMeta?.label ?? humanise(employee.status)}
          icon={Icons.ShieldCheck}
          tone={statusMeta?.tone ?? 'slate'}
        />
        <StatCard
          label="Probation ends"
          value={employee.probationEndsOn ? formatDate(employee.probationEndsOn) : 'Not applicable'}
          hint={overview?.onProbation ? 'Currently on probation' : undefined}
          icon={Icons.Clock}
          tone={overview?.onProbation ? 'orange' : 'slate'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* ── Left: the blocks of detail ────────────────────────────────── */}
        <div className="space-y-4 lg:col-span-2">
          <Section title="Personal information" icon={Icons.User}>
            <InfoGrid>
              <Info label="Full name" value={employee.fullName} />
              <Info label="Employee ID" value={<span className="tabular font-mono">{employee.employeeCode}</span>} />
              <Info label="Date of birth" value={employee.dateOfBirth ? formatDate(employee.dateOfBirth) : null} />
              <Info label="Gender" value={employee.gender ? humanise(employee.gender) : null} />
              <Info label="Mobile" value={<span className="tabular">{employee.mobile}</span>} />
              <Info
                label="Alternate phone"
                value={employee.alternatePhone ? <span className="tabular">{employee.alternatePhone}</span> : null}
              />
              <Info label="Work email" value={employee.workEmail} />
              <Info label="Personal email" value={employee.personalEmail} />
              <Info
                label="Address"
                className="sm:col-span-2"
                value={
                  [employee.addressLine, employee.city, employee.state, employee.pincode]
                    .filter(Boolean)
                    .join(', ') || null
                }
              />
            </InfoGrid>
          </Section>

          <Section title="Emergency contact" icon={Icons.PhoneCall}>
            {employee.emergencyContactName || employee.emergencyContactPhone ? (
              <InfoGrid>
                <Info label="Name" value={employee.emergencyContactName} />
                <Info label="Relationship" value={employee.emergencyContactRelation} />
                <Info
                  label="Phone"
                  value={
                    employee.emergencyContactPhone ? (
                      <span className="tabular">{employee.emergencyContactPhone}</span>
                    ) : null
                  }
                />
                <Info label="Address" className="sm:col-span-2" value={employee.emergencyContactAddress} />
              </InfoGrid>
            ) : (
              <p className="py-2 text-sm text-ink-3">
                No emergency contact recorded.{' '}
                {canEdit ? 'Add one from Edit employee — it is the one detail nobody wants to look for on the day.' : null}
              </p>
            )}
          </Section>

          <Section title="Employment summary" icon={Icons.Briefcase}>
            <InfoGrid>
              <Info label="Designation" value={employee.designation} />
              <Info label="Department" value={employee.department} />
              <Info
                label="Employment type"
                value={
                  EMPLOYMENT_TYPE_LABELS[employee.employmentType as EmploymentType] ??
                  humanise(employee.employmentType)
                }
              />
              <Info label="Work location" value={employee.workLocation} />
              <Info label="Reporting manager" value={employee.reportsToName} />
              <Info label="Direct reports" value={employee.reports.length || null} />
              <Info label="Joined on" value={employee.joinedOn ? formatDate(employee.joinedOn) : null} />
              <Info
                label="Probation ends"
                value={employee.probationEndsOn ? formatDate(employee.probationEndsOn) : null}
              />
              <Info label="Login account" value={employee.userId ? 'Linked' : 'None'} />
              <Info label="Exited on" value={employee.exitedOn ? formatDate(employee.exitedOn) : null} />
            </InfoGrid>
          </Section>

          <Section
            title="Documents"
            icon={Icons.FileText}
            action={
              <Button size="sm" variant="ghost" iconRight={Icons.ChevronRight} onClick={() => onOpenTab('documents')}>
                Manage
              </Button>
            }
          >
            {employee.documentCount > 0 ? (
              <p className="text-sm text-ink-2">
                <span className="font-semibold text-ink">{employee.documentCount}</span>{' '}
                {employee.documentCount === 1 ? 'document' : 'documents'} on file. Open the Documents
                tab to view, download or add to the joining file.
              </p>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-ink-3">Not uploaded yet.</p>
                <Button size="sm" variant="secondary" icon={Icons.Upload} onClick={() => onOpenTab('documents')}>
                  Upload
                </Button>
              </div>
            )}
          </Section>
        </div>

        {/* ── Right: this month, activity and the quick actions ─────────── */}
        <div className="space-y-4">
          <Section
            title="This month"
            icon={Icons.CalendarCheck2}
            action={
              <Button size="sm" variant="ghost" iconRight={Icons.ChevronRight} onClick={() => onOpenTab('attendance')}>
                Register
              </Button>
            }
          >
            {isLoading || !overview ? (
              <div className="skeleton h-24" />
            ) : (
              <dl className="space-y-2 text-xs">
                <SummaryRow label="Working days" value={overview.attendanceThisMonth.workingDays} />
                <SummaryRow label="Payable days" value={overview.attendanceThisMonth.payableDays} />
                <SummaryRow label="Present" value={overview.attendanceThisMonth.present} />
                <SummaryRow label="On leave" value={overview.attendanceThisMonth.onLeave} />
                <SummaryRow label="Absent" value={overview.attendanceThisMonth.absent} />
                <SummaryRow
                  label="Loss of pay"
                  value={overview.attendanceThisMonth.lopDays}
                  emphasis={overview.attendanceThisMonth.lopDays > 0}
                />
                <SummaryRow
                  label={`Leave taken in ${overview.leaveSummary.year}`}
                  value={overview.leaveSummary.takenTotal}
                />
                {overview.leaveSummary.pending > 0 ? (
                  <SummaryRow label="Pending requests" value={overview.leaveSummary.pending} emphasis />
                ) : null}
              </dl>
            )}
          </Section>

          <Section
            title="Latest payslip"
            icon={Icons.Wallet}
            action={
              <Button size="sm" variant="ghost" iconRight={Icons.ChevronRight} onClick={() => onOpenTab('payroll')}>
                Payroll
              </Button>
            }
          >
            {isLoading ? (
              <div className="skeleton h-16" />
            ) : overview?.latestPayslip ? (
              <div>
                <p className="text-sm font-semibold text-ink">{overview.latestPayslip.periodLabel}</p>
                <p className="tabular mt-0.5 text-xs text-ink-3">{overview.latestPayslip.payslipNumber}</p>
                <p className="tabular mt-2 text-xl font-bold leading-none text-ink">
                  {formatMoney(overview.latestPayslip.netPay)}
                </p>
                <p className="mt-1 text-[11px] text-ink-3">
                  Net pay · {overview.payslipCount} {overview.payslipCount === 1 ? 'payslip' : 'payslips'} on
                  record
                </p>
              </div>
            ) : (
              <p className="text-sm text-ink-3">No payslip generated yet.</p>
            )}
          </Section>

          <Section
            title="Recent activity"
            icon={Icons.History}
            action={
              <Button size="sm" variant="ghost" iconRight={Icons.ChevronRight} onClick={() => onOpenTab('activity')}>
                View all
              </Button>
            }
          >
            {isLoading ? (
              <div className="skeleton h-24" />
            ) : (overview?.activity.length ?? 0) === 0 ? (
              <p className="text-sm text-ink-3">Nothing recorded against this employee yet.</p>
            ) : (
              <ol className="space-y-3">
                {overview!.activity.map((entry) => (
                  <li key={entry.id} className="flex gap-2.5">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-ink">{actionLabel(entry.action)}</p>
                      <p className="text-[11px] text-ink-3">
                        {entry.actorName} · {formatRelative(entry.at)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Section>

          {canEdit ? (
            <Card>
              <h3 className="mb-3 text-sm font-semibold text-ink">Quick actions</h3>
              <div className="grid gap-2">
                <Button variant="secondary" icon={Icons.CalendarCheck2} block onClick={() => setAttendanceOpen(true)}>
                  Mark attendance
                </Button>
                <Button variant="secondary" icon={Icons.CalendarPlus} block onClick={() => setLeaveOpen(true)}>
                  Apply leave
                </Button>
                <Button variant="secondary" icon={Icons.Wallet} block onClick={() => setPayslipOpen(true)}>
                  Generate payslip
                </Button>
                <Button variant="secondary" icon={Icons.Upload} block onClick={() => onOpenTab('documents')}>
                  Add document
                </Button>
              </div>
            </Card>
          ) : null}
        </div>
      </div>

      {attendanceOpen ? (
        <MarkAttendanceDialog employeeId={employee.id} onClose={() => setAttendanceOpen(false)} />
      ) : null}
      {leaveOpen ? <ApplyLeaveDialog employeeId={employee.id} onClose={() => setLeaveOpen(false)} /> : null}
      {payslipOpen ? (
        <GeneratePayslipDialog employee={employee} onClose={() => setPayslipOpen(false)} />
      ) : null}
    </div>
  );
}

function SummaryRow({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: number;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-ink-3">{label}</dt>
      <dd className={emphasis ? 'tabular font-bold text-warn' : 'tabular font-semibold text-ink'}>
        {value}
      </dd>
    </div>
  );
}
