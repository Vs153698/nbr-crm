import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { StatusBadge } from '@/components/ui/Badge';
import { Kbd } from '@/components/ui/Kbd';
import { useDebounce } from '@/hooks/useDebounce';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { ICON_SIZE, ICON_STROKE, Icons, type LucideIcon } from '@/lib/icons';
import { MOD_KEY, MOD_KEY_LABEL } from '@/lib/platform';
import { queryKeys } from '@/lib/query-client';

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

/** Result icons, so the eye can sort kinds before reading any text. */
const KIND_ICON: Record<string, LucideIcon> = {
  applicant: Icons.User,
  record: Icons.FileText,
  certificate: Icons.Award,
  dispatch: Icons.Truck,
};

const SEARCH_TIPS = [
  { label: 'Name', example: 'Rahul Verma' },
  { label: 'Mobile', example: '98765 43210' },
  { label: 'Applicant ID', example: 'NBRAP00001' },
  { label: 'Record ID', example: 'NBRR00005' },
  { label: 'Certificate no.', example: 'NBR/2026/00012' },
];

/**
 * W-32 Global search (⌘K / Ctrl+K).
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
  const listRef = useRef<HTMLDivElement>(null);
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

  const dismiss = useCallback(() => {
    setOpen(false);
    setTerm('');
    setActiveIndex(0);
  }, []);

  useEffect(() => {
    setActiveIndex(0);
  }, [debounced]);

  // Keep the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
        requestAnimationFrame(() => inputRef.current?.focus());
      }
      if (event.key === 'Escape') dismiss();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dismiss]);

  // The page behind a modal must not scroll under it.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  function go(hit: SearchHit) {
    dismiss();
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

  const tooShort = debounced.trim().length < 2;

  return (
    <>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        className={cn(
          'group flex h-9 w-full max-w-md items-center gap-2.5 rounded-lg border border-line bg-canvas px-3',
          'text-left text-[13px] text-ink-3 transition-colors duration-150',
          'hover:border-ink-4/50 hover:bg-white',
          'focus:outline-none focus-visible:border-nbr-orange focus-visible:ring-2 focus-visible:ring-nbr-orange/25',
        )}
      >
        <Icons.Search
          size={ICON_SIZE.sm}
          strokeWidth={ICON_STROKE}
          className="shrink-0 text-ink-4 transition-colors group-hover:text-ink-3"
        />
        <span className="truncate">Search applicants, records, certificates…</span>
        <span className="ml-auto hidden shrink-0 items-center gap-1 sm:flex">
          <Kbd label={MOD_KEY_LABEL}>{MOD_KEY}</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-nbr-bg/70 px-4 pt-[10vh] backdrop-blur-[3px] animate-fade-in"
          onClick={dismiss}
          role="presentation"
        >
          <div
            className="flex w-full max-w-[640px] flex-col overflow-hidden rounded-panel border border-line bg-white shadow-modal animate-scale-in"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Global search"
          >
            {/* Query bar */}
            <div className="flex shrink-0 items-center gap-3 border-b border-line px-4">
              <Icons.Search
                size={18}
                strokeWidth={ICON_STROKE}
                className="shrink-0 text-ink-4"
              />
              <input
                ref={inputRef}
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                onKeyDown={onInputKeyDown}
                placeholder="Search by name, mobile, email, ID or certificate number…"
                // No focus ring: the palette focuses this input the moment it
                // opens, so a ring would be permanently on, boxing the whole
                // header for no information. The open dialog is the focus cue.
                className="h-[52px] flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-4 focus-visible:ring-0"
                autoComplete="off"
                spellCheck={false}
                aria-autocomplete="list"
              />
              {isFetching ? (
                <Icons.Loader2 size={15} className="shrink-0 animate-spin text-ink-4" />
              ) : term ? (
                <button
                  type="button"
                  onClick={() => setTerm('')}
                  aria-label="Clear search"
                  className="grid h-6 w-6 shrink-0 place-items-center rounded text-ink-4 transition-colors hover:bg-canvas hover:text-ink-2"
                >
                  <Icons.X size={14} strokeWidth={2.4} />
                </button>
              ) : (
                <Kbd className="shrink-0">esc</Kbd>
              )}
            </div>

            {/* Results */}
            <div ref={listRef} className="scrollbar-slim min-h-0 flex-1 overflow-y-auto">
              {tooShort ? (
                <div className="px-4 py-6">
                  <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-4">
                    You can search by
                  </p>
                  <ul className="grid gap-1.5">
                    {SEARCH_TIPS.map((tip) => (
                      <li key={tip.label} className="flex items-center gap-3 text-xs">
                        <span className="w-28 shrink-0 font-medium text-ink-2">{tip.label}</span>
                        <span className="tabular truncate rounded bg-canvas px-2 py-0.5 font-mono text-[11px] text-ink-3">
                          {tip.example}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-4 flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-4">
                    <Icons.Shield size={12} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0" />
                    Aadhaar and PAN are matched on encrypted fingerprints — they are never searched
                    or stored in plain text.
                  </p>
                </div>
              ) : flatHits.length === 0 && !isFetching ? (
                <div className="px-4 py-12 text-center">
                  <span className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full bg-canvas text-ink-4">
                    <Icons.Search size={19} strokeWidth={ICON_STROKE} />
                  </span>
                  <p className="text-sm font-semibold text-ink">No matches for “{debounced}”</p>
                  <p className="mt-1 text-xs text-ink-3">
                    Check the spelling, or try a mobile number or record ID.
                  </p>
                </div>
              ) : (
                data?.groups.map((group) => (
                  <div key={group.label} className="border-b border-line/70 py-1.5 last:border-0">
                    <div className="flex items-center justify-between px-4 py-1">
                      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-4">
                        {group.label}
                      </p>
                      <span className="tabular text-[10px] font-semibold text-ink-4">
                        {group.hits.length}
                      </span>
                    </div>

                    {group.hits.map((hit) => {
                      const index = flatHits.indexOf(hit);
                      const isActive = index === activeIndex;
                      const Icon = KIND_ICON[hit.kind] ?? Icons.FileText;

                      return (
                        <button
                          key={`${hit.kind}-${hit.id}`}
                          type="button"
                          data-active={isActive}
                          onClick={() => go(hit)}
                          onMouseEnter={() => setActiveIndex(index)}
                          className={cn(
                            'relative flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
                            isActive ? 'bg-nbr-orange/10' : 'hover:bg-canvas',
                          )}
                        >
                          <span
                            aria-hidden
                            className={cn(
                              'absolute left-0 top-1/2 h-7 w-[3px] -translate-y-1/2 rounded-r-full transition-colors',
                              isActive ? 'bg-nbr-orange' : 'bg-transparent',
                            )}
                          />

                          <span
                            className={cn(
                              'grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors',
                              isActive
                                ? 'bg-nbr-orange text-white'
                                : 'bg-canvas text-ink-3',
                            )}
                          >
                            <Icon size={15} strokeWidth={ICON_STROKE} />
                          </span>

                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate text-[13px] font-semibold text-ink">
                                {hit.primary}
                              </span>
                              {hit.isBlacklisted ? (
                                <span
                                  title="Blacklisted"
                                  className="inline-flex shrink-0 items-center gap-0.5 rounded bg-danger-tint px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-danger"
                                >
                                  <Icons.Ban size={9} strokeWidth={2.6} />
                                  Blacklisted
                                </span>
                              ) : null}
                            </span>
                            <span className="block truncate text-[11px] text-ink-3">
                              {hit.secondary}
                            </span>
                          </span>

                          {hit.badge && hit.kind === 'record' ? (
                            <StatusBadge status={hit.badge} size="sm" />
                          ) : null}

                          <Icons.ArrowRight
                            size={14}
                            strokeWidth={2.4}
                            className={cn(
                              'shrink-0 transition-opacity',
                              isActive ? 'text-nbr-orange opacity-100' : 'opacity-0',
                            )}
                          />
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>

            {/* Legend */}
            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line bg-canvas px-4 py-2.5">
              <div className="flex items-center gap-3.5 text-[10px] text-ink-3">
                <span className="flex items-center gap-1">
                  <Kbd label="Up and down arrows">↑↓</Kbd> navigate
                </span>
                <span className="flex items-center gap-1">
                  <Kbd label="Enter">↵</Kbd> open
                </span>
                <span className="hidden items-center gap-1 sm:flex">
                  <Kbd>esc</Kbd> close
                </span>
              </div>

              {data && !tooShort ? (
                <span className="tabular shrink-0 text-[10px] text-ink-4">
                  {data.total} result{data.total === 1 ? '' : 's'} · {data.tookMs} ms
                </span>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
