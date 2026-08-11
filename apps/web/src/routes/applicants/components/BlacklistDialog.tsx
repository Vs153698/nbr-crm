import {
  BLACKLIST_KIND,
  BLACKLIST_REASON,
  BLACKLIST_REASON_LABELS,
  type BlacklistReason,
} from '@nbr/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Chip } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input, Select, Textarea } from '@/components/ui/Field';
import { useDebounce } from '@/hooks/useDebounce';
import { api, ApiError } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { ICON_SIZE, ICON_STROKE, Icons } from '@/lib/icons';
import { queryKeys } from '@/lib/query-client';

export interface BlacklistTarget {
  readonly id: string;
  readonly fullName: string;
  readonly applicantCode: string;
}

interface SearchHit {
  kind: string;
  id: string;
  applicantId: string;
  primary: string;
  secondary: string;
  isBlacklisted: boolean;
}

interface SearchResults {
  groups: Array<{ label: string; hits: SearchHit[] }>;
}

/** Minimum characters before the picker asks the server anything. */
const SEARCH_MIN_LENGTH = 2;

/** Today, as the date input wants it — nothing before this may be an end date. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * M-09 Blacklist an applicant (§19).
 *
 * The register at W-25 could list and lift, but there was no way to *create* an
 * entry from the interface at all — the endpoint existed and only an API client
 * could reach it. So the one screen named "Blacklist & restrictions" could not
 * blacklist anybody.
 *
 * Two things this asks for that a confirm dialog would not, and both are the
 * point of the feature rather than ceremony:
 *
 *  • **A written reason.** The entry is the evidence trail behind a decision
 *    that stops someone applying, and it has to answer "why" to a person
 *    reading it years later who was not in the room.
 *  • **Permanent or until a date.** A temporary block that nobody remembers to
 *    lift is a permanent one by accident, so the end date is required rather
 *    than optional whenever the kind is temporary — the server enforces this
 *    too, and disagreeing with it here would only move the error later.
 *
 * Blocking also travels: the applicant's account on the NBR website is
 * suspended, so they cannot log in there and file again. That is stated on the
 * dialog rather than left as a surprise.
 */
