import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CALL_OUTCOME_LABELS,
  LEAD_SOURCE,
  LEAD_SOURCE_LABELS,
  LEAD_STATUS_META,
  ORDERED_LEAD_STATUSES,
  type CallOutcome,
  type LeadStatus,
} from '@nbr/shared';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, QueryError } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Badge';
import { Dialog } from '@/components/ui/Dialog';
import { Input, Select, Textarea } from '@/components/ui/Field';
import { PageHeader } from '@/components/layout/AppShell';

import { useAuth } from '@/hooks/useAuth';
import { ApiError, api } from '@/lib/api-client';
import { formatRelative } from '@/lib/format';
import { Icons } from '@/lib/icons';
import type { Lookups } from '../applicants/types';

interface LeadRow {
  id: string;
  leadCode: string;
  fullName: string;
  mobile: string;
  email: string | null;
  city: string | null;
  status: string;
  source: string;
  category: string | null;
  ownerName: string | null;
  nextFollowUpAt: string | null;
  lastContactedAt: string | null;
  callCount: number;
  convertedApplicantId: string | null;
  updatedAt: string;
}

const QUEUES = [
  { key: '', label: 'All leads' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'due_today', label: 'Due today' },
  { key: 'upcoming', label: 'Upcoming' },
] as const;

/**
 * The calling list.
 *
 * Built around the follow-up queues rather than a flat table: a rep's first
 * question each morning is "who did I promise to call back?", and overdue
 * sorts oldest-first because the most overdue is the most urgent.
 */
