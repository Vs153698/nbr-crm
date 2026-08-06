import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { LEAD_STATUS_META, type LeadStatus } from '@nbr/shared';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, QueryError } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Badge';
import { PageHeader } from '@/components/layout/AppShell';

import { ApiError, api } from '@/lib/api-client';
import { Icons } from '@/lib/icons';

interface RepRow {
  userId: string | null;
  name: string;
  callsMade: number;
  connected: number;
  notReached: number;
  talkMinutes: number;
  interested: number;
  followUpsSet: number;
  followUpsMissed: number;
  followUpsDueToday: number;
  newLeads: number;
  converted: number;
}

interface SalesDay {
  date: string;
  totals: {
    callsMade: number;
    connected: number;
    notReached: number;
    talkMinutes: number;
    interested: number;
    followUpsSet: number;
    followUpsMissed: number;
    followUpsDueToday: number;
    newLeads: number;
    converted: number;
    connectRate: number;
  };
  reps: RepRow[];
  pipeline: Array<{ status: string; count: number }>;
}

function Stat({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'default' | 'danger' | 'success';
}) {
  const valueTone =
    tone === 'danger' ? 'text-danger' : tone === 'success' ? 'text-ok' : 'text-ink';

  return (
    <div className="rounded-card border border-line bg-white p-3.5 shadow-card">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">{label}</p>
      <p className={`tabular mt-1 text-2xl font-semibold ${valueTone}`}>{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-ink-3">{hint}</p> : null}
    </div>
  );
}

/**
 * The sales dashboard.
 *
 * Reads the same endpoint that builds the end-of-day email, so the figures a
 * manager checks at 4pm are the ones that arrive at 7pm.
 */
export default function SalesDashboardPage() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['sales-dashboard', date],
    queryFn: ({ signal }) => api.get<SalesDay>('/sales/dashboard', { date }, signal),
  });

  const sendReport = useMutation({
    mutationFn: () => api.post<{ sent: boolean; to: string[] }>('/sales/daily-report/send'),
    onSuccess: (result) => {
      if (result.sent) {
        toast.success('Sales report sent', { description: `To ${result.to.join(', ')}.` });
      } else {
        toast.info('Nothing to report', {
          description:
            'No calls were made and nothing was missed, so the email was skipped. Check the recipient list in Settings if you expected one.',
        });
      }
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not send the report'),
  });

  const totals = data?.totals;

  return (
    <div className="p-4 sm:p-5">
      <PageHeader
        title="Sales"
        subtitle="Calling activity, follow-ups and conversions."
        actions={
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs text-ink"
            />
            <Button
              variant="secondary"
              icon={Icons.Mail}
              loading={sendReport.isPending}
              onClick={() => sendReport.mutate()}
            >
              Send report now
            </Button>
          </div>
        }
      />

      {isError ? (
        <Card>
          <QueryError title="Couldn't load the sales figures" onRetry={() => void refetch()} />
        </Card>
      ) : isLoading || !totals ? (
        <div className="skeleton h-64" />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Calls made"
              value={totals.callsMade}
              hint={`${totals.talkMinutes} min on the phone`}
            />
            <Stat
              label="Connected"
              value={totals.connected}
              hint={`${totals.connectRate}% of attempts · ${totals.notReached} not reached`}
            />
            <Stat
              label="Interested"
              value={totals.interested}
              hint={`${totals.converted} converted today`}
              tone={totals.interested > 0 ? 'success' : 'default'}
            />
            <Stat
              label="Follow-ups missed"
              value={totals.followUpsMissed}
              hint={`${totals.followUpsDueToday} due today · ${totals.followUpsSet} set today`}
              tone={totals.followUpsMissed > 0 ? 'danger' : 'default'}
            />
          </div>

          <Card>
            <CardHeader
              title="By person"
              subtitle="Everyone with activity today, or something outstanding."
              icon={Icons.Users}
            />
            {data.reps.length === 0 ? (
              <p className="py-8 text-center text-sm text-ink-3">
                No calls logged and nothing outstanding for this day.
              </p>
            ) : (
              <div className="scrollbar-slim overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-[10px] uppercase tracking-wider text-ink-3">
                      <th className="py-2 pr-3 text-left font-semibold">Person</th>
                      <th className="py-2 px-2 text-right font-semibold">Calls</th>
                      <th className="py-2 px-2 text-right font-semibold">Connected</th>
                      <th className="py-2 px-2 text-right font-semibold">Minutes</th>
                      <th className="py-2 px-2 text-right font-semibold">Interested</th>
                      <th className="py-2 px-2 text-right font-semibold">New</th>
                      <th className="py-2 px-2 text-right font-semibold">Converted</th>
                      <th className="py-2 pl-2 text-right font-semibold">Missed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/60">
                    {data.reps.map((rep) => (
                      <tr key={rep.userId ?? rep.name}>
                        <td className="py-2 pr-3 font-medium text-ink">{rep.name}</td>
                        <td className="tabular py-2 px-2 text-right">{rep.callsMade}</td>
                        <td className="tabular py-2 px-2 text-right">{rep.connected}</td>
                        <td className="tabular py-2 px-2 text-right">{rep.talkMinutes}</td>
                        <td className="tabular py-2 px-2 text-right">{rep.interested}</td>
                        <td className="tabular py-2 px-2 text-right">{rep.newLeads}</td>
                        <td className="tabular py-2 px-2 text-right">{rep.converted}</td>
                        <td
                          className={`tabular py-2 pl-2 text-right font-semibold ${
                            rep.followUpsMissed > 0 ? 'text-danger' : 'text-ink-3'
                          }`}
                        >
                          {rep.followUpsMissed}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Pipeline"
              subtitle="Every open and closed lead, by stage."
              icon={Icons.TrendingUp}
            />
            <div className="flex flex-wrap gap-2">
              {data.pipeline.length === 0 ? (
                <p className="text-sm text-ink-3">No leads yet.</p>
              ) : (
                data.pipeline.map((entry) => {
                  const meta = LEAD_STATUS_META[entry.status as LeadStatus];
                  return (
                    <Chip key={entry.status} tone={meta?.tone ?? 'slate'}>
                      {meta?.label ?? entry.status} · {entry.count}
                    </Chip>
                  );
                })
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
