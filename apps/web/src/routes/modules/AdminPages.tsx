import {
  BLACKLIST_KIND,
  BLACKLIST_REASON,
  BLACKLIST_REASON_LABELS,
  EMAIL_TEMPLATE_CODES,
  TEMPLATE_CHANNEL,
  TEMPLATE_VARIABLES,
  WHATSAPP_TEMPLATE_CODES,
  validateTemplate,
} from '@nbr/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/AppShell';
import { Chip } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, EmptyState, QueryError } from '@/components/ui/Card';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { Input, Select, Textarea } from '@/components/ui/Field';
import { useAuth } from '@/hooks/useAuth';
import { api, ApiError } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { formatDate, formatDateTime, formatRelative, humanise } from '@/lib/format';
import { ICON_SIZE, ICON_STROKE, Icons } from '@/lib/icons';
import { queryKeys } from '@/lib/query-client';

// ── W-25 Blacklist & restrictions ───────────────────────────────────────────

interface BlacklistRow {
  id: string;
  applicantId: string;
  applicantCode: string;
  applicantName: string;
  kind: string;
  reason: string;
  reasonDetail: string;
  remarks: string | null;
  effectiveFrom: string;
  effectiveUntil: string | null;
  liftedAt: string | null;
  liftReason: string | null;
  createdByName: string | null;
  isActive: boolean;
}

/**
 * W-25 Blacklist register (§19).
 *
 * Lifted entries stay listed. The register is the evidence trail for a decision
 * that blocks someone from applying — hiding the history would defeat it.
 */
