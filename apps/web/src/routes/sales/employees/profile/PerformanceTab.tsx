import { useQuery } from '@tanstack/react-query';
import { isOnProbation, tenureLabel } from '@nbr/shared';
import { Card, EmptyState } from '@/components/ui/Card';
import { api } from '@/lib/api-client';
import { formatDate } from '@/lib/format';
import { Icons } from '@/lib/icons';
import { Metric, Section } from './shared';
import { employeeKeys, type EmployeeDetail, type EmployeeOverview } from '../types';

/**
 * Performance.
 *
 * The CRM does not hold appraisal cycles, ratings or goals — there is no
 * review model behind this tab, and inventing a score out of attendance would
 * be a number that looks authoritative and means nothing.
 *
 * What it does show is the factual context a reviewer opens this tab for:
 * how long the person has been here, whether probation is still running, this
 * month's attendance and the leave taken. Everything on this screen is a
 * recorded fact, not a judgement.
 */
export function PerformanceTab({ employee }: { employee: EmployeeDetail }) {
  const { data: overview, isLoading } = useQuery({
    queryKey: employeeKeys.overview(employee.id),
    queryFn: ({ signal }) =>
      api.get<EmployeeOverview>(`/employees/${employee.id}/overview`, undefined, signal),
  });

  const probation = isOnProbation(employee.probationEndsOn);
  const tenure = tenureLabel(employee.joinedOn);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Tenure" value={tenure ?? '—'} icon={Icons.CalendarClock} tone="blue" />
        <Metric
          label="Probation"
          value={
            !employee.probationEndsOn
              ? 'Not applicable'
              : probation
                ? `Until ${formatDate(employee.probationEndsOn)}`
                : 'Completed'
          }
          icon={Icons.Clock}
          tone={probation ? 'orange' : 'green'}
        />
        <Metric
          label="Attendance this month"
          value={
            isLoading || !overview
              ? '—'
              : `${overview.attendanceThisMonth.payableDays} / ${overview.attendanceThisMonth.workingDays}`
          }
          icon={Icons.CalendarCheck2}
          tone="green"
        />
        <Metric
          label={`Leave taken in ${overview?.leaveSummary.year ?? new Date().getFullYear()}`}
          value={isLoading || !overview ? '—' : overview.leaveSummary.takenTotal}
          icon={Icons.CalendarDays}
          tone="slate"
        />
      </div>

      <Section title="Team" icon={Icons.Users}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Metric label="Direct reports" value={employee.reports.length} icon={Icons.UserRoundCheck} tone="indigo" />
          <Metric
            label="Reporting manager"
            value={employee.reportsToName ?? 'None'}
            icon={Icons.Briefcase}
            tone="slate"
          />
        </div>
      </Section>

      <Card>
        <EmptyState
          icon={Icons.TrendingUp}
          title="Reviews aren't recorded here"
          description="Appraisal cycles, ratings and goals live outside the CRM. The figures above are the recorded facts a reviewer needs — attendance, leave, tenure and probation — and nothing on this page is a rating."
        />
      </Card>
    </div>
  );
}
