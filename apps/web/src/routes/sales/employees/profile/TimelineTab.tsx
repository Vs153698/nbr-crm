import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { isOnProbation, LEAVE_STATUS, LEAVE_TYPE_LABELS, type LeaveType } from '@nbr/shared';
import { Card, QueryError } from '@/components/ui/Card';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { formatDate, formatMoney } from '@/lib/format';
import { Icons, type LucideIcon } from '@/lib/icons';
import { Section } from './shared';
import { employeeKeys, type EmployeeDetail, type LeaveList, type Payslip } from '../types';

interface Milestone {
  id: string;
  /** ISO date — what the entry is sorted and grouped by. */
  on: string;
  title: string;
  detail: string | null;
  icon: LucideIcon;
  tone: 'brand' | 'green' | 'orange' | 'slate';
  /** Dated in the future — probation ending, for instance. */
  upcoming: boolean;
}

const TONE_DOT = {
  brand: 'bg-brand',
  green: 'bg-ok',
  orange: 'bg-warn',
  slate: 'bg-ink-4',
} as const;

/**
 * The employment timeline: the dated events in this person's service.
 *
 * Built from facts that carry a date of their own — joining, probation, leave
 * that was actually approved, payslips that were issued, the exit — rather than
 * from the audit log, which is what the Activity tab shows. The difference
 * matters: Activity is who touched the record and when; this is what happened
 * to the employee.
 *
 * Nothing is invented. A milestone appears only where a date exists, and a date
 * still in the future is marked as such rather than shown as having happened.
 */
export function TimelineTab({ employee }: { employee: EmployeeDetail }) {
  const leaveQuery = useQuery({
    queryKey: employeeKeys.leave(employee.id),
    queryFn: ({ signal }) => api.get<LeaveList>(`/employees/${employee.id}/leave`, undefined, signal),
  });

  const payslipQuery = useQuery({
    queryKey: employeeKeys.payslips(employee.id),
    queryFn: ({ signal }) =>
      api.get<Payslip[]>(`/employees/${employee.id}/payslips`, undefined, signal),
  });

  const milestones = useMemo(
    () => buildTimeline(employee, leaveQuery.data, payslipQuery.data),
    [employee, leaveQuery.data, payslipQuery.data],
  );

  if (leaveQuery.isError || payslipQuery.isError) {
    return (
      <Card>
        <QueryError
          title="Couldn't build the timeline"
          onRetry={() => {
            void leaveQuery.refetch();
            void payslipQuery.refetch();
          }}
        />
      </Card>
    );
  }

  if (leaveQuery.isLoading || payslipQuery.isLoading) return <div className="skeleton h-64" />;

  return (
    <Section title="Employment timeline" icon={Icons.ListChecks}>
      {milestones.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-3">
          Nothing dated on this record yet — a joining date is the first entry.
        </p>
      ) : (
        <ol className="relative space-y-5 border-l border-line pl-6">
          {milestones.map((milestone) => (
            <li key={milestone.id} className="relative">
              <span
                className={cn(
                  'absolute -left-[1.9375rem] top-1 grid h-6 w-6 place-items-center rounded-full text-white',
                  TONE_DOT[milestone.tone],
                  milestone.upcoming && 'opacity-50',
                )}
                aria-hidden
              >
                <milestone.icon size={12} strokeWidth={2} />
              </span>

              <div className={cn('min-w-0', milestone.upcoming && 'opacity-70')}>
                <div className="flex flex-wrap items-baseline gap-2">
                  <p className="text-sm font-semibold text-ink">{milestone.title}</p>
                  <time className="tabular text-[11px] text-ink-3" dateTime={milestone.on}>
                    {formatDate(milestone.on)}
                  </time>
                  {milestone.upcoming ? (
                    <span className="rounded bg-slate2-tint px-1.5 py-0.5 text-[10px] font-semibold text-ink-3">
                      Upcoming
                    </span>
                  ) : null}
                </div>
                {milestone.detail ? (
                  <p className="mt-0.5 text-xs text-ink-2">{milestone.detail}</p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

function buildTimeline(
  employee: EmployeeDetail,
  leave: LeaveList | undefined,
  payslips: Payslip[] | undefined,
): Milestone[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const milestones: Milestone[] = [];

  const add = (milestone: Omit<Milestone, 'upcoming'>) => {
    milestones.push({ ...milestone, upcoming: new Date(milestone.on) > today });
  };

  if (employee.joinedOn) {
    add({
      id: 'joined',
      on: employee.joinedOn,
      title: 'Joined NBR',
      detail: [employee.designation, employee.department].filter(Boolean).join(' · ') || null,
      icon: Icons.UserPlus,
      tone: 'brand',
    });
  }

  if (employee.probationEndsOn) {
    const running = isOnProbation(employee.probationEndsOn);
    add({
      id: 'probation',
      on: employee.probationEndsOn,
      title: running ? 'Probation ends' : 'Probation completed',
      detail: running ? 'Still on probation until this date.' : null,
      icon: Icons.ShieldCheck,
      tone: running ? 'orange' : 'green',
    });
  }

  // Only approved leave. A pending request has been taken by nobody, and a
  // rejected one never happened.
  for (const request of leave?.requests ?? []) {
    if (request.status !== LEAVE_STATUS.APPROVED) continue;
    add({
      id: `leave-${request.id}`,
      on: request.fromDate,
      title: `${LEAVE_TYPE_LABELS[request.leaveType as LeaveType] ?? request.leaveType} approved`,
      detail: `${request.days} ${Number(request.days) === 1 ? 'day' : 'days'} · ${formatDate(request.fromDate)} → ${formatDate(request.toDate)}`,
      icon: Icons.CalendarDays,
      tone: 'slate',
    });
  }

  for (const payslip of payslips ?? []) {
    add({
      id: `payslip-${payslip.id}`,
      on: payslip.createdAt.slice(0, 10),
      title: `Payslip issued — ${payslip.periodLabel}`,
      detail: `${payslip.payslipNumber} · net pay ${formatMoney(payslip.netPay)}`,
      icon: Icons.Wallet,
      tone: 'green',
    });
  }

  if (employee.exitedOn) {
    add({
      id: 'exited',
      on: employee.exitedOn,
      title: 'Left NBR',
      detail: null,
      icon: Icons.LogOut,
      tone: 'slate',
    });
  }

  // Newest first, matching every other feed in the app.
  return milestones.sort((a, b) => b.on.localeCompare(a.on));
}
