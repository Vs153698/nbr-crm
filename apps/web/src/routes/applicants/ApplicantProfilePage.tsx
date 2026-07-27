import * as Tabs from '@radix-ui/react-tabs';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/AppShell';
import { Chip, FlagChip, StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, DetailRow, EmptyState } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Field';
import { useAuth } from '@/hooks/useAuth';
import { api, ApiError } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { formatDate, formatDateTime, formatRelative, humanise, initials } from '@/lib/format';
import { ICON_SIZE, ICON_STROKE, Icons } from '@/lib/icons';
import { queryKeys } from '@/lib/query-client';
import { AddRecordDialog } from './components/AddRecordDialog';
import { EditApplicantDialog } from './components/EditApplicantDialog';
import { CommunicationTab } from './components/CommunicationTab';
import { EvidenceTab } from './components/EvidenceTab';
import { CertificateTab, DispatchTab, PublicationsTab } from './components/FulfilmentTabs';
import { PaymentTab } from './components/PaymentTab';
import { TasksTab } from './components/TasksTab';
import { NotesTab } from './components/NotesTab';
import { SmartActionPanel } from './components/SmartActionPanel';
import { TimelineFeed } from './components/TimelineFeed';
import type { ApplicantProfile, AttachmentItem, SmartActionPanel as PanelData } from './types';

const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'application', label: 'Application' },
  { value: 'achievement', label: 'Achievement' },
  { value: 'evidence', label: 'Evidence' },
  { value: 'payment', label: 'Payment' },
  { value: 'certificate', label: 'Certificate' },
  { value: 'publications', label: 'Publications' },
  { value: 'dispatch', label: 'Dispatch' },
  { value: 'timeline', label: 'Timeline' },
  { value: 'notes', label: 'Notes' },
  { value: 'tasks', label: 'Tasks' },
  { value: 'communication', label: 'Communication' },
  { value: 'attachments', label: 'Attachments' },
] as const;

/**
 * W-06 / H-06 Applicant profile — the primary working screen (§4, §5).
 *
 * The whole page is one API call (`/applicants/:id/full`) plus a lazy per-tab
 * fetch. Opening an applicant should be a single round trip, not fourteen.
 */
