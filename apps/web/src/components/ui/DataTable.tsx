import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { ICON_SIZE, ICON_STROKE, Icons } from '@/lib/icons';

/**
 * C-06 DataTable.
 *
 * Server-driven throughout: sorting and paging are query params, not
 * client-side array operations, because the list is 12,000 rows and the
 * browser must never hold all of them.
 */
export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Sortable columns must match the API's allow-list of indexed columns. */
  sortable?: boolean;
  width?: string;
  align?: 'left' | 'right' | 'center';
  render: (row: T) => ReactNode;
  /** Hidden below this breakpoint — the list stays usable on a tablet. */
  hideBelow?: 'sm' | 'md' | 'lg' | 'xl';
}

const HIDE_CLASS = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
  xl: 'hidden xl:table-cell',
} as const;

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  sortBy,
  sortDir,
  onSort,
  loading,
  skeletonRows = 8,
  emptyState,
  rowClassName,
}: {
  columns: ReadonlyArray<Column<T>>;
  rows: readonly T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  onSort?: (key: string) => void;
  loading?: boolean;
  skeletonRows?: number;
  emptyState?: ReactNode;
  rowClassName?: (row: T) => string | undefined;
}) {
  if (!loading && rows.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  return (
    <div className="scrollbar-slim overflow-x-auto">
      <table className="w-full min-w-[820px] border-collapse text-sm">
        <thead>
          <tr>
            {columns.map((column) => {
              const isSorted = sortBy === column.key;
              return (
                <th
                  key={column.key}
                  scope="col"
                  style={column.width ? { width: column.width } : undefined}
                  aria-sort={isSorted ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
                  className={cn(
                    'sticky top-0 z-10 border-b border-line bg-canvas px-4 py-2.5 text-2xs font-semibold uppercase tracking-wider text-ink-3',
                    column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left',
                    column.hideBelow ? HIDE_CLASS[column.hideBelow] : '',
                  )}
                >
                  {column.sortable && onSort ? (
                    <button
                      type="button"
                      onClick={() => onSort(column.key)}
                      className="inline-flex items-center gap-1 transition-colors hover:text-ink"
                    >
                      {column.header}
                      {isSorted ? (
                        <Icons.ChevronDown
                          size={13}
                          strokeWidth={2.2}
                          className={cn('text-brand transition-transform', sortDir === 'asc' && 'rotate-180')}
                        />
                      ) : (
                        <Icons.ChevronsUpDown size={13} strokeWidth={ICON_STROKE} className="opacity-40" />
                      )}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {loading
            ? Array.from({ length: skeletonRows }, (_, index) => (
                <tr key={`skeleton-${index}`}>
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={cn('border-b border-line/70 px-4 py-3', column.hideBelow ? HIDE_CLASS[column.hideBelow] : '')}
                    >
                      <div className="skeleton h-4" style={{ width: `${55 + ((index * 13) % 40)}%` }} />
                    </td>
                  ))}
                </tr>
              ))
            : rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  // Rows are reachable and activatable by keyboard, not just by
                  // mouse — the list is the main navigation surface of the app.
                  tabIndex={onRowClick ? 0 : undefined}
                  role={onRowClick ? 'link' : undefined}
                  onKeyDown={
                    onRowClick
                      ? (event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            onRowClick(row);
                          }
                        }
                      : undefined
                  }
                  className={cn(
                    'border-b border-line/70 transition-colors',
                    onRowClick && 'cursor-pointer hover:bg-brand-tint/50 focus-visible:bg-brand-tint',
                    rowClassName?.(row),
                  )}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={cn(
                        'px-4 py-2.5 align-middle',
                        column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left',
                        column.hideBelow ? HIDE_CLASS[column.hideBelow] : '',
                      )}
                    >
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Cursor pagination controls.
 *
 * Deliberately next/previous rather than numbered pages: a keyset cursor has no
 * concept of "page 7", and pretending otherwise would mean going back to slow
 * OFFSET queries.
 */
export function CursorPagination({
  shown,
  total,
  hasNext,
  hasPrevious,
  onNext,
  onPrevious,
  pageSize,
  onPageSizeChange,
}: {
  shown: number;
  total?: number;
  hasNext: boolean;
  hasPrevious: boolean;
  onNext: () => void;
  onPrevious: () => void;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
      <p className="tabular text-xs text-ink-3">
        Showing <span className="font-semibold text-ink-2">{shown}</span>
        {total !== undefined ? (
          <>
            {' '}of <span className="font-semibold text-ink-2">{total.toLocaleString('en-IN')}</span>
          </>
        ) : null}{' '}
        {total === 1 ? 'record' : 'records'}
      </p>

      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-ink-3">
          Rows
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="h-7 cursor-pointer rounded-md border border-line bg-white px-1.5 text-xs"
          >
            {[25, 50, 100].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onPrevious}
            disabled={!hasPrevious}
            className="grid h-7 w-7 place-items-center rounded-md border border-line bg-white text-ink-2 transition-colors hover:bg-canvas disabled:opacity-35"
            aria-label="Previous page"
          >
            <Icons.ChevronLeft size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={!hasNext}
            className="grid h-7 w-7 place-items-center rounded-md border border-line bg-white text-ink-2 transition-colors hover:bg-canvas disabled:opacity-35"
            aria-label="Next page"
          >
            <Icons.ChevronRight size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />
          </button>
        </div>
      </div>
    </div>
  );
}
