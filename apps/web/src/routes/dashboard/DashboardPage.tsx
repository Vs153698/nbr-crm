import { formatINRCompact } from '@nbr/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PageHeader } from '@/components/layout/AppShell';
import { Card, CardHeader, EmptyState, StatCard } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Badge';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { formatDateTime, formatRelative, statusLabel, statusTone, TONE_CLASSES } from '@/lib/format';
import { ICON_SIZE, ICON_STROKE, Icons } from '@/lib/icons';
import { queryKeys } from '@/lib/query-client';

interface DashboardPayload {
  stats: {
    totalApplicants: number;
    totalRecords: number;
    applicationsToday: number;
    pendingReviews: number;
    pendingVerification: number;
    pendingApproval: number;
    selected: number;
    rejected: number;
    paymentPending: number;
    paymentReceived: number;
    certificatePending: number;
    dispatchPending: number;
    delivered: number;
    monthlyRevenue: string;
    outstandingRevenue: string;
    blacklisted: number;
  };
  statusBreakdown: Array<{ status: string; count: number }>;
  monthlyTrend: Array<{ month: string; applications: number; revenue: string }>;
  todaysFollowUps: Array<{
    id: string;
    title: string;
    dueDate: string;
    priority: string;
    applicantId: string | null;
    applicantName: string | null;
    overdue: boolean;
  }>;
  myPendingTasks: DashboardPayload['todaysFollowUps'];
  recentActivities: Array<{
    id: string;
    eventType: string;
    summary: string;
    actorName: string | null;
    occurredAt: string;
  }>;
}

/** Colour per tone, resolved to real hex for Recharts (which can't read Tailwind). */
const CHART_COLOURS: Record<string, string> = {
  blue: '#2557D6',
  orange: '#B36A00',
  green: '#10893E',
  red: '#C7362F',
  purple: '#6D3BD1',
  teal: '#0E7C86',
  indigo: '#2557D6',
  slate: '#64748B',
};

/**
 * W-03 Dashboard (§2).
 *
 * One request fetches every panel — the API assembles the whole payload from
 * Redis-cached counters, so this renders in a single round trip rather than
 * six.
 */
