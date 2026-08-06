import { EXPORT_FORMAT, REPORT_TYPE, type ExportFormat, type ReportType } from '@nbr/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/AppShell';
import { Chip } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState, QueryError } from '@/components/ui/Card';
import { Input } from '@/components/ui/Field';
import { api, ApiError } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { formatDateTime, formatRelative, humanise } from '@/lib/format';
import { ICON_SIZE, ICON_STROKE, Icons } from '@/lib/icons';
import { queryKeys } from '@/lib/query-client';

interface ReportResult {
  type: string;
  columns: Array<{ key: string; label: string; align?: 'right' }>;
  rows: Array<Record<string, unknown>>;
  totals?: Record<string, unknown>;
  generatedAt: string;
}

interface ExportJob {
  id: string;
  reportType: string;
  format: string;
  status: string;
  rowCount: number | null;
  error: string | null;
  createdAt: string;
  expiresAt: string | null;
  expired: boolean;
}

const REPORTS: Array<{ type: ReportType; label: string; description: string }> = [
  { type: REPORT_TYPE.APPLICATIONS, label: 'Applications', description: 'Volume and outcomes by period' },
  { type: REPORT_TYPE.REVENUE, label: 'Revenue', description: 'Money actually received, by period' },
  { type: REPORT_TYPE.PENDING_PAYMENTS, label: 'Pending payments', description: 'Outstanding balances and overdue days' },
  { type: REPORT_TYPE.PENDING_CERTIFICATES, label: 'Pending certificates', description: 'Paid records awaiting a certificate' },
  { type: REPORT_TYPE.PENDING_DISPATCH, label: 'Pending dispatch', description: 'Certificates waiting to be sent' },
  { type: REPORT_TYPE.EMPLOYEE_PERFORMANCE, label: 'Employee performance', description: 'Throughput per team member' },
  { type: REPORT_TYPE.CATEGORY_WISE, label: 'Category-wise', description: 'Records and revenue by category' },
  { type: REPORT_TYPE.COUNTRY_WISE, label: 'Country-wise', description: 'Applicants by country and state' },
];

/**
 * W-27 Reports (§24).
 *
 * Exports are queued rather than streamed: the button returns immediately and
 * the download centre below fills in when the worker finishes. A large export
 * that appears to hang is worse than one that visibly queues.
 */