export default function LeadsPage() {
  const queryClient = useQueryClient();
  const { can } = useAuth();

  const [queue, setQueue] = useState<string>('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [callTarget, setCallTarget] = useState<LeadRow | null>(null);
  const [convertTarget, setConvertTarget] = useState<LeadRow | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['leads', queue, status, search],
    queryFn: ({ signal }) =>
      api.get<{ items: LeadRow[] }>(
        '/leads',
        {
          followUp: queue || undefined,
          status: status || undefined,
          q: search || undefined,
        },
        signal,
      ),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['leads'] });
    void queryClient.invalidateQueries({ queryKey: ['sales-dashboard'] });
  };

  return (
    <div className="p-4 sm:p-5">
      <PageHeader
        title="Leads"
        subtitle="People to call about certifying their record."
        actions={
          can('leads:create') ? (
            <Button variant="primary" icon={Icons.Plus} onClick={() => setAddOpen(true)}>
              Add lead
            </Button>
          ) : undefined
        }
      />

      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex gap-1">
            {QUEUES.map((entry) => (
              <button
                key={entry.key}
                type="button"
                onClick={() => setQueue(entry.key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  queue === entry.key
                    ? 'bg-brand text-white'
                    : 'bg-canvas text-ink-2 hover:text-ink'
                }`}
              >
                {entry.label}
              </button>
            ))}
          </div>

          <Select
            label="Stage"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            placeholder="Any stage"
            options={ORDERED_LEAD_STATUSES.map((meta) => ({
              value: meta.code,
              label: meta.label,
            }))}
            containerClassName="w-44"
          />

          <Input
            label="Search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name, code or number"
            containerClassName="w-56"
          />
        </div>
      </Card>

      {isError ? (
        <Card>
          <QueryError title="Couldn't load leads" onRetry={() => void refetch()} />
        </Card>
      ) : isLoading ? (
        <div className="skeleton h-64" />
      ) : (data?.items.length ?? 0) === 0 ? (
        <Card>
          <p className="py-10 text-center text-sm text-ink-3">
            {queue ? 'Nothing in this queue.' : 'No leads yet. Add one to start calling.'}
          </p>
        </Card>
      ) : (
        <Card>
          <div className="scrollbar-slim overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-[10px] uppercase tracking-wider text-ink-3">
                  <th className="py-2 pr-3 text-left font-semibold">Lead</th>
                  <th className="py-2 px-2 text-left font-semibold">Stage</th>
                  <th className="py-2 px-2 text-left font-semibold">Owner</th>
                  <th className="py-2 px-2 text-left font-semibold">Follow-up</th>
                  <th className="py-2 px-2 text-right font-semibold">Calls</th>
                  <th className="py-2 pl-2 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {data!.items.map((lead) => {
                  const meta = LEAD_STATUS_META[lead.status as LeadStatus];
                  const overdue =
                    lead.nextFollowUpAt !== null && new Date(lead.nextFollowUpAt) < new Date();

                  return (
                    <tr key={lead.id}>
                      <td className="py-2.5 pr-3">
                        <p className="font-medium text-ink">{lead.fullName}</p>
                        <p className="tabular text-[11px] text-ink-3">
                          {lead.leadCode} · {lead.mobile}
                          {lead.city ? ` · ${lead.city}` : ''}
                        </p>
                      </td>
                      <td className="py-2.5 px-2">
                        <Chip tone={meta?.tone ?? 'slate'}>{meta?.label ?? lead.status}</Chip>
                      </td>
                      <td className="py-2.5 px-2 text-xs text-ink-2">{lead.ownerName ?? '—'}</td>
                      <td className="py-2.5 px-2 text-xs">
                        {lead.nextFollowUpAt ? (
                          <span className={overdue ? 'font-semibold text-danger' : 'text-ink-2'}>
                            {formatRelative(lead.nextFollowUpAt)}
                          </span>
                        ) : (
                          <span className="text-ink-3">—</span>
                        )}
                      </td>
                      <td className="tabular py-2.5 px-2 text-right text-xs">{lead.callCount}</td>
                      <td className="py-2.5 pl-2">
                        <div className="flex justify-end gap-1.5">
                          {can('leads:edit') && !lead.convertedApplicantId ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              icon={Icons.Phone}
                              onClick={() => setCallTarget(lead)}
                            >
                              Log call
                            </Button>
                          ) : null}
                          {can('leads:change_status') && !lead.convertedApplicantId ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              icon={Icons.UserPlus}
                              onClick={() => setConvertTarget(lead)}
                            >
                              Convert
                            </Button>
                          ) : null}
                          {lead.convertedApplicantId ? (
                            <a
                              href={`/applicants/${lead.convertedApplicantId}`}
                              className="text-xs font-semibold text-brand hover:underline"
                            >
                              Open profile
                            </a>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {addOpen ? <AddLeadDialog onClose={() => setAddOpen(false)} onSaved={invalidate} /> : null}
      {callTarget ? (
        <LogCallDialog lead={callTarget} onClose={() => setCallTarget(null)} onSaved={invalidate} />
      ) : null}
      {convertTarget ? (
        <ConvertLeadDialog
          lead={convertTarget}
          onClose={() => setConvertTarget(null)}
          onSaved={invalidate}
        />
      ) : null}
    </div>
  );
}

function AddLeadDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    fullName: '',
    mobile: '',
    email: '',
    city: '',
    source: LEAD_SOURCE.COLD_CALL as string,
    achievementSummary: '',
  });

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const save = useMutation({
    mutationFn: () =>
      api.post<{ leadCode: string }>('/leads', {
        fullName: form.fullName,
        mobile: form.mobile,
        email: form.email || undefined,
        city: form.city || undefined,
        source: form.source,
        achievementSummary: form.achievementSummary || undefined,
      }),
    onSuccess: (result) => {
      toast.success(`Lead ${result.leadCode} added`);
      onClose();
      onSaved();
    },
    onError: (error: unknown) => {
      // The duplicate guard names the existing lead, which is the useful part.
      toast.error(error instanceof ApiError ? error.message : 'Could not add the lead');
    },
  });

  return (
    <Dialog
      open
      onOpenChange={onClose}
      title="Add lead"
      description="Someone to call about certifying their record."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!form.fullName.trim() || form.mobile.trim().length < 10}
            onClick={() => save.mutate()}
          >
            Add lead
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Name"
            required
            value={form.fullName}
            onChange={(event) => set('fullName')(event.target.value)}
          />
          <Input
            label="Mobile"
            required
            value={form.mobile}
            onChange={(event) => set('mobile')(event.target.value)}
            placeholder="9876543210"
          />
          <Input
            label="Email"
            type="email"
            value={form.email}
            onChange={(event) => set('email')(event.target.value)}
            hint="Needed later to convert them into an applicant."
          />
          <Input
            label="City"
            value={form.city}
            onChange={(event) => set('city')(event.target.value)}
          />
        </div>

        <Select
          label="Source"
          value={form.source}
          onChange={(event) => set('source')(event.target.value)}
          options={Object.values(LEAD_SOURCE).map((value) => ({
            value,
            label: LEAD_SOURCE_LABELS[value],
          }))}
        />

        <Textarea
          label="What might they be recognised for?"
          value={form.achievementSummary}
          onChange={(event) => set('achievementSummary')(event.target.value)}
          rows={3}
          placeholder="The reason for the call."
        />
      </div>
    </Dialog>
  );
}

function LogCallDialog({
  lead,
  onClose,
  onSaved,
}: {
  lead: LeadRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [outcome, setOutcome] = useState<string>('connected');
  const [summary, setSummary] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('');
  const [followUpAt, setFollowUpAt] = useState('');

  // Mirrors the server rule, so the requirement is visible before submitting.
  const needsFollowUp = outcome === 'callback_requested';

  const save = useMutation({
    mutationFn: () =>
      api.post<{ status: string }>(`/leads/${lead.id}/calls`, {
        outcome,
        summary,
        durationMinutes: durationMinutes ? Number(durationMinutes) : undefined,
        followUpAt: followUpAt || undefined,
      }),
    onSuccess: (result) => {
      toast.success('Call logged', {
        description: `${lead.fullName} is now ${
          LEAD_STATUS_META[result.status as LeadStatus]?.label ?? result.status
        }.`,
      });
      onClose();
      onSaved();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not log the call'),
  });

  return (
    <Dialog
      open
      onOpenChange={onClose}
      title={`Log call — ${lead.fullName}`}
      description={`${lead.leadCode} · ${lead.mobile}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!summary.trim() || (needsFollowUp && !followUpAt)}
            onClick={() => save.mutate()}
          >
            Save call
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Select
          label="Outcome"
          value={outcome}
          onChange={(event) => setOutcome(event.target.value)}
          options={Object.entries(CALL_OUTCOME_LABELS).map(([value, label]) => ({
            value,
            label,
          }))}
          hint="Sets the lead's stage. An unanswered call leaves it where it is."
        />

        <Textarea
          label="Summary"
          required
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          rows={4}
          autoFocus
          placeholder="What was said, and what happens next."
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Duration (minutes)"
            type="number"
            min={0}
            value={durationMinutes}
            onChange={(event) => setDurationMinutes(event.target.value)}
          />
          <Input
            type="date"
            label={needsFollowUp ? 'Call back on *' : 'Call back on'}
            value={followUpAt}
            onChange={(event) => setFollowUpAt(event.target.value)}
            error={
              needsFollowUp && !followUpAt
                ? 'Required — this is the commitment being made.'
                : undefined
            }
          />
        </div>
      </div>
    </Dialog>
  );
}

function ConvertLeadDialog({
  lead,
  onClose,
  onSaved,
}: {
  lead: LeadRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [recordTitle, setRecordTitle] = useState('');
  const [categoryId, setCategoryId] = useState('');

  const { data: lookups } = useQuery({
    queryKey: ['lookups'],
    queryFn: ({ signal }) => api.get<Lookups>('/lookups', undefined, signal),
    staleTime: 10 * 60_000,
  });

  const convert = useMutation({
    mutationFn: () =>
      api.post<{ applicantCode: string; recordCode: string }>(`/leads/${lead.id}/convert`, {
        categoryId,
        recordTitle,
        override: false,
      }),
    onSuccess: (result) => {
      toast.success(`Converted to ${result.applicantCode}`, {
        description: `Record ${result.recordCode} opened.`,
      });
      onClose();
      onSaved();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not convert the lead'),
  });

  return (
    <Dialog
      open
      onOpenChange={onClose}
      title={`Convert — ${lead.fullName}`}
      description="Opens an applicant profile and their first record."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={convert.isPending}
            disabled={!recordTitle.trim() || !categoryId}
            onClick={() => convert.mutate()}
          >
            Convert to applicant
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {!lead.email ? (
          <div className="rounded-lg border border-warn-ring bg-warn-tint p-2.5 text-[11px] leading-relaxed text-warn">
            This lead has no email address. One is needed to open an applicant profile — add it to
            the lead first.
          </div>
        ) : null}

        <Input
          label="Record title"
          required
          value={recordTitle}
          onChange={(event) => setRecordTitle(event.target.value)}
          placeholder="What is being claimed"
        />

        <Select
          label="Category"
          required
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
          placeholder="Select a category"
          options={(lookups?.categories ?? []).map((category) => ({
            value: category.id,
            label: category.name,
          }))}
        />

        <p className="text-[11px] leading-relaxed text-ink-3">
          The lead is kept and marked converted — its call history is what shows how the applicant
          was won.
        </p>
      </div>
    </Dialog>
  );
}
