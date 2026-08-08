import { ORDERED_STATUSES } from '@nbr/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/layout/AppShell';
import { FlagChip, StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState } from '@/components/ui/Card';
import { CursorPagination, DataTable, type Column } from '@/components/ui/DataTable';
import { Input } from '@/components/ui/Field';
import { useAuth } from '@/hooks/useAuth';
import { useDebounce } from '@/hooks/useDebounce';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { formatRelative, humanise } from '@/lib/format';
import { ICON_SIZE, ICON_STROKE, Icons } from '@/lib/icons';
import { queryKeys } from '@/lib/query-client';

interface ApplicantListRow {
  recordId: string;
  applicantId: string;
  applicantCode: string;
  recordCode: string;
  fullName: string;
  mobile: string;
  city: string | null;
  recordTitle: string | null;
  categoryName: string | null;
  status: string;
  assignedToName: string | null;
  paymentStatus: string;
  deliveryStatus: string;
  isBlacklisted: boolean;
  flags: string[];
  updatedAt: string;
}

const PAYMENT_TONE: Record<string, string> = {
  paid: 'text-ok',
  partial: 'text-warn',
  pending: 'text-warn',
  not_raised: 'text-ink-3',
  refunded: 'text-slate2',
  waived: 'text-slate2',
};

/**
 * W-04 Applicant list (§3).
 *
 * Filter state lives in the URL, not in component state. That makes a filtered
 * view shareable, survivable across a refresh, and reachable from a dashboard
 * stat card — `/applicants?status=payment_pending` is a real destination.
 */
/** Lifecycle stages, in the order a record passes through them. */
const STAGE_GROUPS: ReadonlyArray<{ stage: string; label: string }> = [
  { stage: 'intake', label: 'Intake' },
  { stage: 'verification', label: 'Review' },
  { stage: 'decision', label: 'Decision' },
  { stage: 'payment', label: 'Payment' },
  { stage: 'fulfilment', label: 'Fulfilment' },
  { stage: 'closed', label: 'Closed' },
];