export function BlacklistDialog({
  open,
  onOpenChange,
  applicant,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fixed target. Omit to let the operator search for one. */
  applicant?: BlacklistTarget;
  onDone?: () => void;
}) {
  const queryClient = useQueryClient();

  const [picked, setPicked] = useState<BlacklistTarget | null>(applicant ?? null);
  const [term, setTerm] = useState('');
  const [kind, setKind] = useState<string>(BLACKLIST_KIND.PERMANENT);
  const [reason, setReason] = useState<string>(BLACKLIST_REASON.FRAUD);
  const [reasonDetail, setReasonDetail] = useState('');
  const [effectiveUntil, setEffectiveUntil] = useState('');
  const [remarks, setRemarks] = useState('');

  // Reset on each open, so a dialog closed half-filled does not reopen holding
  // the previous applicant's reason.
  useEffect(() => {
    if (!open) return;
    setPicked(applicant ?? null);
    setTerm('');
    setKind(BLACKLIST_KIND.PERMANENT);
    setReason(BLACKLIST_REASON.FRAUD);
    setReasonDetail('');
    setEffectiveUntil('');
    setRemarks('');
  }, [open, applicant]);

  const debounced = useDebounce(term, 200);
  const searching = !applicant && !picked && debounced.trim().length >= SEARCH_MIN_LENGTH;

  const { data: results, isFetching } = useQuery({
    queryKey: queryKeys.search(debounced),
    queryFn: ({ signal }) => api.get<SearchResults>('/search', { q: debounced }, signal),
    enabled: searching,
    staleTime: 20_000,
  });

  const hits = useMemo(() => {
    const groups = results?.groups ?? [];
    return groups
      .flatMap((group) => group.hits)
      .filter((hit) => hit.kind === 'applicant')
      .slice(0, 8);
  }, [results]);

  const temporary = kind === BLACKLIST_KIND.TEMPORARY;
  const ready =
    picked !== null &&
    reasonDetail.trim().length > 0 &&
    (!temporary || effectiveUntil.length > 0);

  const mutation = useMutation({
    mutationFn: () =>
      api.post('/blacklists', {
        applicantId: picked!.id,
        kind,
        reason,
        reasonDetail: reasonDetail.trim(),
        // Sent only for a temporary block: the server rejects an end date on a
        // permanent one, which is the right rule and not one to work around.
        ...(temporary ? { effectiveUntil: new Date(`${effectiveUntil}T23:59:59`).toISOString() } : {}),
        ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
        documentKeys: [],
      }),
    onSuccess: () => {
      toast.success('Applicant blacklisted', {
        description: `${picked?.fullName} cannot open a new record, and their website account has been suspended.`,
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.blacklist });
      if (picked) void queryClient.invalidateQueries({ queryKey: queryKeys.applicant(picked.id) });
      void queryClient.invalidateQueries({ queryKey: ['applicants', 'list'] });
      onOpenChange(false);
      onDone?.();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not blacklist this applicant'),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Blacklist applicant"
      description="Blocks new records here and suspends their account on the NBR website."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            icon={Icons.Ban}
            disabled={!ready}
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            Blacklist
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* ── Who ──────────────────────────────────────────────────────── */}
        {applicant ? null : picked ? (
          <div className="flex items-center justify-between gap-3 rounded-card border border-line bg-canvas px-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">{picked.fullName}</p>
              <p className="tabular text-[11px] text-ink-3">{picked.applicantCode}</p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setPicked(null)}>
              Change
            </Button>
          </div>
        ) : (
          <div>
            <Input
              label="Applicant"
              required
              hint="Search by name, mobile or applicant ID."
              autoFocus
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Rahul Verma, 98765 43210, NBRAP00001…"
            />

            {searching ? (
              <div className="mt-1.5 overflow-hidden rounded-card border border-line">
                {isFetching && hits.length === 0 ? (
                  <p className="px-3 py-2.5 text-xs text-ink-3">Searching…</p>
                ) : hits.length === 0 ? (
                  <p className="px-3 py-2.5 text-xs text-ink-3">No applicant matches that.</p>
                ) : (
                  hits.map((hit) => (
                    <button
                      key={hit.id}
                      type="button"
                      onClick={() =>
                        setPicked({
                          id: hit.applicantId,
                          fullName: hit.primary,
                          applicantCode: hit.secondary,
                        })
                      }
                      disabled={hit.isBlacklisted}
                      className={cn(
                        'flex w-full items-center justify-between gap-3 border-b border-line px-3 py-2 text-left last:border-b-0',
                        hit.isBlacklisted
                          ? 'cursor-not-allowed opacity-60'
                          : 'transition-colors hover:bg-canvas',
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-medium text-ink">
                          {hit.primary}
                        </span>
                        <span className="tabular block truncate text-[11px] text-ink-3">
                          {hit.secondary}
                        </span>
                      </span>
                      {/* Already blocked — offering them again would produce the
                          server's "already blacklisted" conflict on submit. */}
                      {hit.isBlacklisted ? <Chip tone="red">Blacklisted</Chip> : null}
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>
        )}

        {/* ── For how long ─────────────────────────────────────────────── */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Duration"
            required
            value={kind}
            onChange={(event) => setKind(event.target.value)}
            options={[
              { value: BLACKLIST_KIND.PERMANENT, label: 'Permanent' },
              { value: BLACKLIST_KIND.TEMPORARY, label: 'Temporary — until a date' },
            ]}
          />

          {temporary ? (
            <Input
              label="Blocked until"
              required
              hint="The block lifts itself after this date."
              type="date"
              min={todayIso()}
              value={effectiveUntil}
              onChange={(event) => setEffectiveUntil(event.target.value)}
            />
          ) : null}
        </div>

        {/* ── Why ──────────────────────────────────────────────────────── */}
        <Select
          label="Reason"
          required
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          options={Object.values(BLACKLIST_REASON).map((code) => ({
            value: code,
            label: BLACKLIST_REASON_LABELS[code as BlacklistReason],
          }))}
        />

        <Textarea
          label="What happened"
          required
          hint="Goes on the permanent register. Write it for someone reading this in three years."
          rows={3}
          value={reasonDetail}
          onChange={(event) => setReasonDetail(event.target.value)}
          placeholder="Submitted a forged district-level certificate for the 2026 entry; confirmed with the issuing office on 12 Feb."
        />

        <Textarea
          label="Internal remarks"
          hint="Optional. Not part of the public reason."
          rows={2}
          value={remarks}
          onChange={(event) => setRemarks(event.target.value)}
        />

        <p className="flex gap-2 rounded-card border border-warn-ring bg-warn-tint px-3 py-2.5 text-[11px] text-ink-2">
          <Icons.ShieldAlert
            size={ICON_SIZE.sm}
            strokeWidth={ICON_STROKE}
            className="mt-px shrink-0 text-warn"
          />
          <span>
            New records are blocked unless an Admin overrides, and the applicant's NBR website
            account is suspended — they cannot log in or file again there. Lifting the blacklist
            restores both.
          </span>
        </p>
      </div>
    </Dialog>
  );
}

/**
 * Lift a blacklist, with the reason recorded.
 *
 * A written reason rather than a bare confirm, and for the same argument as the
 * one required to create the entry: this reverses a decision someone made on
 * evidence, and the register is worth nothing if it records why people were
 * blocked but not why they were let back in.
 */
export function LiftBlacklistDialog({
  blacklistId,
  applicantId,
  applicantName,
  open,
  onOpenChange,
  onDone,
}: {
  blacklistId: string;
  applicantId: string;
  applicantName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => api.post(`/blacklists/${blacklistId}/lift`, { reason: reason.trim() }),
    onSuccess: () => {
      toast.success('Blacklist lifted', {
        description: 'The entry stays on record, and their website account is active again.',
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.blacklist });
      void queryClient.invalidateQueries({ queryKey: queryKeys.applicant(applicantId) });
      onOpenChange(false);
      onDone?.();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not lift the blacklist'),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Lift this blacklist?"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={reason.trim().length === 0}
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            Lift blacklist
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-ink-2">
          <strong className="text-ink">{applicantName}</strong> will be able to open new records
          again, and their NBR website account will be un-suspended. The entry stays on the
          register with its original reason — nothing is deleted.
        </p>

        <Textarea
          label="Why is this being lifted"
          required
          autoFocus
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Issuing office confirmed the certificate was genuine; the earlier check was against the wrong year."
        />
      </div>
    </Dialog>
  );
}
