import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/layout/AppShell';
import { StatusBadge } from '@/components/ui/Badge';
import { Card, EmptyState, QueryError } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { formatRelative, humanise } from '@/lib/format';
import { Icons, type LucideIcon } from '@/lib/icons';

interface QueueRow {
  recordId: string;
  recordCode: string;
  applicantId: string;
  applicantName: string;
  recordTitle: string | null;
  status: string;
  paymentStatus?: string;
  deliveryStatus?: string;
  /** Certificates queue: whether the row needs the file or the sign-off. */
  waitingOn?: 'upload' | 'verification';
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  updatedAt: string;
}

/**
 * Shared operational queue screen (W-19, W-21, W-23).
 *
 * Verification, certificates and dispatch are the same shape: a list of records
 * waiting on this team, oldest first, each row opening the profile at the right
 * tab. One component rather than three near-identical ones — a change to how a
 * queue behaves should land everywhere at once.
 */
export function QueuePage({
  title,
  subtitle,
  icon,
  endpoint,
  tab,
  emptyTitle,
  emptyDescription,
  extraColumns = [],
}: {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  endpoint: string;
  tab: string;
  emptyTitle: string;
  emptyDescription: string;
  extraColumns?: Array<Column<QueueRow>>;
}) {
  const navigate = useNavigate();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['queue', endpoint],
    queryFn: ({ signal }) => api.get<QueueRow[]>(endpoint, undefined, signal),
    // Queues are worked live by a team, so a short stale window matters more
    // here than on a reference screen.
    staleTime: 20_000,
    refetchInterval: 60_000,
  });

  const columns: Array<Column<QueueRow>> = [
    {
      key: 'applicant',
      header: 'Applicant',
      maxWidth: '220px',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-semibold text-ink">{row.applicantName}</p>
          <p className="tabular text-[10px] text-ink-3">{row.recordCode}</p>
        </div>
      ),
    },
    {
      key: 'recordTitle',
      header: 'Record',
      hideBelow: 'md',
      // Titles run to a full sentence. Clamped by the table so the columns
      // after it — status, payment, waiting — stay on screen.
      truncate: true,
      render: (row) => (
        <span className="text-ink-2" title={row.recordTitle ?? undefined}>
          {row.recordTitle ?? '—'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '160px',
      render: (row) => <StatusBadge status={row.status} size="sm" />,
    },
    ...extraColumns,
    {
      key: 'waiting',
      header: 'Waiting',
      align: 'right',
      width: '130px',
      render: (row) => {
        const days = Math.floor((Date.now() - new Date(row.updatedAt).getTime()) / 86_400_000);
        return (
          <span
            className={cn(
              'whitespace-nowrap text-xs',
              // The colour is the point of the column: a queue nobody can
              // triage at a glance is just a list.
              days > 7 ? 'font-semibold text-danger' : days > 3 ? 'text-warn' : 'text-ink-3',
            )}
          >
            {formatRelative(row.updatedAt)}
          </span>
        );
      },
    },
  ];

  return (
    <div className="p-4 sm:p-5">
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          data && data.length > 0 ? (
            <span className="tabular rounded-full bg-brand-tint px-3 py-1 text-xs font-semibold text-brand">
              {data.length} waiting
            </span>
          ) : null
        }
      />

      <Card padded={false}>
        {isError ? (
          <QueryError
            title="Couldn't load this queue"
            description="The list below may not be empty — the request failed."
            onRetry={() => void refetch()}
          />
        ) : (
          <DataTable
            columns={columns}
            rows={data ?? []}
            rowKey={(row) => row.recordId}
            onRowClick={(row) => navigate(`/applicants/${row.applicantId}?tab=${tab}`)}
            loading={isLoading}
            emptyState={<EmptyState icon={icon} title={emptyTitle} description={emptyDescription} />}
          />
        )}
      </Card>
    </div>
  );
}

/**
 * §Pipeline 1 — the front of the pipeline.
 *
 * Every other stage had a list and this one did not, which made it the stage
 * most likely to grow a backlog nobody saw: an application nobody had started
 * on was invisible until someone thought to filter the applicant table by hand.
 * Opens on the Application tab, because the first thing anybody does with a new
 * one is read what was submitted.
 */
export function NewApplicationsQueuePage() {
  return (
    <QueuePage
      title="New applications"
      subtitle="Submitted and not yet picked up, oldest first."
      icon={Icons.FilePlus2}
      endpoint="/queues/new-applications"
      tab="application"
      emptyTitle="Nothing waiting"
      emptyDescription="Every submitted application has been started."
    />
  );
}

export function VerificationQueuePage() {
  return (
    <QueuePage
      title="Verification queue"
      subtitle="Applications whose documents are still being checked, oldest first."
      icon={Icons.ShieldCheck}
      endpoint="/queues/verification"
      tab="evidence"
      emptyTitle="Nothing to verify"
      emptyDescription="Every new application has been through verification."
    />
  );
}