export function BlacklistPage() {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const [activeOnly, setActiveOnly] = useState(true);
  const [liftTarget, setLiftTarget] = useState<BlacklistRow | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: [...queryKeys.blacklist, activeOnly],
    queryFn: ({ signal }) =>
      api.get<BlacklistRow[]>('/blacklists', { activeOnly: String(activeOnly) }, signal),
  });

  const liftMutation = useMutation({
    mutationFn: (id: string) =>
      api.post(`/blacklists/${id}/lift`, { reason: 'Lifted after review by an administrator' }),
    onSuccess: () => {
      toast.success('Blacklist lifted', { description: 'The entry stays on record.' });
      setLiftTarget(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.blacklist });
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not lift the blacklist'),
  });

  return (
    <div className="p-4 sm:p-5">
      <PageHeader
        title="Blacklist & restrictions"
        subtitle="Blacklisted applicants cannot open a new record without an audited Admin override."
        actions={
          <div className="flex gap-1.5">
            {[
              { value: true, label: 'Active' },
              { value: false, label: 'All (incl. lifted)' },
            ].map((option) => (
              <button
                key={String(option.value)}
                type="button"
                onClick={() => setActiveOnly(option.value)}
                aria-pressed={activeOnly === option.value}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                  activeOnly === option.value
                    ? 'border-brand bg-brand text-white'
                    : 'border-line bg-white text-ink-2 hover:bg-canvas',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        }
      />

      {isError ? (
        <Card>
          <QueryError title="Couldn't load the register" onRetry={() => void refetch()} />
        </Card>
      ) : isLoading ? (
        <div className="space-y-2">
          {[0, 1].map((index) => (
            <div key={index} className="skeleton h-24" />
          ))}
        </div>
      ) : (data?.length ?? 0) === 0 ? (
        <Card>
          <EmptyState
            icon={Icons.ShieldCheck}
            title="No blacklisted applicants"
            description="Nobody is currently blocked from applying."
          />
        </Card>
      ) : (
        <div className="space-y-2">
          {data?.map((entry) => (
            <Card
              key={entry.id}
              className={cn(entry.isActive ? 'border-danger-ring' : 'opacity-70')}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      to={`/applicants/${entry.applicantId}`}
                      className="text-sm font-semibold text-ink hover:text-brand hover:underline"
                    >
                      {entry.applicantName}
                    </Link>
                    <span className="tabular text-[10px] text-ink-3">{entry.applicantCode}</span>
                    <Chip tone={entry.kind === BLACKLIST_KIND.PERMANENT ? 'red' : 'orange'}>
                      {humanise(entry.kind)}
                    </Chip>
                    {!entry.isActive ? <Chip tone="slate">Lifted</Chip> : null}
                  </div>

                  <p className="mt-1 text-xs text-ink-2">
                    <span className="font-semibold">
                      {BLACKLIST_REASON_LABELS[entry.reason as keyof typeof BLACKLIST_REASON_LABELS] ??
                        humanise(entry.reason)}
                    </span>{' '}
                    — {entry.reasonDetail}
                  </p>

                  <p className="mt-1 text-[10px] text-ink-3">
                    From {formatDate(entry.effectiveFrom)}
                    {entry.effectiveUntil ? ` until ${formatDate(entry.effectiveUntil)}` : ' · permanent'}
                    {entry.createdByName ? ` · by ${entry.createdByName}` : ''}
                  </p>

                  {entry.liftedAt ? (
                    <p className="mt-1.5 rounded-md border-l-2 border-ok bg-ok-tint px-2.5 py-1.5 text-[11px] text-ok">
                      Lifted {formatDate(entry.liftedAt)} — {entry.liftReason}
                    </p>
                  ) : null}
                </div>

                {entry.isActive && can('blacklist:edit') ? (
                  <Button size="sm" variant="secondary" onClick={() => setLiftTarget(entry)}>
                    Lift
                  </Button>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={liftTarget !== null}
        onOpenChange={(open) => !open && setLiftTarget(null)}
        title="Lift this blacklist?"
        message={
          <>
            <strong>{liftTarget?.applicantName}</strong> will be able to open new records again. The
            entry stays on the register with its reason — nothing is deleted.
          </>
        }
        confirmLabel="Lift blacklist"
        variant="warning"
        loading={liftMutation.isPending}
        onConfirm={() => liftTarget && liftMutation.mutate(liftTarget.id)}
      />
    </div>
  );
}

// ── W-26 Template manager ───────────────────────────────────────────────────

interface TemplateRow {
  id: string;
  code: string;
  channel: string;
  name: string;
  subject: string | null;
  body: string;
  isActive: boolean;
  updatedAt: string;
}

/**
 * W-26 Template manager (§7, §8).
 *
 * Placeholders are validated as the Admin types, using the same function the
 * server enforces at save time — so a typo is caught here rather than becoming
 * a blank in an applicant's email.
 */
export function TemplatesPage() {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const [editing, setEditing] = useState<TemplateRow | null>(null);

  const { data: templates, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.templates,
    queryFn: ({ signal }) => api.get<TemplateRow[]>('/templates', undefined, signal),
  });

  const byChannel = (channel: string) => templates?.filter((t) => t.channel === channel) ?? [];

  return (
    <div className="p-4 sm:p-5">
      <PageHeader
        title="Message templates"
        subtitle="Seven email and six WhatsApp templates with dynamic fields."
      />

      {isError ? (
        <Card>
          <QueryError title="Couldn't load templates" onRetry={() => void refetch()} />
        </Card>
      ) : isLoading ? (
        <div className="skeleton h-64" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {[
            { channel: TEMPLATE_CHANNEL.EMAIL, label: 'Email', icon: Icons.Mail, codes: EMAIL_TEMPLATE_CODES },
            {
              channel: TEMPLATE_CHANNEL.WHATSAPP,
              label: 'WhatsApp',
              icon: Icons.MessageCircle,
              codes: WHATSAPP_TEMPLATE_CODES,
            },
          ].map((group) => (
            <Card key={group.channel}>
              <CardHeader
                title={`${group.label} templates`}
                subtitle={`${byChannel(group.channel).length} of ${group.codes.length}`}
                icon={group.icon}
              />
              <ul className="space-y-1.5">
                {byChannel(group.channel).map((template) => (
                  <li
                    key={template.id}
                    className="flex items-center gap-3 rounded-lg border border-line p-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-ink">{template.name}</p>
                      <p className="truncate text-[10px] text-ink-3">
                        {template.subject ?? template.body.slice(0, 60)}
                      </p>
                    </div>
                    {!template.isActive ? <Chip tone="slate">Inactive</Chip> : null}
                    {can('templates:edit') ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={Icons.PenLine}
                        onClick={() => setEditing(template)}
                      >
                        Edit
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}

      {editing ? (
        <TemplateEditor
          template={editing}
          onClose={() => setEditing(null)}
          onSaved={() => void queryClient.invalidateQueries({ queryKey: queryKeys.templates })}
        />
      ) : null}
    </div>
  );
}

function TemplateEditor({
  template,
  onClose,
  onSaved,
}: {
  template: TemplateRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [subject, setSubject] = useState(template.subject ?? '');
  const [body, setBody] = useState(template.body);
  const [isActive, setIsActive] = useState(template.isActive);

  // Same validator the API runs — the Admin sees the problem while typing.
  const bodyCheck = validateTemplate(body);
  const subjectCheck = subject ? validateTemplate(subject) : { valid: true, unknown: [] };
  const unknown = [...new Set([...bodyCheck.unknown, ...subjectCheck.unknown])];

  const saveMutation = useMutation({
    mutationFn: () =>
      api.put('/templates', {
        code: template.code,
        channel: template.channel,
        name: template.name,
        subject: subject || undefined,
        body,
        isActive,
      }),
    onSuccess: () => {
      toast.success('Template saved');
      onClose();
      onSaved();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not save the template'),
  });

  function insert(variable: string) {
    setBody((current) => `${current}{{${variable}}}`);
  }

  return (
    <Dialog
      open
      onOpenChange={onClose}
      title={`Edit — ${template.name}`}
      description={`${humanise(template.channel)} template`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={saveMutation.isPending}
            disabled={unknown.length > 0 || !body.trim()}
            onClick={() => saveMutation.mutate()}
          >
            Save template
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {unknown.length > 0 ? (
          <div className="flex gap-2 rounded-lg border border-danger-ring bg-danger-tint p-2.5">
            <Icons.XCircle size={14} strokeWidth={2} className="mt-0.5 shrink-0 text-danger" />
            <p className="text-[11px] leading-relaxed text-danger">
              Unknown placeholder{unknown.length === 1 ? '' : 's'}:{' '}
              <b>{unknown.map((name) => `{{${name}}}`).join(', ')}</b>. These would render as blank
              text, so the template cannot be saved until they're corrected.
            </p>
          </div>
        ) : null}

        {template.channel === TEMPLATE_CHANNEL.EMAIL ? (
          <Input label="Subject" value={subject} onChange={(event) => setSubject(event.target.value)} />
        ) : null}

        <Textarea
          label="Message"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={12}
        />

        <div>
          <p className="mb-1.5 text-xs font-semibold text-ink-2">Insert a field</p>
          <div className="scrollbar-slim flex max-h-28 flex-wrap gap-1 overflow-y-auto">
            {Object.entries(TEMPLATE_VARIABLES).map(([name, description]) => (
              <button
                key={name}
                type="button"
                title={description}
                onClick={() => insert(name)}
                className="rounded border border-line bg-canvas px-1.5 py-0.5 font-mono text-[10px] text-ink-2 transition-colors hover:border-brand hover:text-brand"
              >
                {name}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2 text-xs text-ink-2">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
            className="h-4 w-4 rounded border-line text-brand"
          />
          Active — available in the send dialogs
        </label>
      </div>
    </Dialog>
  );
}

// ── W-30 Audit log ──────────────────────────────────────────────────────────

interface AuditRow {
  id: string;
  action: string;
  actorName: string | null;
  actorRole: string | null;
  entityType: string | null;
  entityLabel: string | null;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  ipAddress: string | null;
  requestId: string | null;
  createdAt: string;
}

/** W-30 Audit log (§23). Read-only — the table itself rejects any change. */
export function AuditLogPage() {
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');

  const { data: actions } = useQuery({
    queryKey: ['audit-actions'],
    queryFn: ({ signal }) => api.get<string[]>('/audit-logs/actions', undefined, signal),
    staleTime: 5 * 60_000,
  });

  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['audit-logs', search, action],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api.get<{ items: AuditRow[]; nextCursor: string | null }>(
        '/audit-logs',
        { q: search || undefined, action: action || undefined, cursor: pageParam, limit: 50 },
        signal,
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const entries = data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="p-4 sm:p-5">
      <PageHeader
        title="Audit logs"
        subtitle="Every login, status change, upload and payment update — permanent and unmodifiable."
      />

      <Card padded={false}>
        <div className="flex flex-wrap gap-3 border-b border-line p-3">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by user, action or record…"
            prefix={<Icons.Search size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />}
            containerClassName="min-w-[220px] flex-1"
          />
          <Select
            value={action}
            onChange={(event) => setAction(event.target.value)}
            placeholder="All actions"
            options={(actions ?? []).map((value) => ({ value, label: humanise(value) }))}
            containerClassName="w-56"
          />
        </div>

        {isError ? (
          <QueryError title="Couldn't load the audit trail" onRetry={() => void refetch()} />
        ) : isLoading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3, 4].map((index) => (
              <div key={index} className="skeleton h-10" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <EmptyState icon={Icons.FileText} title="No matching entries" />
        ) : (
          <ul className="divide-y divide-line">
            {entries.map((entry) => (
              <li key={entry.id} className="flex gap-3 px-4 py-2.5 hover:bg-canvas">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden />

                <div className="min-w-0 flex-1">
                  <p className="text-xs text-ink">
                    <span className="font-semibold">{entry.actorName ?? 'System'}</span>{' '}
                    <span className="font-mono text-[11px] text-ink-2">{entry.action}</span>
                    {entry.entityLabel ? (
                      <span className="text-ink-2"> · {entry.entityLabel}</span>
                    ) : null}
                  </p>

                  <p className="text-[10px] text-ink-3">
                    {formatDateTime(entry.createdAt)} · {formatRelative(entry.createdAt)}
                    {entry.actorRole ? ` · ${humanise(entry.actorRole)}` : ''}
                    {entry.ipAddress ? ` · ${entry.ipAddress}` : ''}
                  </p>

                  {/* Before → after, for the "who changed this" question. */}
                  {entry.changes && Object.keys(entry.changes).length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {Object.entries(entry.changes)
                        .slice(0, 4)
                        .map(([field, change]) => (
                          <span
                            key={field}
                            className="rounded bg-slate2-tint px-1.5 py-0.5 font-mono text-[9px] text-ink-2"
                          >
                            {field}: {String(change.from ?? '—')} → {String(change.to ?? '—')}
                          </span>
                        ))}
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}

        {hasNextPage ? (
          <div className="border-t border-line p-3 text-center">
            <Button
              variant="ghost"
              size="sm"
              loading={isFetchingNextPage}
              onClick={() => void fetchNextPage()}
            >
              Load older entries
            </Button>
          </div>
        ) : (
          <p className="flex items-center justify-center gap-1 border-t border-line py-2.5 text-[10px] text-ink-4">
            <Icons.Lock size={10} strokeWidth={ICON_STROKE} />
            Audit entries cannot be edited or deleted
          </p>
        )}
      </Card>
    </div>
  );
}

// ── W-29 Settings ───────────────────────────────────────────────────────────

interface SettingGroup {
  category: string;
  settings: Array<{
    key: string;
    value: unknown;
    label: string | null;
    description: string | null;
    isEditable: boolean;
    updatedAt: string;
  }>;
}

/** W-29 Settings (§26). */
export function SettingsPage() {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.settings,
    queryFn: ({ signal }) => api.get<SettingGroup[]>('/settings', undefined, signal),
  });

  const saveMutation = useMutation({
    mutationFn: (params: { key: string; value: unknown }) =>
      api.put(`/settings/${params.key}`, { value: params.value }),
    onSuccess: (_result, params) => {
      toast.success('Setting saved');
      setDrafts((current) => {
        const next = { ...current };
        delete next[params.key];
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings });
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not save the setting'),
  });

  if (isError) {
    return (
      <div className="p-5">
        <Card>
          <QueryError title="Couldn't load settings" onRetry={() => void refetch()} />
        </Card>
      </div>
    );
  }

  if (isLoading) return <div className="p-5"><div className="skeleton h-64" /></div>;

  return (
    <div className="p-4 sm:p-5">
      <PageHeader
        title="Settings"
        subtitle="Operational thresholds and organisation details. Statutory limits are read-only."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {data?.map((group) => (
          <Card key={group.category}>
            <CardHeader
              title={humanise(group.category)}
              icon={
                group.category === 'privacy'
                  ? Icons.Shield
                  : group.category === 'security'
                    ? Icons.Lock
                    : group.category === 'payments'
                      ? Icons.IndianRupee
                      : Icons.Settings
              }
            />
            <div className="space-y-3">
              {group.settings.map((setting) => {
                const current = JSON.stringify(setting.value).replace(/^"|"$/g, '');
                const draft = drafts[setting.key];
                const dirty = draft !== undefined && draft !== current;

                return (
                  <div key={setting.key}>
                    <Input
                      label={setting.label ?? setting.key}
                      hint={setting.description ?? undefined}
                      value={draft ?? current}
                      disabled={!setting.isEditable || !can('settings:manage')}
                      onChange={(event) =>
                        setDrafts((prev) => ({ ...prev, [setting.key]: event.target.value }))
                      }
                      suffix={
                        !setting.isEditable ? (
                          <span title="Controlled by the deployment configuration">
                            <Icons.Lock size={13} strokeWidth={ICON_STROKE} />
                          </span>
                        ) : undefined
                      }
                    />
                    {dirty ? (
                      <div className="mt-1.5 flex gap-2">
                        <Button
                          size="sm"
                          variant="primary"
                          loading={saveMutation.isPending}
                          onClick={() => {
                            // Numbers stay numbers, arrays stay arrays — a
                            // threshold saved as a string would silently stop
                            // being compared numerically.
                            const raw = draft;
                            let parsed: unknown = raw;
                            if (/^-?\d+(\.\d+)?$/.test(raw)) parsed = Number(raw);
                            else if (raw.startsWith('[') || raw.startsWith('{')) {
                              try {
                                parsed = JSON.parse(raw);
                              } catch {
                                parsed = raw;
                              }
                            }
                            saveMutation.mutate({ key: setting.key, value: parsed });
                          }}
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setDrafts((prev) => {
                              const next = { ...prev };
                              delete next[setting.key];
                              return next;
                            })
                          }
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
