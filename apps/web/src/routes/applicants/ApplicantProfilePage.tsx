import * as Tabs from '@radix-ui/react-tabs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/AppShell';
import { Chip, FlagChip, StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, DetailRow, EmptyState, QueryError } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Field';
import { useAuth } from '@/hooks/useAuth';
import { api, ApiError } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { formatDate, formatDateTime, formatRelative, humanise, initials } from '@/lib/format';
import { ICON_SIZE, ICON_STROKE, Icons, type LucideIcon } from '@/lib/icons';
import { queryKeys } from '@/lib/query-client';
import { AssignRecordDialog } from './components/AssignRecordDialog';
import { BlacklistDialog, LiftBlacklistDialog } from './components/BlacklistDialog';
import { AttachmentsTab } from './components/AttachmentsTab';
import { RecordDetailsTab, RecognitionTypeBadge } from './components/RecordDetailsTab';
import { ClientProgressBadge } from './components/ClientProgressBadge';
import { EmailComposerDialog } from './components/EmailComposerDialog';
import { AddRecordDialog } from './components/AddRecordDialog';
import { EditApplicantDialog } from './components/EditApplicantDialog';
import { CommunicationTab } from './components/CommunicationTab';
import { EvidenceTab } from './components/EvidenceTab';
import { CertificateTab, DispatchTab, PublicationsTab } from './components/FulfilmentTabs';
import { PaymentTab } from './components/PaymentTab';
import { TasksTab } from './components/TasksTab';
import { NotesTab } from './components/NotesTab';
import { SmartActionPanel } from './components/SmartActionPanel';
import { WebsiteReviewPanel } from './components/WebsiteReviewPanel';
import { RecordBadges } from './components/RecordBadges';
import { FilePreviewSheet } from '@/components/ui/FilePreviewSheet';
import { DetailGrid, EMPTY, orEmpty } from './components/DetailGrid';
import { PipelineRail } from './components/PipelineRail';
import { TimelineFeed } from './components/TimelineFeed';
import type { RecordStatus } from '@nbr/shared';
import type { ApplicantProfile, AttachmentItem, SmartActionPanel as PanelData } from './types';

/**
 * The panels, grouped down a sidebar.
 *
 * Thirteen destinations was more than a horizontal strip could hold: the last
 * few sat off the right edge behind a scroll nobody discovered, so Dispatch and
 * Communication were effectively hidden. A sidebar shows all thirteen at once
 * and has room for the grouping — what the application *is*, how it is being
 * fulfilled, and what has happened to it — which is roughly how an operator
 * thinks about a file anyway.
 */
const TAB_GROUPS: ReadonlyArray<{
  label: string;
  tabs: ReadonlyArray<{ value: string; label: string; icon: LucideIcon }>;
}> = [
  {
    label: 'Application',
    tabs: [
      { value: 'overview', label: 'Overview', icon: Icons.LayoutDashboard },
      { value: 'application', label: 'Application', icon: Icons.FileText },
      { value: 'achievement', label: 'Record Details', icon: Icons.Award },
      { value: 'evidence', label: 'Evidence', icon: Icons.Upload },
    ],
  },
  {
    label: 'Fulfilment',
    tabs: [
      { value: 'payment', label: 'Payment', icon: Icons.IndianRupee },
      { value: 'certificate', label: 'Certificate', icon: Icons.ShieldCheck },
      { value: 'publications', label: 'Publications', icon: Icons.Newspaper },
      { value: 'dispatch', label: 'Dispatch', icon: Icons.Truck },
    ],
  },
  {
    label: 'Activity',
    tabs: [
      { value: 'timeline', label: 'Timeline', icon: Icons.History },
      { value: 'notes', label: 'Notes', icon: Icons.StickyNote },
      { value: 'tasks', label: 'Tasks', icon: Icons.ClipboardCheck },
      { value: 'communication', label: 'Communication', icon: Icons.MessageCircle },
      { value: 'attachments', label: 'Attachments', icon: Icons.FilePlus2 },
    ],
  },
];