/**
 * §Pipeline 3 — the approver's queue.
 *
 * Its own screen rather than a filter on Verification. They are different jobs
 * done by different people: one works through documents, the other through
 * decisions, and a single list meant neither could see what was actually
 * waiting on them.
 */
export function ApprovalsQueuePage() {
  return (
    <QueuePage
      title="Approval pending"
      subtitle="Verified applications waiting on an approve or reject decision."
      icon={Icons.ClipboardCheck}
      endpoint="/queues/approvals"
      tab="evidence"
      emptyTitle="No decisions waiting"
      emptyDescription="Every verified application has been decided."
    />
  );
}

/**
 * §Pipeline 4 — approved, and the letter and invoice still to follow.
 *
 * The stage that most needs a list, because nothing about it is urgent-looking:
 * the record has been approved, so it reads as done, and the outstanding work —
 * telling the applicant, raising the payment — leaves no trace on the record
 * until somebody does it.
 */
export function SelectionSentQueuePage() {
  return (
    <QueuePage
      title="Selection sent"
      subtitle="Approved records — check the selection letter went out, then raise the payment."
      icon={Icons.Award}
      endpoint="/queues/selection-sent"
      tab="communication"
      emptyTitle="Nothing awaiting selection follow-up"
      emptyDescription="Every approved record has moved on to payment."
    />
  );
}

export function PaymentsQueuePage() {
  return (
    <QueuePage
      title="Fees & payments"
      subtitle="Records with money still outstanding, longest waiting first."
      icon={Icons.IndianRupee}
      endpoint="/queues/payments"
      tab="payment"
      emptyTitle="Nothing outstanding"
      emptyDescription="Every raised payment has been settled."
      extraColumns={[
        {
          key: 'paymentStatus',
          header: 'Payment',
          hideBelow: 'lg',
          width: '110px',
          render: (row) => (
            <span
              className={cn(
                'text-xs font-medium',
                row.paymentStatus === 'partial' ? 'text-warn' : 'text-danger',
              )}
            >
              {humanise(row.paymentStatus ?? '')}
            </span>
          ),
        },
      ]}
    />
  );
}

export function PublicationsQueuePage() {
  return (
    <QueuePage
      title="Publications"
      subtitle="Records eligible for the book, website or social media that haven't been published."
      icon={Icons.Newspaper}
      endpoint="/queues/publications"
      tab="publications"
      emptyTitle="Nothing to publish"
      emptyDescription="Every eligible record has a publication entry."
    />
  );
}

export function CertificatesQueuePage() {
  return (
    <QueuePage
      title="Certificates"
      subtitle="Paid records whose certificate has not yet been uploaded and verified."
      icon={Icons.Award}
      endpoint="/certificates/queue"
      tab="certificate"
      emptyTitle="No certificates pending"
      emptyDescription="Every paid record has its certificate uploaded and verified."
      extraColumns={[
        {
          // The two halves of this stage are different jobs — one needs the
          // designer's file, the other needs someone to check it — and a queue
          // that cannot tell them apart makes an operator open every row to
          // find out which is which.
          key: 'waitingOn',
          header: 'Waiting on',
          width: '140px',
          render: (row) =>
            row.waitingOn === 'verification' ? (
              <span className="text-xs font-medium text-warn">Verification</span>
            ) : (
              <span className="text-xs text-ink-2">Upload</span>
            ),
        },
        {
          key: 'paymentStatus',
          header: 'Payment',
          hideBelow: 'lg',
          width: '110px',
          render: (row) => (
            <span className="text-xs text-ok">{humanise(row.paymentStatus ?? '')}</span>
          ),
        },
      ]}
    />
  );
}

export function DispatchQueuePage() {
  return (
    <QueuePage
      title="Dispatch"
      subtitle="Certificates ready to send, and parcels in transit."
      icon={Icons.Truck}
      endpoint="/dispatch/queue"
      tab="dispatch"
      emptyTitle="Nothing to dispatch"
      emptyDescription="Every ready record has been sent."
      extraColumns={[
        {
          key: 'destination',
          header: 'Destination',
          hideBelow: 'lg',
          maxWidth: '200px',
          truncate: true,
          render: (row) => {
            const destination = [row.city, row.state, row.pincode].filter(Boolean).join(', ');
            return (
              <span className="text-xs text-ink-2" title={destination || undefined}>
                {destination || '—'}
              </span>
            );
          },
        },
        {
          key: 'deliveryStatus',
          header: 'Delivery',
          hideBelow: 'xl',
          width: '120px',
          render: (row) => (
            <span className="text-xs text-ink-2">{humanise(row.deliveryStatus ?? '')}</span>
          ),
        },
      ]}
    />
  );
}