export default function DashboardPage() {
  const { user, can } = useAuth();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: ({ signal }) => api.get<DashboardPayload>('/dashboard', undefined, signal),
    // The plan's 60-second cache TTL — refetching faster than the server
    // recomputes would just re-read the same cached numbers.
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const stats = data?.stats;
  const canSeeMoney = can('payments:view');

  if (isError) {
    return (
      <div className="p-5">
        <EmptyState
          icon={Icons.ShieldAlert}
          title="Couldn't load the dashboard"
          description="Something went wrong fetching your statistics."
          action={
            <button
              type="button"
              onClick={() => void refetch()}
              className="text-xs font-semibold text-brand hover:underline"
            >
              Try again
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-5">
      <PageHeader
        title={`Good ${greeting()}, ${user?.fullName?.split(' ')[0] ?? 'there'}`}
        subtitle="Live business statistics across every stage of the record lifecycle."
      />

      {/* Stat cards — each one links through to the pre-filtered list, because
          a count nobody can act on is just decoration. */}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
        <StatCard
          label="Total Applicants"
          value={(stats?.totalApplicants ?? 0).toLocaleString('en-IN')}
          hint={`${stats?.totalRecords ?? 0} records`}
          icon={Icons.Users}
          tone="blue"
          to="/applicants"
          loading={isLoading}
        />
        <StatCard
          label="Applications Today"
          value={stats?.applicationsToday ?? 0}
          icon={Icons.FilePlus2}
          tone="indigo"
          loading={isLoading}
        />
        {/* Two tiles, not one. A verifier and an approver work different
            queues, and a combined "pending reviews" number told neither of
            them how much of it was theirs. */}
        <StatCard
          label="Verification"
          value={stats?.pendingVerification ?? 0}
          hint="Documents being checked"
          icon={Icons.Clock}
          tone="orange"
          to="/applicants?status=under_review"
          loading={isLoading}
        />
        <StatCard
          label="Approval Pending"
          value={stats?.pendingApproval ?? 0}
          hint="Verified — awaiting a decision"
          icon={Icons.ClipboardCheck}
          tone="orange"
          to="/applicants?status=verification_pending"
          loading={isLoading}
        />
        <StatCard
          label="Selection Sent"
          value={stats?.selected ?? 0}
          icon={Icons.CheckCircle2}
          tone="green"
          to="/applicants?status=selected"
          loading={isLoading}
        />
        <StatCard
          label="Rejected"
          value={stats?.rejected ?? 0}
          icon={Icons.XCircle}
          tone="red"
          to="/applicants?status=rejected"
          loading={isLoading}
        />
        <StatCard
          label="Payment Pending"
          value={stats?.paymentPending ?? 0}
          icon={Icons.IndianRupee}
          tone="orange"
          to="/applicants?status=payment_pending"
          loading={isLoading}
        />
        <StatCard
          label="Certificate Pending"
          value={stats?.certificatePending ?? 0}
          icon={Icons.Award}
          tone="teal"
          to="/applicants?status=certificate_pending"
          loading={isLoading}
        />
        <StatCard
          label="Dispatch Pending"
          value={stats?.dispatchPending ?? 0}
          icon={Icons.Truck}
          tone="orange"
          to="/applicants?status=dispatch_pending"
          loading={isLoading}
        />
        <StatCard
          label="Delivered"
          value={stats?.delivered ?? 0}
          icon={Icons.PackageCheck}
          tone="green"
          to="/applicants?status=delivered&status=completed"
          loading={isLoading}
        />
        <StatCard
          label="Blacklisted"
          value={stats?.blacklisted ?? 0}
          icon={Icons.Ban}
          tone="red"
          loading={isLoading}
        />

        {/* Revenue is only shown to roles that hold payments:view — a Viewer
            must never see turnover (§25). */}
        {canSeeMoney ? (
          <>
            <StatCard
              label="Revenue (this month)"
              value={formatINRCompact(stats?.monthlyRevenue ?? '0')}
              icon={Icons.TrendingUp}
              tone="green"
              loading={isLoading}
            />
            <StatCard
              label="Outstanding"
              value={formatINRCompact(stats?.outstandingRevenue ?? '0')}
              hint="Across pending & partial payments"
              icon={Icons.CreditCard}
              tone="orange"
              loading={isLoading}
            />
          </>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Monthly trend */}
        <Card className="lg:col-span-2">
          <CardHeader
            title="Applications over the last 12 months"
            subtitle="Volume by month of application"
            icon={Icons.TrendingUp}
          />
          {isLoading ? (
            <div className="skeleton h-56" />
          ) : (
            <ResponsiveContainer width="100%" height={224}>
              <BarChart data={data?.monthlyTrend ?? []} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                <XAxis
                  dataKey="month"
                  tickFormatter={(month: string) => month.slice(5)}
                  tick={{ fontSize: 10, fill: '#7A869E' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 10, fill: '#7A869E' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: '#EAF0FD' }}
                  contentStyle={{
                    fontSize: 12,
                    borderRadius: 8,
                    border: '1px solid #E1E7F0',
                    boxShadow: '0 4px 12px rgba(16,24,43,.07)',
                  }}
                />
                <Bar dataKey="applications" fill="#2557D6" radius={[4, 4, 0, 0]} maxBarSize={38} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Status breakdown */}
        <Card>
          <CardHeader title="Records by status" icon={Icons.LayoutDashboard} />
          {isLoading ? (
            <div className="skeleton h-56" />
          ) : (data?.statusBreakdown.length ?? 0) === 0 ? (
            <EmptyState icon={Icons.Inbox} title="No records yet" />
          ) : (
            <>
              <ResponsiveContainer width="100%" height={168}>
                <PieChart>
                  <Pie
                    data={data?.statusBreakdown ?? []}
                    dataKey="count"
                    nameKey="status"
                    innerRadius={44}
                    outerRadius={72}
                    paddingAngle={2}
                  >
                    {(data?.statusBreakdown ?? []).map((entry) => (
                      <Cell
                        key={entry.status}
                        fill={CHART_COLOURS[statusTone(entry.status)] ?? '#64748B'}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number, name: string) => [value, statusLabel(name)]}
                    contentStyle={{
                      fontSize: 12,
                      borderRadius: 8,
                      border: '1px solid #E1E7F0',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>

              <ul className="mt-2 space-y-1">
                {(data?.statusBreakdown ?? []).slice(0, 6).map((entry) => (
                  <li key={entry.status} className="flex items-center gap-2 text-xs">
                    <span
                      className={cn('h-2 w-2 shrink-0 rounded-full', TONE_CLASSES[statusTone(entry.status)].dot)}
                    />
                    <span className="min-w-0 flex-1 truncate text-ink-2">
                      {statusLabel(entry.status)}
                    </span>
                    <span className="tabular shrink-0 font-semibold text-ink">{entry.count}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>

        {/* Today's follow-ups */}
        <Card>
          <CardHeader
            title="Today's follow-ups"
            subtitle="Due today or overdue, assigned to you"
            icon={Icons.CalendarClock}
          />
          {isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((index) => (
                <div key={index} className="skeleton h-11" />
              ))}
            </div>
          ) : (data?.todaysFollowUps.length ?? 0) === 0 ? (
            <EmptyState icon={Icons.CheckCircle2} title="Nothing due today" description="You're all caught up." />
          ) : (
            <ul className="space-y-1.5">
              {data?.todaysFollowUps.map((task) => (
                <li key={task.id}>
                  <TaskRow task={task} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* My pending tasks */}
        <Card>
          <CardHeader title="My pending tasks" icon={Icons.ClipboardCheck} />
          {isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((index) => (
                <div key={index} className="skeleton h-11" />
              ))}
            </div>
          ) : (data?.myPendingTasks.length ?? 0) === 0 ? (
            <EmptyState icon={Icons.CheckCircle2} title="No open tasks" />
          ) : (
            <ul className="space-y-1.5">
              {data?.myPendingTasks.slice(0, 6).map((task) => (
                <li key={task.id}>
                  <TaskRow task={task} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Recent activity — straight from the append-only timeline */}
        <Card>
          <CardHeader
            title="Recent activities"
            subtitle="Automatically recorded, never editable"
            icon={Icons.Clock}
          />
          {isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((index) => (
                <div key={index} className="skeleton h-10" />
              ))}
            </div>
          ) : (data?.recentActivities.length ?? 0) === 0 ? (
            <EmptyState icon={Icons.Inbox} title="No activity yet" />
          ) : (
            <ol className="space-y-2.5">
              {data?.recentActivities.map((event) => (
                <li key={event.id} className="flex gap-2.5">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden />
                  <div className="min-w-0">
                    <p className="truncate text-xs text-ink">{event.summary}</p>
                    <p className="text-[10px] text-ink-3" title={formatDateTime(event.occurredAt)}>
                      {event.actorName} · {formatRelative(event.occurredAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}

function TaskRow({ task }: { task: DashboardPayload['todaysFollowUps'][number] }) {
  const content = (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-lg border p-2.5 transition-colors',
        task.overdue ? 'border-danger-ring bg-danger-tint/50' : 'border-line hover:bg-canvas',
      )}
    >
      <span
        className={cn(
          'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md',
          task.overdue ? 'bg-danger text-white' : 'bg-slate2-tint text-ink-3',
        )}
      >
        <Icons.Clock size={12} strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-ink">{task.title}</p>
        <p className="truncate text-[10px] text-ink-3">
          {task.applicantName ? `${task.applicantName} · ` : ''}
          {task.overdue ? 'Overdue ' : 'Due '}
          {formatRelative(task.dueDate)}
        </p>
      </div>
      {task.priority === 'urgent' || task.priority === 'high' ? (
        <Chip tone={task.priority === 'urgent' ? 'red' : 'orange'}>{task.priority}</Chip>
      ) : null}
    </div>
  );

  return task.applicantId ? <Link to={`/applicants/${task.applicantId}`}>{content}</Link> : content;
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}