const TABS = TAB_GROUPS.flatMap((group) => group.tabs);

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
  /**
   * A dialog the Smart Action panel has asked a tab to open.
   *
   * Held here because the panel and the tabs are siblings. Cleared as soon as
   * the owning tab reports it has acted, so returning to that tab later does
   * not re-open the dialog.
   */
  const [pendingDialog, setPendingDialog] = useState<string | null>(null);
  const clearPendingDialog = useCallback(() => setPendingDialog(null), []);
  const [assignOpen, setAssignOpen] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [revealOpen, setRevealOpen] = useState(false);
  const [revealReason, setRevealReason] = useState('');
  const [revealedAadhaar, setRevealedAadhaar] = useState<string | null>(null);
  const [addRecordOpen, setAddRecordOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [blacklistOpen, setBlacklistOpen] = useState(false);
  const [liftOpen, setLiftOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const queryClient = useQueryClient();
  const [activeRecordId, setActiveRecordId] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
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

  /**
   * Which tab owns each Smart Action target.
   *
   * The panel names an action; this says where that action lives. Kept as one
   * table rather than a chain of conditionals because it is a mapping, and
   * because a new stage action should only ever need a line adding here.
   */
  const ACTION_TAB: Record<string, string> = {
    'payment-plan': 'payment',
    payment: 'payment',
    certificate: 'certificate',
    publication: 'publications',
    'publication:magazine': 'publications',
    'publication:enews': 'publications',
    dispatch: 'dispatch',
    'dispatch:pod': 'dispatch',
    task: 'tasks',
    note: 'notes',
    evidence: 'evidence',
    email: 'communication',
    'call-note': 'communication',
  };

  function tabForAction(target: string): string | undefined {
    if (ACTION_TAB[target]) return ACTION_TAB[target];
    // email:selection, whatsapp:payment_reminder, and so on.
    if (target.startsWith('email:') || target.startsWith('whatsapp:')) return 'communication';
    return undefined;
  }

  /**
   * Fetch a generated document and hand it to the browser.
   *
   * Each of these is produced on demand rather than stored: an invoice or a
   * selection letter reflects the record as it stands, and a stale copy in the
   * vault would be worse than no copy at all.
   */
  async function runDownload(target: string) {
    if (!activeRecord && target !== 'applicant-pdf') return;

    const endpoints: Record<string, string> = {
      'applicant-pdf': `/applicants/${applicant.id}/document`,
      invoice: `/records/${activeRecord?.id}/documents/invoice`,
      'selection-letter': `/records/${activeRecord?.id}/documents/selection-letter`,
    };

    // The certificate is a stored file, not a generated one — it has its own
    // versioned download that returns a signed URL.
    if (target === 'certificate') {
      setTab('certificate');
      return;
    }

    const endpoint = endpoints[target];
    if (!endpoint) {
      toast.error('That document is not available');
      return;
    }

    setDownloading(target);
    try {
      // Same shape as every other download here: the server writes the file to
      // the vault and hands back a short-lived signed URL, so the API never
      // streams bytes through an app worker.
      const { url } = await api.get<{ url: string; fileName: string }>(endpoint);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error: unknown) {
      toast.error(
        error instanceof ApiError ? error.message : 'Could not generate the document',
      );
    } finally {
      setDownloading(null);
    }
  }

  function setTab(tab: string) {
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    setSearchParams(next, { replace: true });
  }

  /**
   * A failed load is not the same as a missing applicant.
   *
   * This branch used to say "Applicant not found" for *any* error — a 500, a
   * dropped connection, an API that was restarting — which told the operator
   * the profile had been deleted when nothing of the sort had happened, and
   * offered them no way to try again. Only a real 404 means what that sentence
   * says; everything else is us, and should say so and offer a retry.
   */
  if (isError) {
    const missing = error instanceof ApiError && error.status === 404;

    return (
      <div className="p-5">
        {missing ? (
          <EmptyState
            icon={Icons.Search}
            title="Applicant not found"
            description="This profile may have been removed, or the link is wrong."
          />
        ) : (
          <Card>
            <QueryError
              title="Couldn't load this profile"
              description={
                error instanceof ApiError
                  ? error.message
                  : 'The server did not respond. It may be restarting.'
              }
              onRetry={() => void refetch()}
            />
          </Card>
        )}
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
  // §20 — this flag hides every outreach action, so it is read once here rather
  // than recomputed at each place that has to respect it.
  const doNotContact = flags.some((flag) => flag.flag === 'do_not_contact');

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
              <Button
                variant="secondary"
                icon={Icons.Printer}
                loading={downloading === 'applicant-pdf'}
                onClick={() => void runDownload('applicant-pdf')}
              >
                Export PDF
              </Button>
            ) : null}
            {/*
              Writing to an applicant is the single most common thing an
              operator does on this page, and it used to be four clicks away
              behind the Communication tab. It belongs where Edit and Export
              are, because that is where the hand already is.

              Two states rather than a hidden button: a record is needed to send
              (the message is filed against one), and Do Not Contact means no
              outreach at all — the server refuses either way, and a button that
              simply vanishes leaves the operator wondering whether they lack the
              permission.
            */}
            {can('communications:send') ? (
              <Button
                variant="secondary"
                icon={Icons.Mail}
                disabled={!activeRecord || doNotContact}
                title={
                  doNotContact
                    ? 'This applicant is flagged Do Not Contact.'
                    : !activeRecord
                      ? 'Open a record first — emails are filed against one.'
                      : undefined
                }
                onClick={() => setEmailOpen(true)}
              >
                Email
              </Button>
            ) : null}
            {/* §19 — sits beside Edit rather than buried in the register,
                because the moment an operator learns a document was forged is
                the moment they are looking at this profile. */}
            {!applicant.isBlacklisted && can('blacklist:create') ? (
              <Button variant="secondary" icon={Icons.Ban} onClick={() => setBlacklistOpen(true)}>
                Blacklist
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
      {/* Shown only when the applicant actually is blacklisted — the flag alone
          is enough, because a blacklist whose detail row failed to load is still
          a blacklist and staying silent about it is the one wrong answer. */}
      {applicant.isBlacklisted ? (
        <div className="mb-4 rounded-card border border-danger-ring bg-danger-tint p-4">
          <div className="flex gap-3">
            <Icons.Ban size={20} strokeWidth={2} className="mt-0.5 shrink-0 text-danger" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-danger">
                Blacklisted{activeBlacklist ? ` — ${humanise(activeBlacklist.kind)}` : ''}
              </p>
              {activeBlacklist ? (
                <p className="mt-0.5 text-xs text-ink-2">
                  <span className="font-semibold">{humanise(activeBlacklist.reason)}</span> ·{' '}
                  {activeBlacklist.reasonDetail}
                </p>
              ) : null}
              <p className="mt-1 text-[11px] text-ink-3">
                {activeBlacklist
                  ? `Effective ${formatDate(activeBlacklist.effectiveFrom)}${
                      activeBlacklist.effectiveUntil
                        ? ` until ${formatDate(activeBlacklist.effectiveUntil)}`
                        : ' · permanent'
                    }. `
                  : ''}
                New applications are blocked unless an Admin overrides, and their NBR website
                account is suspended.
              </p>
            </div>

            {/* Lifting was only reachable from the register at Admin →
                Blacklist, which meant an operator reading the banner had no way
                to act on it from where they were standing. */}
            {activeBlacklist && can('blacklist:edit') ? (
              <Button size="sm" variant="secondary" onClick={() => setLiftOpen(true)}>
                Lift
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {/*
        One full-width column, with the supporting panels stacked underneath.

        This was a 2:1 split with a permanent right rail. The rail held three
        things an operator consults occasionally — next steps, the other records
        on the profile, recent activity — and to do it, it took a third of the
        screen away from the thing they are actually reading. Fields wrapped and
        truncated in two-thirds of the width while a mostly-idle column sat
        beside them. The detail now gets the whole width and the panels sit
        below it, side by side, where they cost nothing until wanted.
      */}
      <div className="space-y-4">
        {/* ── Left: identity, status cards, panels ────────────────────────
            `min-w-0` because a grid item, like a flex item, sizes to its
            widest child by default — the panel sidebar would otherwise stretch
            this column past the viewport and the overflow would be clipped
            rather than scrollable, putting the right-hand half of every value
            out of reach on a narrow screen. */}
        <div className="min-w-0 space-y-4">
          <Card>
            <div className="flex flex-wrap gap-4">
              <span className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-navy text-lg font-bold text-white">
                {initials(applicant.fullName)}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold tracking-tight text-ink">{applicant.fullName}</h2>
                  {activeRecord ? <StatusBadge status={activeRecord.status} /> : null}
                  {/*
                    Title Type — what NBR has actually recognised.

                    At the very top because it changes how everything below is
                    read: a National Record and an Achiever award print
                    differently, verify differently and mean different things,
                    and an operator needs to know which before anything else.
                    Shows as "not set" rather than hiding, so an undecided
                    record is visibly undecided instead of just blank.
                  */}
                  {activeRecord ? (
                    <RecognitionTypeBadge
                      recognitionType={activeRecord.recognitionType}
                      onEdit={
                        can('records:edit')
                          ? () => setSearchParams({ tab: 'achievement' })
                          : undefined
                      }
                    />
                  ) : null}
                  {/* The client's eleven-stage view, beside the internal status
                      rather than instead of it. The workflow rail further down
                      is untouched. */}
                  {activeRecord ? <ClientProgressBadge recordId={activeRecord.id} /> : null}
                </div>

                {/* What the selected record is: one person or a group, and
                    which award it was filed for. */}
                {activeRecord ? (
                  <div className="mt-2">
                    <RecordBadges
                      recordId={activeRecord.id}
                      recordType={activeRecord.recordType}
                    />
                  </div>
                ) : null}

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

          {/* Sidebar layout — panels are lazily mounted, so only the visible
              one's data is fetched. Vertical orientation tells Radix to move
              selection with Up/Down rather than Left/Right. */}
          <Card padded={false}>
            <Tabs.Root
              value={activeTab}
              onValueChange={setTab}
              orientation="vertical"
              // `min-w-0` on both the row and its children: a flex item defaults to
              // min-width:auto, so the tab strip and the panel could each push the
              // page wider than the viewport instead of scrolling inside themselves.
              className="flex w-full min-w-0 flex-col sm:flex-row"
            >
              <Tabs.List
                className={cn(
                  'shrink-0 gap-0.5 border-line p-2',
                  // On a phone the sidebar lies down and scrolls horizontally.
                  // `w-full` plus a `min-w-0` parent is what actually confines
                  // it — without a definite width `overflow-x-auto` has nothing
                  // to overflow *against*, so the strip silently widened the
                  // whole column and clipped every value on the right.
                  'scrollbar-slim flex w-full min-w-0 overflow-x-auto border-b',
                  'sm:w-48 sm:shrink-0 sm:flex-col sm:overflow-x-visible sm:border-b-0 sm:border-r',
                )}
              >
                {TAB_GROUPS.map((group) => (
                  <div key={group.label} className="contents sm:block">
                    <p className="hidden px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-ink-4 first:pt-1 sm:block">
                      {group.label}
                    </p>

                    {group.tabs.map((tab) => (
                      <Tabs.Trigger
                        key={tab.value}
                        value={tab.value}
                        className={cn(
                          'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-2.5 py-2 text-xs font-medium transition-colors',
                          'text-ink-2 hover:bg-slate2-tint hover:text-ink',
                          'data-[state=active]:bg-brand-tint data-[state=active]:font-semibold data-[state=active]:text-brand',
                          'sm:w-full',
                        )}
                      >
                        <tab.icon size={14} strokeWidth={ICON_STROKE} className="shrink-0" aria-hidden />
                        <span className="flex-1 text-left">{tab.label}</span>
                        {tab.value === 'evidence' && activeRecord?.evidenceCount ? (
                          <span className="tabular rounded bg-slate2-tint px-1 text-[9px] font-semibold text-ink-2">
                            {activeRecord.evidenceCount}
                          </span>
                        ) : null}
                      </Tabs.Trigger>
                    ))}
                  </div>
                ))}
              </Tabs.List>

              <div className="w-full min-w-0 flex-1 overflow-x-hidden p-4">
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
                    <RecordDetailsTab record={activeRecord} applicantId={applicant.id} />
                  ) : null}
                </Tabs.Content>

                <Tabs.Content value="evidence">
                  {activeRecord ? (
                    <EvidenceTab
                      recordId={activeRecord.id}
                      applicantId={applicant.id}
                      autoOpen={pendingDialog}
                      onAutoOpened={clearPendingDialog}
                    />
                  ) : null}
                </Tabs.Content>

                <Tabs.Content value="timeline">
                  <TimelineFeed applicantId={applicant.id} />
                </Tabs.Content>

                <Tabs.Content value="notes">
                  <NotesTab
                    applicantId={applicant.id}
                    recordId={activeRecord?.id}
                    autoOpen={pendingDialog}
                    onAutoOpened={clearPendingDialog}
                  />
                </Tabs.Content>

                <Tabs.Content value="attachments">
                  <AttachmentsTab applicantId={applicant.id} recordId={activeRecord?.id} />
                </Tabs.Content>

                <Tabs.Content value="payment">
                  {activeRecord ? (
                    <PaymentTab
                      recordId={activeRecord.id}
                      applicantId={applicant.id}
                      autoOpen={pendingDialog}
                      onAutoOpened={clearPendingDialog}
                    />
                  ) : null}
                </Tabs.Content>

                <Tabs.Content value="certificate">
                  {activeRecord ? (
                    <CertificateTab
                      recordId={activeRecord.id}
                      applicantId={applicant.id}
                      autoOpen={pendingDialog}
                      onAutoOpened={clearPendingDialog}
                    />
                  ) : null}
                </Tabs.Content>

                <Tabs.Content value="publications">
                  {activeRecord ? (
                    <PublicationsTab
                      recordId={activeRecord.id}
                      applicantId={applicant.id}
                      autoOpen={pendingDialog}
                      onAutoOpened={clearPendingDialog}
                    />
                  ) : null}
                </Tabs.Content>

                <Tabs.Content value="dispatch">
                  {activeRecord ? (
                    <DispatchTab
                      recordId={activeRecord.id}
                      applicantId={applicant.id}
                      autoOpen={pendingDialog}
                      onAutoOpened={clearPendingDialog}
                    />
                  ) : null}
                </Tabs.Content>

                <Tabs.Content value="tasks">
                  <TasksTab
                    applicantId={applicant.id}
                    recordId={activeRecord?.id}
                    autoOpen={pendingDialog}
                    onAutoOpened={clearPendingDialog}
                  />
                </Tabs.Content>

                <Tabs.Content value="communication">
                  {activeRecord ? (
                    <CommunicationTab
                      recordId={activeRecord.id}
                      applicantId={applicant.id}
                      applicantEmail={applicant.email}
                      // Enforced server-side too; this only hides the buttons.
                      doNotContact={doNotContact}
                      autoOpen={pendingDialog}
                      onAutoOpened={clearPendingDialog}
                    />
                  ) : null}
                </Tabs.Content>
              </div>
            </Tabs.Root>
          </Card>
        </div>

        {/* ── Below: smart actions, identifiers, records, recent activity ──
            Three across on a wide screen, stacking on a narrow one. `min-w-0`
            on every child for the usual reason: a grid item sizes to its widest
            content unless told otherwise, and a long record title would push
            the row past the viewport. */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
          {/* Renders nothing unless this record came from the public website
              and still has a decision open over there. */}
          {activeRecord ? (
            <WebsiteReviewPanel recordId={activeRecord.id} applicantId={applicant.id} />
          ) : null}

          {activeRecord ? (
            <SmartActionPanel
              recordId={activeRecord.id}
              applicantId={applicant.id}
              panel={panel}
              isLoading={panelLoading}
              onAction={(action) => {
                if (action.kind === 'navigate') {
                  if (action.target.startsWith('tab:')) {
                    setTab(action.target.slice(4));
                    return;
                  }
                  if (action.target === 'record:new') {
                    setAddRecordOpen(true);
                    return;
                  }
                }

                if (action.kind === 'modal') {
                  if (action.target === 'assign') {
                    setAssignOpen(true);
                    return;
                  }

                  const tab = tabForAction(action.target);
                  if (tab) {
                    // Switch first: the tab has to be mounted before it can act
                    // on the request.
                    setTab(tab);
                    setPendingDialog(action.target);
                    return;
                  }
                }

                if (action.kind === 'download') {
                  void runDownload(action.target);
                  return;
                }

                toast.error('That action is not available here', {
                  description: `No handler for "${action.target}".`,
                });
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

      {/* The same composer the Communication tab opens — one dialog, so a
          message written from the header is filed, previewed and recorded
          identically to one written from the tab. */}
      {emailOpen && activeRecord ? (
        <EmailComposerDialog
          recordId={activeRecord.id}
          defaultTo={applicant.email}
          onClose={() => setEmailOpen(false)}
          onSent={() => {
            // The history lives on the Communication tab, which may not be
            // open — invalidate it anyway so it is right when they get there.
            void queryClient.invalidateQueries({ queryKey: ['communications', applicant.id] });
            void queryClient.invalidateQueries({
              queryKey: queryKeys.recordTimeline(activeRecord.id),
            });
            void queryClient.invalidateQueries({
              queryKey: queryKeys.applicantTimeline(applicant.id),
            });
          }}
        />
      ) : null}

      <BlacklistDialog
        open={blacklistOpen}
        onOpenChange={setBlacklistOpen}
        applicant={{
          id: applicant.id,
          fullName: applicant.fullName,
          applicantCode: applicant.applicantCode,
        }}
        onDone={() => void refetch()}
      />

      {activeBlacklist ? (
        <LiftBlacklistDialog
          blacklistId={activeBlacklist.id}
          applicantId={applicant.id}
          applicantName={applicant.fullName}
          open={liftOpen}
          onOpenChange={setLiftOpen}
          onDone={() => void refetch()}
        />
      ) : null}

      {activeRecord ? (
        <AssignRecordDialog
          recordId={activeRecord.id}
          applicantId={applicant.id}
          currentUserId={activeRecord.assignedToUserId ?? null}
          open={assignOpen}
          onOpenChange={setAssignOpen}
        />
      ) : null}

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
    <div className="space-y-6">
      {/* Where it has got to, in the website's own five steps. */}
      {record ? (
        <section>
          <SectionHeading icon={Icons.TrendingUp} title="Progress" />
          <PipelineRail status={record.status as RecordStatus} />
        </section>
      ) : null}

      <section>
        <SectionHeading icon={Icons.User} title="Applicant" />
        <DetailGrid
          columns={3}
          fields={[
            { icon: Icons.ScanBarcode, label: 'Applicant ID', value: applicant.applicantCode, mono: true },
            { icon: Icons.User, label: "Father's name", value: orEmpty(applicant.fatherName) },
            { icon: Icons.User, label: "Mother's name", value: orEmpty(applicant.motherName) },
            { icon: Icons.CalendarClock, label: 'Date of birth', value: orEmpty(formatDate(applicant.dateOfBirth)) },
            { icon: Icons.Info, label: 'Gender', value: orEmpty(humanise(applicant.gender ?? '')) },
            { icon: Icons.Globe, label: 'Nationality', value: orEmpty(applicant.nationality) },
            ...(applicant.isMinorAtIntake
              ? [{
                  icon: Icons.ShieldCheck,
                  label: 'Minor at intake',
                  value: <Chip tone="orange">Guardian consent on file</Chip>,
                }]
              : []),
          ]}
        />
      </section>

      <section>
        <SectionHeading icon={Icons.Phone} title="Contact" />
        <DetailGrid
          columns={3}
          fields={[
            { icon: Icons.Phone, label: 'Mobile', value: applicant.mobile, mono: true },
            { icon: Icons.MessageCircle, label: 'WhatsApp', value: applicant.whatsapp ?? applicant.mobile, mono: true },
            { icon: Icons.Mail, label: 'Email', value: orEmpty(applicant.email) },
            { icon: Icons.Building2, label: 'Address', value: orEmpty(applicant.addressLine), wide: true },
            {
              icon: Icons.Globe,
              label: 'City / State',
              value: orEmpty([applicant.city, applicant.state].filter(Boolean).join(', ')),
            },
            { icon: Icons.ScanBarcode, label: 'PIN', value: orEmpty(applicant.pincode), mono: true },
          ]}
        />
      </section>

      {record ? (
        <section>
          <SectionHeading icon={Icons.Award} title="Record" />
          <DetailGrid
            columns={3}
            fields={[
              { icon: Icons.Award, label: 'Record title', value: record.recordTitle, wide: true },
              { icon: Icons.ScanBarcode, label: 'Record ID', value: record.recordCode, mono: true },
              { icon: Icons.CalendarClock, label: 'Applied', value: orEmpty(formatDate(record.applicationDate)) },
              { icon: Icons.Globe, label: 'Source', value: orEmpty(humanise(record.source ?? '')) },
              { icon: Icons.Users, label: 'Type', value: orEmpty(humanise(record.recordType ?? '')) },
              { icon: Icons.Upload, label: 'Evidence files', value: String(record.evidenceCount ?? 0), mono: true },
            ]}
          />
        </section>
      ) : null}

      {record ? (
        <section>
          <SectionHeading icon={Icons.Truck} title="Fulfilment" />
          <DetailGrid
            columns={3}
            fields={[
              { icon: Icons.IndianRupee, label: 'Payment', value: orEmpty(humanise(record.paymentStatus ?? '')) },
              {
                icon: Icons.ShieldCheck,
                label: 'Certificate',
                value: record.hasCertificate ? 'Issued' : EMPTY,
              },
              {
                icon: Icons.Newspaper,
                label: 'Publication',
                value: record.hasPublication ? 'Published' : EMPTY,
              },
              { icon: Icons.Truck, label: 'Dispatch', value: orEmpty(humanise(record.deliveryStatus ?? '')) },
            ]}
          />
        </section>
      ) : null}
    </div>
  );
}

/** A titled band, matching how the website's applicant screen introduces each block. */
function SectionHeading({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <h4 className="mb-3 flex items-center gap-2 border-b border-line pb-2 text-xs font-bold text-ink">
      <Icon size={14} strokeWidth={ICON_STROKE} className="text-brand" aria-hidden />
      {title}
    </h4>
  );
}

