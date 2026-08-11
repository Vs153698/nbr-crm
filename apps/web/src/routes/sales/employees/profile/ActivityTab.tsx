import { useQuery } from '@tanstack/react-query';
import { Card, QueryError } from '@/components/ui/Card';
import { api } from '@/lib/api-client';
import { formatDateTime, formatRelative } from '@/lib/format';
import { ICON_STROKE, Icons, type LucideIcon } from '@/lib/icons';
import { actionLabel, Section } from './shared';
import { employeeKeys, type EmployeeActivity } from '../types';

/** Which icon an audit action gets. Falls back rather than going blank. */
const ACTION_ICON: Record<string, LucideIcon> = {
  'employee.created': Icons.UserPlus,
  'employee.updated': Icons.PenLine,
  'employee.deleted': Icons.Trash2,
  'employee.document_uploaded': Icons.Upload,
  'employee.document_opened': Icons.Eye,
  'employee.document_deleted': Icons.Trash2,
  'employee.attendance_marked': Icons.CalendarCheck2,
  'employee.leave_applied': Icons.CalendarPlus,
  'employee.leave_approved': Icons.Check,
  'employee.leave_decided': Icons.ClipboardCheck,
  'employee.payslip_generated': Icons.Wallet,
  'employee.payslip_cancelled': Icons.Undo2,
};

/**
 * Everything recorded against this employee, newest first.
 *
 * Read straight from the audit log rather than a second activity table — one
 * append-only feed cannot drift from itself, and the audit log is the record
 * that already has to be right.
 */
export function ActivityTab({ employeeId }: { employeeId: string }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: employeeKeys.activity(employeeId),
    queryFn: ({ signal }) =>
      api.get<EmployeeActivity[]>(`/employees/${employeeId}/activity`, { limit: 100 }, signal),
  });

  if (isError) {
    return (
      <Card>
        <QueryError title="Couldn't load the activity" onRetry={() => void refetch()} />
      </Card>
    );
  }

  if (isLoading || !data) return <div className="skeleton h-64" />;

  return (
    <Section title="Activity" icon={Icons.History}>
      {data.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-3">
          Nothing has been recorded against this employee yet.
        </p>
      ) : (
        <ol className="space-y-3">
          {data.map((entry) => {
            const Icon = ACTION_ICON[entry.action] ?? Icons.Info;
            return (
              <li key={entry.id} className="flex gap-3">
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-slate2-tint text-ink-2">
                  <Icon size={13} strokeWidth={ICON_STROKE} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">{actionLabel(entry.action)}</p>
                  {entry.label ? <p className="text-xs text-ink-2">{entry.label}</p> : null}
                  <p className="text-[11px] text-ink-3">
                    {entry.actorName} · <time dateTime={entry.at}>{formatDateTime(entry.at)}</time> ·{' '}
                    {formatRelative(entry.at)}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Section>
  );
}
