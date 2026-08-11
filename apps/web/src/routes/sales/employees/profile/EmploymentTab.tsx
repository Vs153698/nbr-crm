import { Link } from 'react-router-dom';
import {
  EMPLOYEE_STATUS_META,
  EMPLOYMENT_TYPE_LABELS,
  isOnProbation,
  tenureLabel,
  type EmployeeStatus,
  type EmploymentType,
} from '@nbr/shared';
import { Chip } from '@/components/ui/Badge';
import { useAuth } from '@/hooks/useAuth';
import { formatDate, formatMoney, humanise } from '@/lib/format';
import { ICON_STROKE, Icons } from '@/lib/icons';
import { Info, InfoGrid, Section } from './shared';
import type { EmployeeDetail } from '../types';

/**
 * The employment record: the contract, the money and the reporting line.
 *
 * Salary and bank details are behind `employees:edit` rather than
 * `employees:view`. Everyone with directory access can look someone up; what
 * they are paid and where it is paid is a narrower question, and the account
 * number is masked even for those who can see it — the full number is on the
 * employee's own paperwork, and nothing on this screen needs it.
 */
export function EmploymentTab({ employee }: { employee: EmployeeDetail }) {
  const { can } = useAuth();
  const canSeePay = can('employees:edit');

  const statusMeta = EMPLOYEE_STATUS_META[employee.status as EmployeeStatus];
  const probation = isOnProbation(employee.probationEndsOn);
  const tenure = tenureLabel(employee.joinedOn);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="Position" icon={Icons.Briefcase}>
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
          <Info
            label="Status"
            value={<Chip tone={statusMeta?.tone ?? 'slate'}>{statusMeta?.label ?? employee.status}</Chip>}
          />
          <Info label="Login account" value={employee.userId ? 'Linked' : 'None'} />
        </InfoGrid>
      </Section>

      <Section title="Service dates" icon={Icons.CalendarClock}>
        <InfoGrid>
          <Info label="Joined on" value={employee.joinedOn ? formatDate(employee.joinedOn) : null} />
          <Info label="Tenure" value={tenure} />
          <Info
            label="Probation ends"
            value={
              employee.probationEndsOn ? (
                <span className="flex items-center gap-2">
                  {formatDate(employee.probationEndsOn)}
                  {probation ? <Chip tone="orange">In progress</Chip> : <Chip tone="green">Completed</Chip>}
                </span>
              ) : null
            }
          />
          <Info label="Exited on" value={employee.exitedOn ? formatDate(employee.exitedOn) : null} />
          <Info label="Date of birth" value={employee.dateOfBirth ? formatDate(employee.dateOfBirth) : null} />
        </InfoGrid>
      </Section>

      <Section title="Compensation" icon={Icons.Wallet}>
        {canSeePay ? (
          <InfoGrid>
            <Info label="Monthly salary" value={formatMoney(employee.monthlySalary)} />
            <Info label="Annual CTC" value={formatMoney(employee.ctc)} />
            <Info label="PAN" value={employee.panNumber} />
            <Info label="Bank" value={employee.bankName} />
            <Info
              label="Account number"
              value={employee.bankAccountNumber ? maskAccount(employee.bankAccountNumber) : null}
            />
          </InfoGrid>
        ) : (
          <p className="flex items-center gap-2 py-2 text-sm text-ink-3">
            <Icons.Lock size={14} strokeWidth={ICON_STROKE} className="shrink-0" />
            Salary and bank details are restricted.
          </p>
        )}
      </Section>

      <Section title="Reporting line" icon={Icons.Users}>
        <div className="space-y-4">
          <Info
            label="Reports to"
            value={
              employee.reportsToEmployeeId && employee.reportsToName ? (
                <Link
                  to={`/employees/${employee.reportsToEmployeeId}`}
                  className="font-medium text-brand hover:underline"
                >
                  {employee.reportsToName}
                </Link>
              ) : null
            }
          />

          <div>
            <p className="text-[11px] uppercase tracking-wide text-ink-3">
              Direct reports ({employee.reports.length})
            </p>
            {employee.reports.length === 0 ? (
              <p className="mt-0.5 text-sm text-ink-4">Nobody reports to this employee.</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {employee.reports.map((report) => (
                  <li key={report.id}>
                    <Link
                      to={`/employees/${report.id}`}
                      className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 transition-colors hover:border-brand-ring hover:bg-brand-tint/40"
                    >
                      <span className="truncate text-sm font-medium text-ink">{report.fullName}</span>
                      <span className="truncate text-xs text-ink-3">{report.designation ?? '—'}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Section>

      {employee.notes ? (
        <Section title="Notes" icon={Icons.StickyNote} className="lg:col-span-2">
          <p className="whitespace-pre-wrap text-sm text-ink-2">{employee.notes}</p>
        </Section>
      ) : null}
    </div>
  );
}

/** Last four digits only — the rest is on the employee's own paperwork. */
function maskAccount(accountNumber: string): string {
  const tail = accountNumber.slice(-4);
  return `${'•'.repeat(Math.max(0, accountNumber.length - 4))}${tail}`;
}