export default function ReportsPage() {
  const queryClient = useQueryClient();
  const [active, setActive] = useState<ReportType>(REPORT_TYPE.APPLICATIONS);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const filters = { from: from || undefined, to: to || undefined };

  const { data: report, isFetching, isError, refetch } = useQuery({
    queryKey: queryKeys.reports(active, filters),
    queryFn: ({ signal }) => api.get<ReportResult>(`/reports/${active}`, filters, signal),
  });

  const { data: jobs } = useQuery({
    queryKey: queryKeys.exports,
    queryFn: ({ signal }) => api.get<ExportJob[]>('/exports', undefined, signal),
    // Poll while anything is still running, then stop.
    refetchInterval: (query) =>
      (query.state.data ?? []).some((job) => job.status === 'queued' || job.status === 'running')
        ? 2000
        : false,
  });

  const exportMutation = useMutation({
    mutationFn: (format: ExportFormat) =>
      api.post<{ jobId: string }>(`/reports/${active}/export`, { ...filters, format }),
    onSuccess: () => {
      toast.success('Export queued', { description: 'It appears in Downloads when ready.' });
      void queryClient.invalidateQueries({ queryKey: queryKeys.exports });
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not queue the export'),
  });

  const downloadMutation = useMutation({
    mutationFn: (jobId: string) => api.get<{ url: string }>(`/exports/${jobId}/download`),
    onSuccess: ({ url }) => window.open(url, '_blank', 'noopener,noreferrer'),
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not download that export'),
  });

  const activeMeta = REPORTS.find((report) => report.type === active);

  return (
    <div className="p-4 sm:p-5">
      <PageHeader
        title="Reports"
        subtitle="Every report is date-bounded. Exports run in the background and land in Downloads."
      />

      <div className="grid gap-4 lg:grid-cols-4">
        {/* Report picker */}
        <Card className="lg:col-span-1" padded={false}>
          <ul className="p-1.5">
            {REPORTS.map((report) => (
              <li key={report.type}>
                <button
                  type="button"
                  onClick={() => setActive(report.type)}
                  className={cn(
                    'w-full rounded-lg px-3 py-2 text-left transition-colors',
                    active === report.type ? 'bg-brand text-white' : 'hover:bg-canvas',
                  )}
                >
                  <span className="block text-xs font-semibold">{report.label}</span>
                  <span
                    className={cn(
                      'block text-[10px]',
                      active === report.type ? 'text-white/70' : 'text-ink-3',
                    )}
                  >
                    {report.description}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <div className="space-y-4 lg:col-span-3">
          <Card>
            <div className="flex flex-wrap items-end gap-3">
              <Input
                label="From"
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                containerClassName="w-40"
                hint="Defaults to 12 months"
              />
              <Input
                label="To"
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                containerClassName="w-40"
              />

              <div className="ml-auto flex flex-wrap gap-2">
                {Object.values(EXPORT_FORMAT).map((format) => (
                  <Button
                    key={format}
                    size="sm"
                    variant="secondary"
                    icon={Icons.Download}
                    loading={exportMutation.isPending && exportMutation.variables === format}
                    onClick={() => exportMutation.mutate(format)}
                  >
                    {format.toUpperCase()}
                  </Button>
                ))}
              </div>
            </div>
          </Card>

          <Card padded={false}>
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold text-ink">{activeMeta?.label}</h3>
                {report ? (
                  <p className="text-[10px] text-ink-3">
                    {report.rows.length} rows · generated {formatRelative(report.generatedAt)}
                  </p>
                ) : null}
              </div>
              {isFetching ? <Icons.Loader2 size={16} className="animate-spin text-ink-3" /> : null}
            </div>

            {isError ? (
              <QueryError title="Couldn't run this report" onRetry={() => void refetch()} />
            ) : !report ? (
              <div className="space-y-2 p-4">
                {[0, 1, 2, 3].map((index) => (
                  <div key={index} className="skeleton h-8" />
                ))}
              </div>
            ) : report.rows.length === 0 ? (
              <EmptyState
                icon={Icons.TrendingUp}
                title="No data for this period"
                description="Try widening the date range."
              />
            ) : (
              <div className="scrollbar-slim overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      {report.columns.map((column) => (
                        <th
                          key={column.key}
                          className={cn(
                            'sticky top-0 border-b border-line bg-canvas px-3 py-2 text-2xs font-semibold uppercase tracking-wider text-ink-3',
                            column.align === 'right' ? 'text-right' : 'text-left',
                          )}
                        >
                          {column.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map((row, index) => (
                      <tr key={index} className="border-b border-line/70 hover:bg-canvas">
                        {report.columns.map((column) => (
                          <td
                            key={column.key}
                            className={cn(
                              'px-3 py-2 text-xs',
                              column.align === 'right' ? 'tabular text-right' : 'text-left',
                            )}
                          >
                            {String(row[column.key] ?? '—')}
                          </td>
                        ))}
                      </tr>
                    ))}

                    {report.totals ? (
                      <tr className="border-t-2 border-line bg-brand-tint font-semibold">
                        {report.columns.map((column) => (
                          <td
                            key={column.key}
                            className={cn(
                              'px-3 py-2 text-xs',
                              column.align === 'right' ? 'tabular text-right' : 'text-left',
                            )}
                          >
                            {String(report.totals?.[column.key] ?? '')}
                          </td>
                        ))}
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Download centre */}
          <Card>
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink">
              <Icons.Download size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />
              Downloads
            </h3>

            {(jobs?.length ?? 0) === 0 ? (
              <p className="text-xs text-ink-3">No exports yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {jobs?.map((job) => (
                  <li
                    key={job.id}
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-line p-2.5"
                  >
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-slate2-tint text-2xs font-bold uppercase text-ink-2">
                      {job.format}
                    </span>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-ink">
                        {humanise(job.reportType)}
                      </p>
                      <p className="text-[10px] text-ink-3">
                        {formatDateTime(job.createdAt)}
                        {job.rowCount !== null ? ` · ${job.rowCount} rows` : ''}
                        {job.expiresAt && !job.expired
                          ? ` · expires ${formatRelative(job.expiresAt)}`
                          : ''}
                      </p>
                      {job.error ? <p className="text-[10px] text-danger">{job.error}</p> : null}
                    </div>

                    {job.status === 'completed' && !job.expired ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={Icons.Download}
                        loading={downloadMutation.isPending && downloadMutation.variables === job.id}
                        onClick={() => downloadMutation.mutate(job.id)}
                      >
                        Download
                      </Button>
                    ) : (
                      <Chip
                        tone={
                          job.expired
                            ? 'slate'
                            : job.status === 'failed'
                              ? 'red'
                              : job.status === 'completed'
                                ? 'green'
                                : 'orange'
                        }
                      >
                        {job.expired ? 'Expired' : humanise(job.status)}
                      </Chip>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <p className="mt-2 flex items-start gap-1.5 text-[10px] leading-relaxed text-ink-3">
              <Icons.Shield size={11} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0" />
              Exports contain personal data, so they expire after 24 hours and only the person who
              requested one can download it.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
