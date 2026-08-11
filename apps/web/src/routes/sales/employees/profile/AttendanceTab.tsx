import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ATTENDANCE_STATUS_META, MONTH_LABELS, type AttendanceStatus } from '@nbr/shared';
import { Chip } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, QueryError } from '@/components/ui/Card';
import { Select } from '@/components/ui/Field';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api-client';
import { formatDate, formatTime } from '@/lib/format';
import { ICON_STROKE, Icons } from '@/lib/icons';
import { MarkAttendanceDialog } from './MarkAttendanceDialog';
import { Metric, Section } from './shared';
import { employeeKeys, type AttendanceMonth } from '../types';

/** Hours and minutes from a worked-minutes total: 512 → "8h 32m". */
function duration(minutes: number | null): string {
  if (minutes === null || minutes <= 0) return '—';
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/**
 * The attendance register, one month at a time.
 *
 * Days with no entry are not shown as absent. An empty register means nobody
 * marked anything, which is a different fact from someone not turning up — and
 * the payable-days figure treats them as present for exactly that reason.
 */
export function AttendanceTab({ employeeId }: { employeeId: string }) {
  const { can } = useAuth();
  const now = new Date();

  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [marking, setMarking] = useState<string | null>(null);
  const [markOpen, setMarkOpen] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: employeeKeys.attendance(employeeId, month, year),
    queryFn: ({ signal }) =>
      api.get<AttendanceMonth>(`/employees/${employeeId}/attendance`, { month, year }, signal),
  });

  const years = Array.from({ length: 5 }, (_, index) => now.getFullYear() - index);
  const summary = data?.summary;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end gap-2">
          <Select
            label="Month"
            value={String(month)}
            onChange={(event) => setMonth(Number(event.target.value))}
            options={MONTH_LABELS.map((label, index) => ({ value: String(index + 1), label }))}
            containerClassName="w-40"
          />
          <Select
            label="Year"
            value={String(year)}
            onChange={(event) => setYear(Number(event.target.value))}
            options={years.map((value) => ({ value: String(value), label: String(value) }))}
            containerClassName="w-28"
          />
          {can('employees:edit') ? (
            <Button
              className="ml-auto"
              variant="primary"
              icon={Icons.CalendarCheck2}
              onClick={() => {
                setMarking(null);
                setMarkOpen(true);
              }}
            >
              Mark attendance
            </Button>
          ) : null}
        </div>
      </Card>

      {isError ? (
        <Card>
          <QueryError title="Couldn't load the register" onRetry={() => void refetch()} />
        </Card>
      ) : isLoading || !data || !summary ? (
        <div className="skeleton h-64" />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Metric label="Working days" value={summary.workingDays} icon={Icons.CalendarDays} tone="blue" />
            <Metric label="Payable days" value={summary.payableDays} icon={Icons.CalendarCheck2} tone="green" />
            <Metric label="Present" value={summary.present + summary.workFromHome} icon={Icons.Check} tone="green" />
            <Metric label="On leave" value={summary.onLeave} icon={Icons.CalendarPlus} tone="orange" />
            <Metric label="Absent" value={summary.absent} icon={Icons.XCircle} tone="red" />
            <Metric label="Loss of pay" value={summary.lopDays} icon={Icons.AlertCircle} tone={summary.lopDays > 0 ? 'red' : 'slate'} />
          </div>

          <Section
            title={`${MONTH_LABELS[month - 1]} ${year}`}
            icon={Icons.ListChecks}
            action={
              summary.unmarked > 0 ? (
                <span className="text-[11px] text-ink-3">
                  {summary.unmarked} {summary.unmarked === 1 ? 'day' : 'days'} unmarked
                </span>
              ) : null
            }
          >
            {data.days.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-3">
                Nothing marked for this month. Unmarked days count as present for payroll.
              </p>
            ) : (
              <div className="scrollbar-slim overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-line text-2xs uppercase tracking-wider text-ink-3">
                      <th scope="col" className="px-2 py-2 text-left font-semibold">Date</th>
                      <th scope="col" className="px-2 py-2 text-left font-semibold">Status</th>
                      <th scope="col" className="px-2 py-2 text-left font-semibold">In</th>
                      <th scope="col" className="px-2 py-2 text-left font-semibold">Out</th>
                      <th scope="col" className="px-2 py-2 text-left font-semibold">Worked</th>
                      <th scope="col" className="px-2 py-2 text-left font-semibold">Remarks</th>
                      {can('employees:edit') ? <th scope="col" className="w-16 px-2 py-2" /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {data.days.map((day) => {
                      const meta = ATTENDANCE_STATUS_META[day.status as AttendanceStatus];
                      return (
                        <tr key={day.id} className="border-b border-line/70">
                          <td className="tabular px-2 py-2 text-xs text-ink-2">{formatDate(day.onDate)}</td>
                          <td className="px-2 py-2">
                            <Chip tone={meta?.tone ?? 'slate'}>{meta?.label ?? day.status}</Chip>
                          </td>
                          <td className="tabular px-2 py-2 text-xs text-ink-2">
                            {day.checkInAt ? formatTime(day.checkInAt) : '—'}
                          </td>
                          <td className="tabular px-2 py-2 text-xs text-ink-2">
                            {day.checkOutAt ? formatTime(day.checkOutAt) : '—'}
                          </td>
                          <td className="tabular px-2 py-2 text-xs text-ink-2">{duration(day.workedMinutes)}</td>
                          <td className="max-w-[220px] truncate px-2 py-2 text-xs text-ink-3">
                            {day.remarks ?? '—'}
                          </td>
                          {can('employees:edit') ? (
                            <td className="px-2 py-2 text-right">
                              <button
                                type="button"
                                aria-label={`Correct ${formatDate(day.onDate)}`}
                                onClick={() => {
                                  setMarking(day.onDate);
                                  setMarkOpen(true);
                                }}
                                className="grid h-7 w-7 place-items-center rounded-md text-ink-3 transition-colors hover:bg-slate2-tint hover:text-ink"
                              >
                                <Icons.PenLine size={13} strokeWidth={ICON_STROKE} />
                              </button>
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </>
      )}

      {markOpen ? (
        <MarkAttendanceDialog
          employeeId={employeeId}
          initialDate={marking ?? undefined}
          onClose={() => {
            setMarkOpen(false);
            setMarking(null);
          }}
        />
      ) : null}
    </div>
  );
}
