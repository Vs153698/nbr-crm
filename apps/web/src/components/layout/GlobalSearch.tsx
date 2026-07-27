import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-client';
import { ICON_SIZE, ICON_STROKE, Icons } from '@/lib/icons';
import { StatusBadge } from '@/components/ui/Badge';
import { useDebounce } from '@/hooks/useDebounce';

interface SearchHit {
  kind: string;
  id: string;
  applicantId: string;
  primary: string;
  secondary: string;
  badge: string | null;
  isBlacklisted: boolean;
}

interface SearchResults {
  query: string;
  groups: Array<{ label: string; hits: SearchHit[] }>;
  total: number;
  tookMs: number;
}

/**
 * W-32 Global search (Ctrl+K).
 *
 * Debounced 150 ms per the plan, results grouped by kind, fully keyboard
 * navigable — this is how experienced staff move around the product, so it has
 * to work without ever touching the mouse.
 */
export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const debounced = useDebounce(term, 150);

  const { data, isFetching } = useQuery({
    queryKey: queryKeys.search(debounced),
    queryFn: ({ signal }) => api.get<SearchResults>('/search', { q: debounced }, signal),
    enabled: open && debounced.trim().length >= 2,
    staleTime: 20_000,
  });

  // Flattened once so arrow-key navigation can cross group boundaries without
  // the caller tracking a (group, item) pair.
  const flatHits = useMemo(() => data?.groups.flatMap((group) => group.hits) ?? [], [data]);

  useEffect(() => {
    setActiveIndex(0);
  }, [debounced]);

  // Ctrl/Cmd+K from anywhere, Escape to dismiss.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
        requestAnimationFrame(() => inputRef.current?.focus());
      }
      if (event.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function go(hit: SearchHit) {
    setOpen(false);
    setTerm('');
    navigate(`/applicants/${hit.applicantId}`);
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (flatHits.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % flatHits.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + flatHits.length) % flatHits.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const hit = flatHits[activeIndex];
      if (hit) go(hit);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        className="flex h-9 w-full max-w-xl items-center gap-2 rounded-lg border border-line bg-canvas px-3 text-left text-sm text-ink-3 transition-colors hover:border-ink-4/60 hover:bg-white"
      >
        <Icons.Search size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} className="shrink-0" />
        <span className="truncate">Search name, mobile, email, record ID, certificate no…</span>
        <kbd className="ml-auto hidden shrink-0 rounded border border-line bg-white px-1.5 py-0.5 font-sans text-[10px] font-semibold text-ink-3 sm:block">
          Ctrl K
        </kbd>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-navy/40 px-4 pt-[12vh] backdrop-blur-[2px] animate-fade-in"
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div
            className="w-full max-w-2xl overflow-hidden rounded-panel bg-white shadow-modal animate-scale-in"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Global search"
          >
            <div className="flex items-center gap-2.5 border-b border-line px-4">
              <Icons.Search size={ICON_SIZE.lg} strokeWidth={ICON_STROKE} className="shrink-0 text-ink-3" />
              <input
                ref={inputRef}
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                onKeyDown={onInputKeyDown}
                placeholder="Search applicants, records, certificates, tracking numbers…"
                className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-4"
                autoComplete="off"
                spellCheck={false}
                aria-autocomplete="list"
              />
              {isFetching ? (
                <Icons.Loader2 size={ICON_SIZE.sm} className="animate-spin text-ink-3" />
              ) : null}
            </div>

            <div className="scrollbar-slim max-h-[55vh] overflow-y-auto">
              {debounced.trim().length < 2 ? (
                <p className="px-4 py-8 text-center text-xs text-ink-3">
                  Type at least two characters to search.
                </p>
              ) : flatHits.length === 0 && !isFetching ? (
                <p className="px-4 py-8 text-center text-xs text-ink-3">
                  Nothing found for “{debounced}”.
                </p>
              ) : (
                data?.groups.map((group) => (
                  <div key={group.label} className="py-1">
                    <p className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-4">
                      {group.label}
                    </p>
                    {group.hits.map((hit) => {
                      const index = flatHits.indexOf(hit);
                      return (
                        <button
                          key={`${hit.kind}-${hit.id}`}
                          type="button"
                          onClick={() => go(hit)}
                          onMouseEnter={() => setActiveIndex(index)}
                          className={cn(
                            'flex w-full items-center gap-3 px-4 py-2 text-left transition-colors',
                            index === activeIndex ? 'bg-brand-tint' : 'hover:bg-canvas',
                          )}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate text-sm font-medium text-ink">{hit.primary}</span>
                              {hit.isBlacklisted ? (
                                <Icons.Ban size={13} strokeWidth={2.2} className="shrink-0 text-danger" />
                              ) : null}
                            </span>
                            <span className="block truncate text-xs text-ink-3">{hit.secondary}</span>
                          </span>
                          {hit.badge && hit.kind === 'record' ? (
                            <StatusBadge status={hit.badge} size="sm" />
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>

            <div className="flex items-center justify-between border-t border-line bg-canvas px-4 py-2 text-[10px] text-ink-3">
              <span>↑↓ navigate · ↵ open · esc close</span>
              {data ? <span className="tabular">{data.total} results · {data.tookMs} ms</span> : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