export default function ApplicantListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { can } = useAuth();

  const [searchInput, setSearchInput] = useState(searchParams.get('q') ?? '');
  const debouncedSearch = useDebounce(searchInput, 300);

  // Which stage's statuses are open, if any. Deliberately component state
  // rather than a URL param: it is a disclosure, not a filter, and a shared
  // link should reproduce the results, not which drawer happened to be open.
  const [openStage, setOpenStage] = useState<string | null>(null);

  // Cursor history so "previous" works without re-querying from the start.
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();

  const statusFilter = searchParams.getAll('status');
  const sortBy = searchParams.get('sortBy') ?? 'updatedAt';
  const sortDir = (searchParams.get('sortDir') as 'asc' | 'desc') ?? 'desc';
  const limit = Number(searchParams.get('limit') ?? 50);

  const queryParams = useMemo(
    () => ({
      q: debouncedSearch || undefined,
      status: statusFilter.length > 0 ? statusFilter : undefined,
      sortBy,
      sortDir,
      limit,
      cursor,
      withTotal: true,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [debouncedSearch, statusFilter.join(','), sortBy, sortDir, limit, cursor],
  );

  const { data, isFetching, isLoading } = useQuery({
    queryKey: queryKeys.applicantList(queryParams),
    queryFn: ({ signal }) =>
      api.getWithMeta<ApplicantListRow[]>('/applicants', queryParams, signal),
    // Keeps the previous page visible while the next one loads, so the table
    // doesn't collapse to skeletons on every filter change.
    placeholderData: keepPreviousData,
  });

  const rows = data?.data ?? [];
  const nextCursor = (data?.meta.nextCursor as string | null) ?? null;
  const total = data?.meta.total as number | undefined;

  const updateParams = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const next = new URLSearchParams(searchParams);
      mutate(next);
      setSearchParams(next, { replace: true });
      // Any filter or sort change invalidates the cursor — page 3 of the old
      // result set is meaningless against a different filter.
      setCursor(undefined);
      setCursorStack([]);
    },
    [searchParams, setSearchParams],
  );

  /**
   * Select or clear a whole stage at once.
   *
   * "Show me everything in fulfilment" is a question operators actually ask, and
   * answering it by clicking four chips is the kind of friction that makes a
   * filter go unused.
   */
  function toggleStage(codes: readonly string[]) {
    updateParams((params) => {
      const current = params.getAll('status');
      const allSelected = codes.every((code) => current.includes(code));
      params.delete('status');

      const next = allSelected
        ? current.filter((code) => !codes.includes(code))
        : [...new Set([...current, ...codes])];

      for (const value of next) params.append('status', value);
    });
  }

  function toggleStatus(status: string) {
    updateParams((params) => {
      const current = params.getAll('status');
      params.delete('status');
      const next = current.includes(status)
        ? current.filter((s) => s !== status)
        : [...current, status];
      for (const value of next) params.append('status', value);
    });
  }

  function handleSort(key: string) {
    updateParams((params) => {
      if (params.get('sortBy') === key) {
        params.set('sortDir', params.get('sortDir') === 'asc' ? 'desc' : 'asc');
      } else {
        params.set('sortBy', key);
        params.set('sortDir', 'desc');
      }
    });
  }

  const columns: Array<Column<ApplicantListRow>> = [
    {
      key: 'name',
      header: 'Applicant',
      sortable: true,
      maxWidth: '220px',
      render: (row) => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-semibold text-ink">{row.fullName}</span>
            {row.isBlacklisted ? (
              <Icons.Ban size={13} strokeWidth={2.2} className="shrink-0 text-danger" />
            ) : null}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="tabular text-[10px] text-ink-3">{row.applicantCode}</span>
            {row.city ? <span className="truncate text-[10px] text-ink-3">· {row.city}</span> : null}
          </div>
          {row.flags.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {row.flags.slice(0, 3).map((flag) => (
                <FlagChip key={flag} flag={flag} />
              ))}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      key: 'recordTitle',
      header: 'Record title',
      hideBelow: 'md',
      // Record titles run from one word to a full sentence — "Proposed Record
      // Title: Most Versatile Multi-Category Youth Achiever (65+ Certifications)"
      // is real data. Left to size itself the column took whatever it needed and
      // pushed Status, Payment and Dispatch off the right edge. Capped, the long
      // ones ellipsize and the full text is one hover (or one click through) away.
      maxWidth: '320px',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-ink-2" title={row.recordTitle ?? undefined}>
            {row.recordTitle ?? '—'}
          </p>
          <p className="tabular text-[10px] text-ink-3">
            {row.recordCode}
            {row.categoryName ? ` · ${row.categoryName}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      width: '160px',
      render: (row) => <StatusBadge status={row.status} size="sm" />,
    },
    {
      key: 'assigned',
      header: 'Assigned',
      hideBelow: 'lg',
      width: '140px',
      render: (row) => (
        <span className="truncate text-xs text-ink-2">{row.assignedToName ?? '—'}</span>
      ),
    },
    {
      key: 'paymentStatus',
      header: 'Payment',
      sortable: true,
      hideBelow: 'lg',
      width: '110px',
      render: (row) => (
        <span className={cn('text-xs font-medium', PAYMENT_TONE[row.paymentStatus] ?? 'text-ink-3')}>
          {humanise(row.paymentStatus)}
        </span>
      ),
    },
    {
      key: 'deliveryStatus',
      header: 'Dispatch',
      sortable: true,
      hideBelow: 'xl',
      width: '120px',
      render: (row) => (
        <span className="text-xs text-ink-2">
          {row.deliveryStatus === 'not_dispatched' ? '—' : humanise(row.deliveryStatus)}
        </span>
      ),
    },
    {
      key: 'updatedAt',
      header: 'Last updated',
      sortable: true,
      align: 'right',
      width: '130px',
      render: (row) => (
        <span className="whitespace-nowrap text-xs text-ink-3">{formatRelative(row.updatedAt)}</span>
      ),
    },
  ];

  return (
    <div className="p-4 sm:p-5">
      <PageHeader
        title="Applicants"
        subtitle="Every record, searchable across name, mobile, email, record ID and title."
        actions={
          can('applicants:create') ? (
            <Button variant="primary" icon={Icons.Plus} onClick={() => navigate('/applicants/new')}>
              Add Applicant
            </Button>
          ) : null
        }
      />

      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-3">
          <div className="min-w-[220px] flex-1">
            <Input
              value={searchInput}
              onChange={(event) => {
                setSearchInput(event.target.value);
                updateParams((params) => {
                  if (event.target.value) params.set('q', event.target.value);
                  else params.delete('q');
                });
              }}
              placeholder="Search this list…"
              prefix={<Icons.Search size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />}
              suffix={
                isFetching ? (
                  <Icons.Loader2 size={ICON_SIZE.sm} className="animate-spin text-ink-3" />
                ) : undefined
              }
            />
          </div>

          {statusFilter.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              icon={Icons.X}
              onClick={() => updateParams((params) => params.delete('status'))}
            >
              Clear {statusFilter.length} filter{statusFilter.length === 1 ? '' : 's'}
            </Button>
          ) : null}
        </div>

        {/*
          Status filters as one stage bar that opens a single drawer.

          The first attempt laid all seventeen statuses out at once in six
          labelled rows. Everything was visible, but it cost roughly four
          hundred pixels above the table — on a laptop the first record sat
          below the fold, so the common case (glance at the list) paid the full price
          of the rare case (build a precise filter). One row of stage chips is
          the summary; the statuses inside a stage appear only when that stage
          is opened, and close again on the next click.
        */}
        <div className="border-b border-line px-3 py-2">
          <div className="scrollbar-slim flex items-center gap-1.5 overflow-x-auto">
            {STAGE_GROUPS.map((group) => {
              const statuses = ORDERED_STATUSES.filter((status) => status.stage === group.stage);
              if (statuses.length === 0) return null;

              const activeInGroup = statuses.filter((status) =>
                statusFilter.includes(status.code),
              ).length;
              const isOpen = openStage === group.stage;

              return (
                <button
                  key={group.stage}
                  type="button"
                  onClick={() => setOpenStage(isOpen ? null : group.stage)}
                  aria-expanded={isOpen}
                  className={cn(
                    'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                    isOpen
                      ? 'border-ink-4/70 bg-canvas text-ink'
                      : activeInGroup > 0
                        ? 'border-brand/40 bg-brand-tint text-brand'
                        : 'border-line bg-white text-ink-2 hover:border-ink-4/60 hover:bg-canvas',
                  )}
                >
                  {group.label}
                  {activeInGroup > 0 ? (
                    <span className="tabular rounded-full bg-brand px-1.5 text-[10px] font-semibold leading-4 text-white">
                      {activeInGroup}
                    </span>
                  ) : null}
                  <Icons.ChevronDown
                    size={12}
                    strokeWidth={2.2}
                    className={cn('transition-transform', isOpen && 'rotate-180')}
                  />
                </button>
              );
            })}
          </div>

          {openStage ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-line/70 pt-2">
              {(() => {
                const statuses = ORDERED_STATUSES.filter((status) => status.stage === openStage);
                const codes = statuses.map((status) => status.code);
                const allSelected = codes.every((code) => statusFilter.includes(code));

                return (
                  <>
                    <button
                      type="button"
                      onClick={() => toggleStage(codes)}
                      className="shrink-0 text-2xs font-semibold uppercase tracking-wider text-ink-3 transition-colors hover:text-brand"
                    >
                      {allSelected ? 'Clear all' : 'Select all'}
                    </button>

                    {statuses.map((status) => {
                      const active = statusFilter.includes(status.code);
                      return (
                        <button
                          key={status.code}
                          type="button"
                          onClick={() => toggleStatus(status.code)}
                          aria-pressed={active}
                          className={cn(
                            'shrink-0 rounded-full border px-2.5 py-1 text-2xs font-medium transition-colors',
                            active
                              ? 'border-brand bg-brand text-white'
                              : 'border-line bg-white text-ink-2 hover:border-ink-4/60 hover:bg-canvas',
                          )}
                        >
                          {status.label}
                        </button>
                      );
                    })}
                  </>
                );
              })()}
            </div>
          ) : null}
        </div>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.recordId}
          onRowClick={(row) => navigate(`/applicants/${row.applicantId}`)}
          sortBy={sortBy}
          sortDir={sortDir}
          onSort={handleSort}
          loading={isLoading}
          // Blacklisted rows get a red tint everywhere they appear (§W-04).
          rowClassName={(row) => (row.isBlacklisted ? 'bg-danger-tint/40' : undefined)}
          emptyState={
            <EmptyState
              icon={Icons.Search}
              title={debouncedSearch || statusFilter.length > 0 ? 'No matching records' : 'No applicants yet'}
              description={
                debouncedSearch || statusFilter.length > 0
                  ? 'Try a different search term or clear your filters.'
                  : 'Add the first applicant to get started.'
              }
              action={
                can('applicants:create') && !debouncedSearch && statusFilter.length === 0 ? (
                  <Button variant="primary" icon={Icons.Plus} onClick={() => navigate('/applicants/new')}>
                    Add Applicant
                  </Button>
                ) : null
              }
            />
          }
        />

        {rows.length > 0 ? (
          <CursorPagination
            shown={rows.length}
            total={total}
            hasNext={Boolean(nextCursor)}
            hasPrevious={cursorStack.length > 0}
            pageSize={limit}
            onPageSizeChange={(size) => updateParams((params) => params.set('limit', String(size)))}
            onNext={() => {
              if (!nextCursor) return;
              setCursorStack((stack) => [...stack, cursor ?? '']);
              setCursor(nextCursor);
            }}
            onPrevious={() => {
              setCursorStack((stack) => {
                const previous = stack.at(-1);
                setCursor(previous || undefined);
                return stack.slice(0, -1);
              });
            }}
          />
        ) : null}
      </Card>
    </div>
  );
}
