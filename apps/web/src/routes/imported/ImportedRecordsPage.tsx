import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/AppShell';
import { Chip } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Input } from '@/components/ui/Field';
import { useAuth } from '@/hooks/useAuth';
import { useDebounce } from '@/hooks/useDebounce';
import { ApiError, api } from '@/lib/api-client';
import { formatDate, formatRelative } from '@/lib/format';
import { ICON_SIZE, ICON_STROKE, Icons } from '@/lib/icons';
import { queryKeys } from '@/lib/query-client';
import type { ImportedRecord, ImportedRecordList, ImportedSyncResult } from './types';

const PAGE_SIZE = 50;

/**
 * Imported Records — offline certificates mirrored from the public website.
 *
 * These are certificates the website issued with no application behind them:
 * somebody already held the record and the paperwork was catalogued after the
 * fact. They are kept out of the applicant pipeline entirely, because there is
 * no verification, payment or dispatch work possible on them — putting them in
 * those queues would bury the rows that do need action.
 *
 * The website stays the source of truth. Nothing here is ever pushed back; the
 * only writes are the operator's own follow-ups.
 */
export default function ImportedRecordsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useAuth();

  const [searchInput, setSearchInput] = useState(searchParams.get('q') ?? '');
  const debouncedSearch = useDebounce(searchInput, 300);
  const offset = Number(searchParams.get('offset') ?? 0);

  const queryParams = { search: debouncedSearch || undefined, limit: PAGE_SIZE, offset };

  const { data, isFetching, isLoading } = useQuery({
    queryKey: queryKeys.importedRecords(queryParams),
    queryFn: ({ signal }) =>
      api.get<ImportedRecordList>('/imported-records', queryParams, signal),
    placeholderData: keepPreviousData,
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  const sync = useMutation({
    mutationFn: (full: boolean) => api.post<ImportedSyncResult>('/imported-records/sync', { full }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['imported-records'] });

      if (result.total === 0) {
        toast.info('Already up to date', {
          description: 'The website has no offline certificates newer than the ones held here.',
        });
        return;
      }

      toast.success(`${result.imported} new, ${result.updated} refreshed`, {
        description: `Read ${result.total} certificate${result.total === 1 ? '' : 's'} from the website.`,
      });
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not reach the website'),
  });

  function updateParams(mutate: (params: URLSearchParams) => void) {
    const next = new URLSearchParams(searchParams);
    mutate(next);
    setSearchParams(next, { replace: true });
  }

  const columns: Array<Column<ImportedRecord>> = [
    {
      key: 'holder',
      header: 'Holder',
      maxWidth: '220px',
      render: (row) => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-semibold text-ink">{row.holderName}</span>
            {row.revoked ? (
              <Icons.Ban size={13} strokeWidth={2.2} className="shrink-0 text-danger" />
            ) : null}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="tabular text-[10px] text-ink-3">{row.certificateNumber}</span>
            {row.location ? (
              <span className="truncate text-[10px] text-ink-3">· {row.location}</span>
            ) : null}
          </div>
        </div>
      ),
    },
    {
      key: 'recordTitle',
      header: 'Record title',
      hideBelow: 'md',
      // Capped for the same reason as the applicant list: an uncapped title
      // column sizes itself to the longest record in the page and squeezes
      // everything after it. See `Column.maxWidth`.
      maxWidth: '320px',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-ink-2" title={row.recordTitle}>
            {row.recordTitle}
          </p>
          {row.category ? <p className="text-[10px] text-ink-3">{row.category}</p> : null}
        </div>
      ),
    },
    {
      key: 'contact',
      header: 'Contact',
      hideBelow: 'lg',
      width: '190px',
      // Historic holders were often catalogued with no contact details at all.
      // Showing that plainly is the point: it tells the operator up front that
      // the email and WhatsApp actions will not be available on this row.
      render: (row) =>
        row.email || row.phone ? (
          <div className="min-w-0 text-xs">
            {row.email ? <p className="truncate text-ink-2">{row.email}</p> : null}
            {row.phone ? <p className="tabular text-[10px] text-ink-3">{row.phone}</p> : null}
          </div>
        ) : (
          <span className="text-xs text-ink-4">No contact details</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '130px',
      render: (row) =>
        row.revoked ? (
          <Chip tone="red">Revoked</Chip>
        ) : row.isPublished ? (
          <Chip tone="green">Published</Chip>
        ) : (
          <Chip tone="slate">Unpublished</Chip>
        ),
    },
    {
      key: 'issuedAt',
      header: 'Issued',
      align: 'right',
      width: '120px',
      render: (row) => (
        <span className="whitespace-nowrap text-xs text-ink-3">{formatDate(row.issuedAt)}</span>
      ),
    },
  ];

  const newest = rows[0]?.syncedAt;

  return (
    <div className="p-4 sm:p-5">
      <PageHeader
        title="Imported Records"
        subtitle="Offline certificates from the website. No application, no payment — catalogued after the fact."
        actions={
          can('integrations:manage') ? (
            <>
              <Button
                variant="secondary"
                icon={Icons.RefreshCw}
                loading={sync.isPending}
                onClick={() => sync.mutate(false)}
              >
                Sync from website
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => sync.mutate(true)}
                disabled={sync.isPending}
                title="Re-read every offline certificate, not just the ones issued since the last sync."
              >
                Full re-sync
              </Button>
            </>
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
                  // A new search invalidates the current page offset.
                  params.delete('offset');
                });
              }}
              placeholder="Search holder, record title or certificate number…"
              prefix={<Icons.Search size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />}
              suffix={
                isFetching ? (
                  <Icons.Loader2 size={ICON_SIZE.sm} className="animate-spin text-ink-3" />
                ) : undefined
              }
            />
          </div>

          {newest ? (
            <p className="text-2xs text-ink-3">Last synced {formatRelative(newest)}</p>
          ) : null}
        </div>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          onRowClick={(row) => navigate(`/imported-records/${row.id}`)}
          loading={isLoading}
          rowClassName={(row) => (row.revoked ? 'bg-danger-tint/40' : undefined)}
          emptyState={
            <EmptyState
              icon={debouncedSearch ? Icons.Search : Icons.Award}
              title={debouncedSearch ? 'No matching records' : 'Nothing imported yet'}
              description={
                debouncedSearch
                  ? 'Try a different name, title or certificate number.'
                  : "Run a sync to mirror the website's offline certificates into this list."
              }
              action={
                !debouncedSearch && can('integrations:manage') ? (
                  <Button
                    variant="primary"
                    icon={Icons.RefreshCw}
                    loading={sync.isPending}
                    onClick={() => sync.mutate(true)}
                  >
                    Sync from website
                  </Button>
                ) : null
              }
            />
          }
        />

        {rows.length > 0 ? (
          <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5">
            <p className="tabular text-2xs text-ink-3">
              {offset + 1}–{offset + rows.length} of {total}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                icon={Icons.ChevronLeft}
                disabled={offset === 0}
                onClick={() =>
                  updateParams((params) =>
                    params.set('offset', String(Math.max(0, offset - PAGE_SIZE))),
                  )
                }
              >
                Previous
              </Button>
              <Button
                variant="ghost"
                size="sm"
                iconRight={Icons.ChevronRight}
                disabled={offset + rows.length >= total}
                onClick={() =>
                  updateParams((params) => params.set('offset', String(offset + PAGE_SIZE)))
                }
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