export default function ApplicantProfilePage() {
  const { id = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { can } = useAuth();

  const activeTab = searchParams.get('tab') ?? 'overview';
  const [revealOpen, setRevealOpen] = useState(false);
  const [revealReason, setRevealReason] = useState('');
  const [revealedAadhaar, setRevealedAadhaar] = useState<string | null>(null);
  const [addRecordOpen, setAddRecordOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [activeRecordId, setActiveRecordId] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.applicant(id),
    queryFn: ({ signal }) => api.get<ApplicantProfile>(`/applicants/${id}/full`, undefined, signal),
    enabled: Boolean(id),
  });

  // The newest record drives the header, status cards and action panel — but a
  // returning applicant has several, so the Records list can switch between them.
  const activeRecord = useMemo(
    () => data?.records.find((record) => record.id === activeRecordId) ?? data?.records[0],
    [data, activeRecordId],
  );

  const { data: panel, isLoading: panelLoading } = useQuery({
    queryKey: queryKeys.recordActions(activeRecord?.id ?? ''),
    queryFn: ({ signal }) =>
      api.get<PanelData>(`/records/${activeRecord?.id}/actions`, undefined, signal),
    enabled: Boolean(activeRecord?.id),
  });

  const revealMutation = useMutation({
    mutationFn: () =>
      api.post<{ field: string; value: string }>(`/applicants/${id}/reveal-identifier`, {
        applicantId: id,
        field: 'aadhaarNumber',
        reason: revealReason,
      }),
    onSuccess: ({ value }) => {
      setRevealedAadhaar(value);
      setRevealOpen(false);
      setRevealReason('');
      toast.info('Aadhaar revealed', { description: 'This access has been logged.' });
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not reveal the identifier'),
  });

  function setTab(tab: string) {
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    setSearchParams(next, { replace: true });
  }

  if (isError) {
    return (
      <div className="p-5">
        <EmptyState
          icon={Icons.Search}
          title="Applicant not found"
          description="This profile may have been removed, or the link is wrong."
        />
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-4 p-4 sm:p-5">
        <div className="skeleton h-8 w-56" />
        <div className="skeleton h-32" />
        <div className="skeleton h-64" />
      </div>
    );
  }

  const { applicant, records, flags, blacklists } = data;
  const activeBlacklist = blacklists[0];

  return (
    <div className="p-4 sm:p-5">
      <PageHeader
        title={applicant.fullName}
        subtitle={
          <span className="tabular">
            {applicant.applicantCode} · Added {formatDate(applicant.createdAt)} · {applicant.recordCount}{' '}
            record{applicant.recordCount === 1 ? '' : 's'}
          </span>
        }
        back={{ to: '/applicants', label: 'Applicants' }}
        actions={
          <>
            {can('applicants:edit') ? (
              <Button variant="secondary" icon={Icons.PenLine} onClick={() => setEditOpen(true)}>
                Edit
              </Button>
            ) : null}
            {can('applicants:export') ? (
              <Button variant="secondary" icon={Icons.Printer}>
                Export PDF
              </Button>
            ) : null}
            {can('records:create') ? (
              <Button variant="primary" icon={Icons.FilePlus2} onClick={() => setAddRecordOpen(true)}>
                New record
              </Button>
            ) : null}
          </>
        }
      />

      {/* §19 blacklist banner — full width, above everything */}
      {applicant.isBlacklisted && activeBlacklist ? (
        <div className="mb-4 rounded-card border border-danger-ring bg-danger-tint p-4">
          <div className="flex gap-3">
            <Icons.Ban size={20} strokeWidth={2} className="mt-0.5 shrink-0 text-danger" />
            <div className="min-w-0">
              <p className="text-sm font-bold text-danger">
                Blacklisted — {humanise(activeBlacklist.kind)}
              </p>
              <p className="mt-0.5 text-xs text-ink-2">
                <span className="font-semibold">{humanise(activeBlacklist.reason)}</span> ·{' '}
                {activeBlacklist.reasonDetail}
              </p>
              <p className="mt-1 text-[11px] text-ink-3">
                Effective {formatDate(activeBlacklist.effectiveFrom)}
                {activeBlacklist.effectiveUntil
                  ? ` until ${formatDate(activeBlacklist.effectiveUntil)}`
                  : ' · permanent'}
                . New applications are blocked unless an Admin overrides.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-3">
        {/* ── Left: identity, status cards, tabs ─────────────────────────── */}
        <div className="space-y-4 xl:col-span-2">
          <Card>
            <div className="flex flex-wrap gap-4">
              <span className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-navy text-lg font-bold text-white">
                {initials(applicant.fullName)}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold tracking-tight text-ink">{applicant.fullName}</h2>
                  {activeRecord ? <StatusBadge status={activeRecord.status} /> : null}
                </div>

                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
                  <span className="flex items-center gap-1">
                    <Icons.Phone size={12} strokeWidth={ICON_STROKE} className="text-ink-3" />
                    {applicant.mobile}
                  </span>
                  <span className="flex items-center gap-1">
                    <Icons.Mail size={12} strokeWidth={ICON_STROKE} className="text-ink-3" />
                    {applicant.email}
                  </span>
                  {applicant.city ? (
                    <span className="flex items-center gap-1">
                      <Icons.Globe size={12} strokeWidth={ICON_STROKE} className="text-ink-3" />
                      {[applicant.city, applicant.state, applicant.country].filter(Boolean).join(', ')}
                    </span>
                  ) : null}
                  {applicant.dateOfBirth ? (
                    <span className="flex items-center gap-1">
                      <Icons.CalendarClock size={12} strokeWidth={ICON_STROKE} className="text-ink-3" />
                      {formatDate(applicant.dateOfBirth)}
                    </span>
                  ) : null}
                </div>

                {flags.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {flags.map((flag) => (
                      <FlagChip key={flag.id} flag={flag.flag} />
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </Card>

          {/* Six status cards (§4) */}
          {activeRecord ? (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
              <StatusCard label="Application" value={activeRecord.status} tone="info" />
              <StatusCard label="Payment" value={activeRecord.paymentStatus} tone="warn" />
              <StatusCard
                label="Certificate"
                value={activeRecord.hasCertificate ? 'Issued' : 'Not issued'}
                tone={activeRecord.hasCertificate ? 'ok' : 'slate'}
              />
              <StatusCard
                label="Publication"
                value={activeRecord.hasPublication ? 'Published' : '—'}
                tone={activeRecord.hasPublication ? 'purple' : 'slate'}
              />
              <StatusCard label="Dispatch" value={activeRecord.deliveryStatus} tone="info" />
              <StatusCard
                label="Blacklist"
                value={applicant.isBlacklisted ? 'Blacklisted' : 'Clear'}
                tone={applicant.isBlacklisted ? 'danger' : 'ok'}
              />
            </div>
          ) : null}

          {/* 13-tab layout — panels are lazily mounted, so only the visible
              tab's data is fetched. */}
          <Card padded={false}>
            <Tabs.Root value={activeTab} onValueChange={setTab}>
              <Tabs.List className="scrollbar-slim flex gap-0.5 overflow-x-auto border-b border-line px-2">
                {TABS.map((tab) => (
                  <Tabs.Trigger
                    key={tab.value}
                    value={tab.value}
                    className={cn(
                      'shrink-0 whitespace-nowrap border-b-2 border-transparent px-3 py-2.5 text-xs font-medium transition-colors',
                      'text-ink-2 hover:text-ink',
                      'data-[state=active]:border-brand data-[state=active]:text-brand',
                    )}
                  >
                    {tab.label}
                    {tab.value === 'evidence' && activeRecord?.evidenceCount ? (
                      <span className="tabular ml-1 rounded bg-slate2-tint px-1 text-[9px] font-semibold text-ink-2">
                        {activeRecord.evidenceCount}
                      </span>
                    ) : null}
                  </Tabs.Trigger>
                ))}
              </Tabs.List>

              <div className="p-4">
                <Tabs.Content value="overview">
                  <OverviewTab data={data} activeRecordId={activeRecord?.id} />
                </Tabs.Content>

                <Tabs.Content value="application">
                  {activeRecord ? (
                    <dl className="grid gap-x-8 sm:grid-cols-2">
                      <DetailRow label="Record ID" value={<span className="tabular">{activeRecord.recordCode}</span>} />
                      <DetailRow label="Application date" value={formatDate(activeRecord.applicationDate)} />
                      <DetailRow label="Source" value={humanise(activeRecord.source)} />
                      <DetailRow label="Status" value={<StatusBadge status={activeRecord.status} size="sm" />} />
                      <DetailRow label="Payment status" value={humanise(activeRecord.paymentStatus)} />
                      <DetailRow label="Dispatch status" value={humanise(activeRecord.deliveryStatus)} />
                      <DetailRow label="Last updated" value={formatDateTime(activeRecord.updatedAt)} />
                      <DetailRow
                        label="Workflow"
                        value={activeRecord.lockedAt ? `Locked ${formatDate(activeRecord.lockedAt)}` : 'Open'}
                      />
                    </dl>
                  ) : (
                    <EmptyState icon={Icons.FileText} title="No record on this profile" />
                  )}
                </Tabs.Content>

                <Tabs.Content value="achievement">
                  {activeRecord ? (
                    <dl className="grid gap-x-8 sm:grid-cols-2">
                      <DetailRow label="Record title" value={activeRecord.recordTitle} />
                      <DetailRow label="Type" value={humanise(activeRecord.recordType ?? '')} />
                      <DetailRow label="Date of achievement" value={formatDate(activeRecord.achievementDate)} />
                      <DetailRow label="Location" value={activeRecord.location} />
                      <DetailRow label="Participants" value={activeRecord.participantCount} />
                    </dl>
                  ) : null}
                </Tabs.Content>

                <Tabs.Content value="evidence">
                  {activeRecord ? (
                    <EvidenceTab recordId={activeRecord.id} applicantId={applicant.id} />
                  ) : null}
                </Tabs.Content>

                <Tabs.Content value="timeline">
                  <TimelineFeed applicantId={applicant.id} />
                </Tabs.Content>

                <Tabs.Content value="notes">
                  <NotesTab applicantId={applicant.id} recordId={activeRecord?.id} />
                </Tabs.Content>

                <Tabs.Content value="attachments">
                  <AttachmentsTab applicantId={applicant.id} />
                </Tabs.Content>

                <Tabs.Content value="payment">
                  {activeRecord ? (
                    <PaymentTab recordId={activeRecord.id} applicantId={applicant.id} />
                  ) : null}
                </Tabs.Content>

                <Tabs.Content value="certificate">
                  {activeRecord ? (
                    <CertificateTab recordId={activeRecord.id} applicantId={applicant.id} />
                  ) : null}
                </Tabs.Content>

                <Tabs.Content value="publications">
                  {activeRecord ? (
                    <PublicationsTab recordId={activeRecord.id} applicantId={applicant.id} />
                  ) : null}
                </Tabs.Content>

                <Tabs.Content value="dispatch">
                  {activeRecord ? (
                    <DispatchTab recordId={activeRecord.id} applicantId={applicant.id} />
                  ) : null}
                </Tabs.Content>

                <Tabs.Content value="tasks">
                  <TasksTab applicantId={applicant.id} recordId={activeRecord?.id} />
                </Tabs.Content>

                <Tabs.Content value="communication">
                  {activeRecord ? (
                    <CommunicationTab
                      recordId={activeRecord.id}
                      applicantId={applicant.id}
                      // Enforced server-side too; this only hides the buttons.
                      doNotContact={flags.some((flag) => flag.flag === 'do_not_contact')}
                    />
                  ) : null}
                </Tabs.Content>
              </div>
            </Tabs.Root>
          </Card>
        </div>

        {/* ── Right: smart actions, identifiers, records, recent activity ── */}
        <div className="space-y-4">
          {activeRecord ? (
            <SmartActionPanel
              recordId={activeRecord.id}
              applicantId={applicant.id}
              panel={panel}
              isLoading={panelLoading}
              onAction={(action) => {
                if (action.kind === 'navigate' && action.target.startsWith('tab:')) {
                  setTab(action.target.slice(4));
                } else {
                  toast.info('Phase 2 action', {
                    description: 'This modal is scheduled for Phase 2.',
                  });
                }
              }}
            />
          ) : null}

          {/* Identity documents — masked, with a gated reveal */}
          {applicant.identifiers.hasAadhaar ? (
            <Card>
              <CardHeader title="Identity documents" icon={Icons.Shield} />
              <DetailRow
                label="Aadhaar"
                value={
                  <span className="flex items-center justify-end gap-2">
                    <span className="tabular">
                      {revealedAadhaar ?? applicant.identifiers.aadhaar}
                    </span>
                    {can('pii:reveal') && !revealedAadhaar ? (
                      <button
                        type="button"
                        onClick={() => setRevealOpen(true)}
                        className="text-brand transition-colors hover:text-brand-hover"
                        aria-label="Reveal Aadhaar number"
                      >
                        <Icons.Eye size={13} strokeWidth={2} />
                      </button>
                    ) : null}
                  </span>
                }
              />
              <p className="mt-2 flex items-start gap-1.5 text-[10px] leading-relaxed text-ink-3">
                <Icons.Lock size={11} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0" />
                Encrypted at rest. Every reveal is recorded with your name and reason under DPDP
                §8(4).
              </p>
            </Card>
          ) : null}

          <Card>
            <CardHeader
              title="Records"
              subtitle={`${records.length} on this profile`}
              icon={Icons.FileText}
            />
            <ul className="space-y-2">
              {records.map((record) => {
                const isActive = record.id === activeRecord?.id;
                return (
                  <li key={record.id}>
                    {/* Selecting a record re-points the header, status cards and
                        Smart Action panel at it — that is how a profile holding
                        three records stays workable on one screen. */}
                    <button
                      type="button"
                      onClick={() => setActiveRecordId(record.id)}
                      aria-pressed={isActive}
                      className={cn(
                        'w-full rounded-lg border p-2.5 text-left transition-colors',
                        isActive
                          ? 'border-brand bg-brand-tint'
                          : 'border-line hover:bg-canvas',
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 flex-1 truncate text-xs font-medium text-ink">
                          {record.recordTitle ?? record.recordCode}
                        </p>
                        <StatusBadge status={record.status} size="sm" />
                      </div>
                      <p className="tabular mt-0.5 text-[10px] text-ink-3">
                        {record.recordCode} · {formatRelative(record.updatedAt)}
                        {isActive ? ' · showing' : ''}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Recent activity" icon={Icons.Clock} />
            <TimelineFeed applicantId={applicant.id} limit={6} compact />
          </Card>
        </div>
      </div>

      <EditApplicantDialog profile={applicant} open={editOpen} onOpenChange={setEditOpen} />

      <AddRecordDialog
        applicantId={applicant.id}
        applicantCode={applicant.applicantCode}
        applicantName={applicant.fullName}
        isBlacklisted={applicant.isBlacklisted}
        canOverride={can('blacklist:override')}
        open={addRecordOpen}
        onOpenChange={setAddRecordOpen}
      />

      {/* Gated reveal — reason is mandatory and written to the access log */}
      <Dialog
        open={revealOpen}
        onOpenChange={setRevealOpen}
        title="Reveal Aadhaar number"
        description="This access is recorded permanently against your name."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRevealOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={revealMutation.isPending}
              disabled={revealReason.trim().length < 8}
              onClick={() => revealMutation.mutate()}
            >
              Reveal
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="flex items-start gap-2 rounded-lg bg-warn-tint p-3 text-xs leading-relaxed text-warn">
            <Icons.ShieldAlert size={ICON_SIZE.md} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0" />
            Under the DPDP Act, identity documents may only be accessed for a specific, stated
            purpose. Your reason is stored verbatim and is auditable.
          </p>
          <Input
            label="Why do you need to see this?"
            value={revealReason}
            onChange={(event) => setRevealReason(event.target.value)}
            placeholder="e.g. Verifying identity against the submitted ID proof"
            autoFocus
            hint="At least 8 characters."
          />
        </div>
      </Dialog>
    </div>
  );
}

function StatusCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'info' | 'ok' | 'warn' | 'danger' | 'purple' | 'slate';
}) {
  const toneClass = {
    info: 'border-info-ring bg-info-tint text-info',
    ok: 'border-ok-ring bg-ok-tint text-ok',
    warn: 'border-warn-ring bg-warn-tint text-warn',
    danger: 'border-danger-ring bg-danger-tint text-danger',
    purple: 'border-purple-ring bg-purple-tint text-purple',
    slate: 'border-line bg-white text-ink-3',
  }[tone];

  return (
    <div className={cn('rounded-card border p-2.5', toneClass)}>
      <p className="text-[9px] font-semibold uppercase tracking-wider opacity-70">{label}</p>
      <p className="mt-0.5 truncate text-xs font-bold">{humanise(value)}</p>
    </div>
  );
}

function OverviewTab({ data, activeRecordId }: { data: ApplicantProfile; activeRecordId?: string }) {
  const record = data.records.find((item) => item.id === activeRecordId) ?? data.records[0];
  const { applicant } = data;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <h4 className="mb-1.5 text-xs font-semibold text-ink">Applicant summary</h4>
        <dl className="rounded-lg border border-line p-3">
          <DetailRow label="Applicant ID" value={<span className="tabular">{applicant.applicantCode}</span>} />
          <DetailRow label="Father's name" value={applicant.fatherName} />
          <DetailRow label="Mother's name" value={applicant.motherName} />
          <DetailRow label="Date of birth" value={formatDate(applicant.dateOfBirth)} />
          <DetailRow label="Gender" value={humanise(applicant.gender ?? '')} />
          <DetailRow label="Nationality" value={applicant.nationality} />
          {applicant.isMinorAtIntake ? (
            <DetailRow label="Minor at intake" value={<Chip tone="orange">Guardian consent on file</Chip>} />
          ) : null}
        </dl>
      </div>

      <div>
        <h4 className="mb-1.5 text-xs font-semibold text-ink">Record summary</h4>
        <dl className="rounded-lg border border-line p-3">
          <DetailRow label="Record title" value={record?.recordTitle} />
          <DetailRow label="Record ID" value={<span className="tabular">{record?.recordCode}</span>} />
          <DetailRow label="Applied" value={formatDate(record?.applicationDate)} />
          <DetailRow label="Source" value={humanise(record?.source ?? '')} />
          <DetailRow label="Type" value={humanise(record?.recordType ?? '')} />
          <DetailRow label="Evidence files" value={record?.evidenceCount ?? 0} />
        </dl>
      </div>

      <div>
        <h4 className="mb-1.5 text-xs font-semibold text-ink">Contact</h4>
        <dl className="rounded-lg border border-line p-3">
          <DetailRow label="Mobile" value={applicant.mobile} />
          <DetailRow label="WhatsApp" value={applicant.whatsapp ?? applicant.mobile} />
          <DetailRow label="Email" value={<span className="break-all">{applicant.email}</span>} />
          <DetailRow label="Address" value={applicant.addressLine} />
          <DetailRow
            label="City / State"
            value={[applicant.city, applicant.state].filter(Boolean).join(', ') || '—'}
          />
          <DetailRow label="PIN" value={applicant.pincode} />
        </dl>
      </div>

      <div>
        <h4 className="mb-1.5 text-xs font-semibold text-ink">Fulfilment</h4>
        <dl className="rounded-lg border border-line p-3">
          <DetailRow label="Payment" value={humanise(record?.paymentStatus ?? '')} />
          <DetailRow label="Certificate" value={record?.hasCertificate ? 'Issued' : 'Not issued'} />
          <DetailRow label="Publication" value={record?.hasPublication ? 'Published' : '—'} />
          <DetailRow label="Dispatch" value={humanise(record?.deliveryStatus ?? '')} />
        </dl>
      </div>
    </div>
  );
}

function AttachmentsTab({ applicantId }: { applicantId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.attachments(applicantId),
    queryFn: ({ signal }) => api.get<AttachmentItem[]>('/attachments', { applicantId }, signal),
  });

  if (isLoading) return <div className="skeleton h-24" />;

  if ((data?.length ?? 0) === 0) {
    return (
      <EmptyState
        icon={Icons.FileText}
        title="No attachments"
        description="OCR copies, legal notices, correction letters and other miscellaneous files live here."
      />
    );
  }

  return (
    <ul className="space-y-2">
      {data?.map((file) => (
        <li key={file.id} className="flex items-center gap-3 rounded-lg border border-line p-3">
          <Icons.FileText size={ICON_SIZE.md} strokeWidth={ICON_STROKE} className="shrink-0 text-ink-3" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-ink">{file.fileName}</p>
            <p className="text-[10px] text-ink-3">
              {humanise(file.kind)} · {file.uploadedByName} ·{' '}
              {formatRelative(file.createdAt)}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
