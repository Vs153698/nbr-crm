import {
  CERTIFICATE_VERIFICATION,
  CERTIFICATE_VERIFICATION_LABELS,
  DELIVERY_STATUS,
  PUBLICATION_KIND,
  type PublicationKind,
} from '@nbr/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Chip } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { CardHeader, DetailRow, EmptyState } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { RowActions } from '@/components/ui/RowActions';
import { Input, Select, Textarea } from '@/components/ui/Field';
import { useAuth } from '@/hooks/useAuth';
import { api, ApiError, uploadToStorage } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { formatDate, formatRelative, humanise } from '@/lib/format';
import { ICON_SIZE, ICON_STROKE, Icons } from '@/lib/icons';
import { queryKeys } from '@/lib/query-client';
import type { CertificateView, DispatchRow, Lookups, PublicationRow } from '../types';
import { useAutoOpen } from '@/hooks/useAutoOpen';

/** Upload a file straight to storage and return its key. */
async function uploadFile(
  file: File,
  scope: string,
  recordId: string,
): Promise<string> {
  const presigned = await api.post<{ uploadUrl: string; storageKey: string }>('/uploads/presign', {
    scope,
    fileName: file.name,
    contentType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
    recordId,
  });
  await uploadToStorage(presigned.uploadUrl, file);
  return presigned.storageKey;
}

/**
 * W-11 Certificate tab (§10, M-04).
 *
 * The stage runs in two deliberate steps — **upload**, then **verify** — and
 * this screen is built around that separation rather than hiding it. Uploading
 * hands over a file; verifying is a named person saying it is correct, and only
 * that releases the record to Dispatch.
 *
 * Every upload appends a version and the previous ones stay downloadable — the
 * UI says so explicitly, because a user who believes "upload" means "replace"
 * will hesitate to correct a typo on a certificate.
 */
export function CertificateTab({
  recordId,
  applicantId,
  autoOpen,
  onAutoOpened,
}: {
  recordId: string;
  applicantId: string;
  autoOpen?: string | null;
  onAutoOpened?: () => void;
}) {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);

  useAutoOpen(autoOpen, { certificate: () => setUploadOpen(true) }, onAutoOpened);

  const { data: certificate, isLoading } = useQuery({
    queryKey: queryKeys.certificate(recordId),
    queryFn: ({ signal }) => api.get<CertificateView | null>('/certificates', { recordId }, signal),
  });

  const downloadMutation = useMutation({
    mutationFn: (params: { versionId: string; file: 'pdf' | 'editable' }) =>
      api.get<{ url: string }>(`/certificates/versions/${params.versionId}/download`, {
        file: params.file,
      }),
    onSuccess: ({ url }) => window.open(url, '_blank', 'noopener,noreferrer'),
    onError: () => toast.error('Could not open that certificate'),
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.certificate(recordId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.applicant(applicantId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.recordActions(recordId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.recordTimeline(recordId) });
  }

  if (isLoading) return <div className="skeleton h-40" />;

  const uploaded = (certificate?.versions.length ?? 0) > 0;
  const verified = certificate?.verificationStatus === CERTIFICATE_VERIFICATION.VERIFIED;
  const canSignOff = uploaded && !certificate?.isCurrentVersionVerified;

  return (
    <div className="space-y-4">
      <CardHeader
        title="Certificate"
        subtitle={
          certificate && uploaded
            ? `${certificate.certificateNumber} · version ${certificate.currentVersion} · ${CERTIFICATE_VERIFICATION_LABELS[certificate.verificationStatus]}`
            : 'Not uploaded yet'
        }
        icon={Icons.Award}
        action={
          can('certificates:create') ? (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={canSignOff ? 'secondary' : 'primary'}
                icon={Icons.Upload}
                onClick={() => setUploadOpen(true)}
              >
                {uploaded ? 'Upload new version' : 'Upload certificate'}
              </Button>
              {/* The stage-completing action, and the only one. Shown as the
                  primary once a file is waiting on it, because at that point
                  it is the single thing standing between the record and
                  Dispatch. */}
              {canSignOff ? (
                <Button
                  size="sm"
                  variant="primary"
                  icon={Icons.ShieldCheck}
                  onClick={() => setVerifyOpen(true)}
                >
                  Mark verified & complete
                </Button>
              ) : null}
            </div>
          ) : null
        }
      />

      {!certificate || !uploaded ? (
        <>
          <EmptyState
            icon={Icons.Award}
            title="No certificate uploaded"
            description="Certificates are prepared manually and uploaded here. Nothing is generated automatically — the record stays in Certificate Verification until an employee uploads the certificate and marks it verified."
          />
          {/* The website allocates a number of its own when the fee settles.
              Showing it here stops an operator hunting for a certificate that
              exists only as a string on the public verification page. */}
          {certificate?.certificateNumber ? (
            <p className="flex gap-2 rounded-card border border-line bg-canvas px-3 py-2.5 text-[11px] text-ink-2">
              <Icons.Info
                size={ICON_SIZE.sm}
                strokeWidth={ICON_STROKE}
                className="mt-px shrink-0 text-ink-3"
              />
              <span>
                The NBR website has reserved certificate number{' '}
                <span className="tabular font-semibold text-ink">
                  {certificate.certificateNumber}
                </span>{' '}
                for this record. It is a reference only — it becomes the official certificate when
                you upload the file and mark it verified.
              </span>
            </p>
          ) : null}
        </>
      ) : (
        <>
          <CertificateVerificationBanner certificate={certificate} />

          <dl className="rounded-lg border border-line p-3 sm:max-w-md">
            <DetailRow label="Certificate number" value={certificate.certificateNumber} />
            <DetailRow label="Record number" value={certificate.recordNumber} />
            <DetailRow label="Issue date" value={formatDate(certificate.issueDate)} />
            <DetailRow label="Current version" value={`v${certificate.currentVersion}`} />
            <DetailRow
              label="Verification"
              value={CERTIFICATE_VERIFICATION_LABELS[certificate.verificationStatus]}
            />
            {verified ? (
              <>
                <DetailRow
                  label="Verified by"
                  value={
                    certificate.verifiedByName
                      ? `${certificate.verifiedByName} (v${certificate.verifiedVersion})`
                      : null
                  }
                />
                <DetailRow label="Verified on" value={formatDate(certificate.verifiedAt)} />
              </>
            ) : null}
          </dl>

          <div>
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-ink">
              Version history ({certificate.versions.length})
              <span className="flex items-center gap-1 text-[10px] font-normal text-ink-3">
                <Icons.Lock size={10} strokeWidth={ICON_STROKE} />
                permanent — never deleted
              </span>
            </h4>

            <ul className="space-y-1.5">
              {certificate.versions.map((version) => (
                <li
                  key={version.id}
                  className={cn(
                    'flex flex-wrap items-center gap-3 rounded-lg border p-2.5',
                    version.isCurrent ? 'border-teal-ring bg-teal-tint' : 'border-line',
                  )}
                >
                  <span
                    className={cn(
                      'grid h-7 w-7 shrink-0 place-items-center rounded-md text-2xs font-bold',
                      version.isCurrent ? 'bg-teal text-white' : 'bg-slate2-tint text-ink-2',
                    )}
                  >
                    v{version.version}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-ink">
                      {version.versionReason ?? `Version ${version.version}`}
                      {version.isCurrent ? (
                        <span className="ml-1.5 text-2xs font-normal text-teal">current</span>
                      ) : (
                        <span className="ml-1.5 text-2xs font-normal text-ink-3">superseded</span>
                      )}
                      {/* Which version carries the sign-off, not merely which
                          is newest. After a correction these differ, and that
                          difference is the whole reason the stage reopens. */}
                      {version.isVerified ? (
                        <span className="ml-1.5 text-2xs font-semibold text-ok">verified</span>
                      ) : null}
                    </p>
                    <p className="text-[10px] text-ink-3">
                      Uploaded by {version.uploadedByName ?? 'unknown'} ·{' '}
                      {formatRelative(version.createdAt)} · issue date{' '}
                      {formatDate(version.issueDate)}
                    </p>
                  </div>

                  <RowActions
                    label={`Downloads for version ${version.version}`}
                    actions={[
                      {
                        id: 'pdf',
                        label: 'Download PDF',
                        icon: Icons.Download,
                        onSelect: () =>
                          downloadMutation.mutate({ versionId: version.id, file: 'pdf' }),
                      },
                      {
                        id: 'source',
                        label: 'Download source file',
                        icon: Icons.FileText,
                        disabled: !version.hasEditableFile,
                        disabledReason: 'No editable file was uploaded with this version.',
                        onSelect: () =>
                          downloadMutation.mutate({ versionId: version.id, file: 'editable' }),
                      },
                    ]}
                  />
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {verifyOpen && certificate ? (
        <VerifyCertificateDialog
          recordId={recordId}
          certificate={certificate}
          onClose={() => setVerifyOpen(false)}
          onSaved={invalidate}
        />
      ) : null}

      {uploadOpen ? (
        <UploadCertificateDialog
          recordId={recordId}
          existing={certificate}
          onClose={() => setUploadOpen(false)}
          onSaved={invalidate}
        />
      ) : null}
    </div>
  );
}

/**
 * Where the certificate stands, stated plainly at the top of the tab.
 *
 * Three states, three different things for the reader to do — and the middle
 * one is the state this whole flow exists to make visible. A file that has been
 * uploaded but not checked used to be indistinguishable from a finished
 * certificate, which is how drafts went out.
 */
function CertificateVerificationBanner({ certificate }: { certificate: CertificateView }) {
  if (certificate.isCurrentVersionVerified) {
    return (
      <p className="flex gap-2 rounded-card border border-ok-ring bg-ok-tint px-3 py-2.5 text-[11px] text-ink-2">
        <Icons.ShieldCheck
          size={ICON_SIZE.sm}
          strokeWidth={ICON_STROKE}
          className="mt-px shrink-0 text-ok"
        />
        <span>
          <span className="font-semibold text-ok">Verified and complete.</span> v
          {certificate.verifiedVersion} was signed off by{' '}
          {certificate.verifiedByName ?? 'an employee'} on {formatDate(certificate.verifiedAt)} and
          is the official certificate. The record has moved on to Dispatch.
          {certificate.verificationNotes ? ` — ${certificate.verificationNotes}` : ''}
        </span>
      </p>
    );
  }

  // Signed off, then corrected. The newest file has nobody's approval on it,
  // and saying "verified" here because the certificate *once* was would be the
  // most dangerous thing this panel could do.
  if (certificate.verificationStatus === CERTIFICATE_VERIFICATION.VERIFIED) {
    return (
      <p className="flex gap-2 rounded-card border border-warn-ring bg-warn-tint px-3 py-2.5 text-[11px] text-ink-2">
        <Icons.ShieldAlert
          size={ICON_SIZE.sm}
          strokeWidth={ICON_STROKE}
          className="mt-px shrink-0 text-warn"
        />
        <span>
          <span className="font-semibold text-warn">
            v{certificate.currentVersion} has not been verified.
          </span>{' '}
          The sign-off on record is for v{certificate.verifiedVersion}, which this version
          replaced. Check the new file and mark it verified before it goes out.
        </span>
      </p>
    );
  }

  return (
    <p className="flex gap-2 rounded-card border border-warn-ring bg-warn-tint px-3 py-2.5 text-[11px] text-ink-2">
      <Icons.Clock
        size={ICON_SIZE.sm}
        strokeWidth={ICON_STROKE}
        className="mt-px shrink-0 text-warn"
      />
      <span>
        <span className="font-semibold text-warn">Awaiting verification.</span> The certificate has
        been uploaded but is not yet official. Check it, then mark it verified — that completes the
        certificate stage and sends the record to Dispatch.
      </span>
    </p>
  );
}

/**
 * The sign-off.
 *
 * Deliberately a dialog with a confirm rather than a one-click toggle: it
 * publishes the certificate to the public verification page and moves the
 * record to Dispatch, and both of those are awkward to walk back. What it
 * asks for is small — optional notes on what was checked — but what it states
 * before the click is not.
 */
function VerifyCertificateDialog({
  recordId,
  certificate,
  onClose,
  onSaved,
}: {
  recordId: string;
  certificate: CertificateView;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [notes, setNotes] = useState('');

  const mutation = useMutation({
    mutationFn: () => api.post('/certificates/verify', { recordId, notes: notes.trim() || undefined }),
    onSuccess: () => {
      toast.success('Certificate verified', {
        description: 'The certificate stage is complete and the record has moved to Dispatch.',
      });
      onSaved();
      onClose();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not verify the certificate'),
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Mark certificate verified"
      description={`v${certificate.currentVersion} becomes the official certificate for this record.`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={Icons.ShieldCheck}
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            Verify & complete stage
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <dl className="rounded-lg border border-line p-3">
          <DetailRow label="Certificate number" value={certificate.certificateNumber} />
          <DetailRow label="Version being verified" value={`v${certificate.currentVersion}`} />
          <DetailRow
            label="Uploaded by"
            value={certificate.versions[0]?.uploadedByName ?? null}
          />
          <DetailRow label="Issue date" value={formatDate(certificate.issueDate)} />
        </dl>

        <p className="text-xs text-ink-2">
          Download and check the PDF first. On confirming, this version becomes the official
          certificate, its number is registered on the NBR website's public verification page, and
          the record moves to <strong className="text-ink">Dispatch Pending</strong>.
        </p>

        <Textarea
          label="What you checked"
          hint="Optional. Recorded against your name on the permanent timeline."
          rows={3}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Name spelling, category and achievement date checked against the application."
        />
      </div>
    </Dialog>
  );
}

function UploadCertificateDialog({
  recordId,
  existing,
  onClose,
  onSaved,
}: {
  recordId: string;
  existing?: CertificateView | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const pdfRef = useRef<HTMLInputElement>(null);
  const srcRef = useRef<HTMLInputElement>(null);
  const [pdf, setPdf] = useState<File | null>(null);
  const [source, setSource] = useState<File | null>(null);
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [versionReason, setVersionReason] = useState('');
  const [busy, setBusy] = useState(false);

  const nextVersion = (existing?.currentVersion ?? 0) + 1;

  async function submit() {
    if (!pdf) return;
    setBusy(true);
    try {
      const pdfKey = await uploadFile(pdf, 'certificate', recordId);
      const editableFileKey = source ? await uploadFile(source, 'certificate', recordId) : undefined;

      const result = await api.post<{ version: number; certificateNumber: string }>('/certificates', {
        recordId,
        issueDate,
        pdfKey,
        editableFileKey,
        versionReason: versionReason || undefined,
      });

      toast.success(`${result.certificateNumber} saved as v${result.version}`);
      onClose();
      onSaved();
    } catch (error: unknown) {
      toast.error(error instanceof ApiError ? error.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={onClose}
      title={existing ? `Upload version ${nextVersion}` : 'Upload certificate'}
      description={
        existing
          ? `Version ${existing.currentVersion} is kept and stays downloadable.`
          : 'A certificate number is allocated automatically.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!pdf} onClick={() => void submit()}>
            {existing ? `Upload as v${nextVersion}` : 'Upload certificate'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          label="Issue date"
          type="date"
          value={issueDate}
          onChange={(event) => setIssueDate(event.target.value)}
        />

        {existing ? (
          <Input
            label="Why a new version?"
            value={versionReason}
            onChange={(event) => setVersionReason(event.target.value)}
            placeholder="e.g. Correction — name spelling"
            hint="Shown in the permanent version history."
          />
        ) : null}

        <FilePicker
          label="Certificate PDF"
          required
          file={pdf}
          inputRef={pdfRef}
          accept="application/pdf"
          onPick={setPdf}
        />
        <FilePicker
          label="Editable source file (optional)"
          file={source}
          inputRef={srcRef}
          onPick={setSource}
          hint="The designer's AI/PSD/DOCX, kept alongside the PDF."
        />

        {existing ? (
          <p className="flex items-start gap-1.5 rounded-lg bg-canvas p-2.5 text-[11px] text-ink-3">
            <Icons.Lock size={13} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0" />
            Version {existing.currentVersion} is never deleted. Both versions remain downloadable
            with their own audit trail.
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

function FilePicker({
  label,
  hint,
  required,
  file,
  inputRef,
  accept,
  onPick,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  file: File | null;
  inputRef: React.RefObject<HTMLInputElement>;
  accept?: string;
  onPick: (file: File | null) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-ink-2">
        {label}
        {required ? <span className="ml-0.5 text-danger">*</span> : null}
      </span>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex items-center gap-2 rounded-lg border border-dashed border-line bg-canvas px-3 py-2.5 text-left text-xs transition-colors hover:border-brand"
      >
        <Icons.Upload size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} className="shrink-0 text-ink-3" />
        <span className={cn('min-w-0 flex-1 truncate', file ? 'text-ink' : 'text-ink-3')}>
          {file ? file.name : 'Choose a file…'}
        </span>
        {file ? (
          <span
            role="button"
            tabIndex={0}
            onClick={(event) => {
              event.stopPropagation();
              onPick(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.stopPropagation();
                onPick(null);
              }
            }}
            className="shrink-0 text-ink-3 hover:text-danger"
          >
            <Icons.X size={14} strokeWidth={2} />
          </span>
        ) : null}
      </button>
      {hint ? <p className="text-xs text-ink-3">{hint}</p> : null}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(event) => onPick(event.target.files?.[0] ?? null)}
      />
    </div>
  );
}

/** W-12 Publications tab (§11). */
export function PublicationsTab({
  recordId,
  applicantId,
  autoOpen,
  onAutoOpened,
}: {
  recordId: string;
  applicantId: string;
  autoOpen?: string | null;
  onAutoOpened?: () => void;
}) {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const [addOpen, setAddOpen] = useState(false);

  useAutoOpen(
    autoOpen,
    {
      publication: () => setAddOpen(true),
      'publication:magazine': () => setAddOpen(true),
      'publication:enews': () => setAddOpen(true),
    },
    onAutoOpened,
  );

  const { data: publications, isLoading } = useQuery({
    queryKey: queryKeys.publications(recordId),
    queryFn: ({ signal }) => api.get<PublicationRow[]>('/publications', { recordId }, signal),
  });

  if (isLoading) return <div className="skeleton h-32" />;

  return (
    <div className="space-y-4">
      <CardHeader
        title="Publications"
        subtitle="Articles, magazine features, e-news and press coverage."
        icon={Icons.Newspaper}
        action={
          can('publications:create') ? (
            <Button size="sm" variant="primary" icon={Icons.Plus} onClick={() => setAddOpen(true)}>
              Add publication
            </Button>
          ) : null
        }
      />

      {(publications?.length ?? 0) === 0 ? (
        <EmptyState
          icon={Icons.Newspaper}
          title="Nothing published yet"
          description="Record where this achievement appeared — everything stays attached to the profile permanently."
        />
      ) : (
        <ul className="space-y-2">
          {publications?.map((publication) => (
            <li key={publication.id} className="rounded-lg border border-line p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{publication.title}</p>
                  <p className="text-[10px] text-ink-3">
                    {humanise(publication.kind)}
                    {publication.magazineName ? ` · ${publication.magazineName}` : ''}
                    {publication.pageNumber ? `, p.${publication.pageNumber}` : ''}
                    {publication.publishedOn ? ` · ${formatDate(publication.publishedOn)}` : ''}
                  </p>
                </div>
                <Chip tone="purple">{humanise(publication.kind)}</Chip>
              </div>

              {publication.url ? (
                <a
                  href={publication.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-brand hover:underline"
                >
                  <Icons.Globe size={11} strokeWidth={ICON_STROKE} />
                  View published article
                </a>
              ) : null}

              {publication.notes ? (
                <p className="mt-1.5 text-[11px] text-ink-2">{publication.notes}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {addOpen ? (
        <AddPublicationDialog
          recordId={recordId}
          onClose={() => setAddOpen(false)}
          onSaved={() => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.publications(recordId) });
            void queryClient.invalidateQueries({ queryKey: queryKeys.applicant(applicantId) });
            void queryClient.invalidateQueries({ queryKey: queryKeys.recordTimeline(recordId) });
          }}
        />
      ) : null}
    </div>
  );
}

function AddPublicationDialog({
  recordId,
  onClose,
  onSaved,
}: {
  recordId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<string>(PUBLICATION_KIND.MAGAZINE);
  const [title, setTitle] = useState('');
  const [magazineName, setMagazineName] = useState('');
  const [pageNumber, setPageNumber] = useState('');
  const [url, setUrl] = useState('');
  const [publishedOn, setPublishedOn] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const fileKey = file ? await uploadFile(file, 'publication', recordId) : undefined;
      await api.post('/publications', {
        recordId,
        kind,
        title,
        magazineName: magazineName || undefined,
        pageNumber: pageNumber || undefined,
        url: url || undefined,
        fileKey,
        publishedOn: publishedOn || undefined,
        notes: notes || undefined,
      });
      toast.success('Publication added');
      onClose();
      onSaved();
    } catch (error: unknown) {
      toast.error(error instanceof ApiError ? error.message : 'Could not save the publication');
    } finally {
      setBusy(false);
    }
  }

  const isMagazine = kind === PUBLICATION_KIND.MAGAZINE;

  return (
    <Dialog
      open
      onOpenChange={onClose}
      title="Add publication"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            // The API requires either a link or a file — enforce it here too so
            // the user finds out before submitting.
            disabled={!title.trim() || (!url && !file)}
            onClick={() => void submit()}
          >
            Add publication
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Select
          label="Type"
          value={kind}
          onChange={(event) => setKind(event.target.value)}
          options={Object.values(PUBLICATION_KIND).map((value) => ({
            value,
            label: humanise(value),
          }))}
        />
        <Input
          label="Title"
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          autoFocus
        />

        {isMagazine ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Magazine name"
              value={magazineName}
              onChange={(event) => setMagazineName(event.target.value)}
            />
            <Input
              label="Page number"
              value={pageNumber}
              onChange={(event) => setPageNumber(event.target.value)}
            />
          </div>
        ) : null}

        <Input
          label="Published on"
          type="date"
          value={publishedOn}
          onChange={(event) => setPublishedOn(event.target.value)}
        />
        <Input
          label="Link"
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://…"
          hint="A link or an uploaded file is required."
        />

        <FilePicker label="Upload the published file" file={file} inputRef={fileRef} onPick={setFile} />

        <Textarea
          label="Notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={2}
        />
      </div>
    </Dialog>
  );
}

/** W-13 Dispatch tab (§12, M-06). */
export function DispatchTab({
  recordId,
  applicantId,
  autoOpen,
  onAutoOpened,
}: {
  recordId: string;
  applicantId: string;
  autoOpen?: string | null;
  onAutoOpened?: () => void;
}) {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const [editOpen, setEditOpen] = useState(false);

  // The proof-of-delivery upload lives inside the same dispatch dialog.
  useAutoOpen(
    autoOpen,
    { dispatch: () => setEditOpen(true), 'dispatch:pod': () => setEditOpen(true) },
    onAutoOpened,
  );

  const { data: dispatches, isLoading } = useQuery({
    queryKey: queryKeys.dispatch(recordId),
    queryFn: ({ signal }) => api.get<DispatchRow[]>('/dispatch', { recordId }, signal),
  });

  const { data: lookups } = useQuery({
    queryKey: ['lookups'],
    queryFn: ({ signal }) => api.get<Lookups>('/lookups', undefined, signal),
    staleTime: 10 * 60_000,
  });

  if (isLoading) return <div className="skeleton h-32" />;

  const current = dispatches?.find((dispatch) => dispatch.isCurrent);

  return (
    <div className="space-y-4">
      <CardHeader
        title="Dispatch"
        subtitle={current ? `${current.courierPartner} · ${humanise(current.deliveryStatus)}` : 'Not dispatched'}
        icon={Icons.Truck}
        action={
          can('dispatch:create') ? (
            <Button size="sm" variant="primary" icon={Icons.Truck} onClick={() => setEditOpen(true)}>
              {current ? 'Update dispatch' : 'Add courier details'}
            </Button>
          ) : null
        }
      />

      {!dispatches || dispatches.length === 0 ? (
        <EmptyState
          icon={Icons.Package}
          title="Not dispatched yet"
          description="Add the courier and tracking number once the certificate is ready to send."
        />
      ) : (
        <ul className="space-y-2">
          {dispatches.map((dispatch) => (
            <li
              key={dispatch.id}
              className={cn(
                'rounded-lg border p-3',
                dispatch.isCurrent ? 'border-info-ring bg-info-tint/40' : 'border-line opacity-70',
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{dispatch.courierPartner}</p>
                  <p className="tabular text-[10px] text-ink-3">
                    {dispatch.trackingNumber ?? 'No tracking number'}
                  </p>
                </div>
                <Chip tone={dispatch.deliveryStatus === 'delivered' ? 'green' : 'blue'}>
                  {humanise(dispatch.deliveryStatus)}
                </Chip>
              </div>

              <dl className="mt-2">
                <DetailRow label="Dispatched" value={formatDate(dispatch.dispatchedOn)} />
                {dispatch.deliveredOn ? (
                  <DetailRow label="Delivered" value={formatDate(dispatch.deliveredOn)} />
                ) : null}
                {dispatch.contents ? (
                  <DetailRow label="Contents" value={dispatch.contents} />
                ) : null}
              </dl>

              {dispatch.trackingUrl ? (
                <a
                  href={dispatch.trackingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-brand hover:underline"
                >
                  <Icons.ScanBarcode size={11} strokeWidth={ICON_STROKE} />
                  Track this parcel
                </a>
              ) : null}

              {!dispatch.isCurrent ? (
                <p className="mt-1.5 text-[10px] italic text-ink-3">
                  Superseded — kept for the delivery history.
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {editOpen ? (
        <DispatchDialog
          recordId={recordId}
          current={current}
          couriers={lookups?.couriers ?? []}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.dispatch(recordId) });
            void queryClient.invalidateQueries({ queryKey: queryKeys.applicant(applicantId) });
            void queryClient.invalidateQueries({ queryKey: queryKeys.recordActions(recordId) });
            void queryClient.invalidateQueries({ queryKey: queryKeys.recordTimeline(recordId) });
          }}
        />
      ) : null}
    </div>
  );
}

function DispatchDialog({
  recordId,
  current,
  couriers,
  onClose,
  onSaved,
}: {
  recordId: string;
  current?: DispatchRow;
  couriers: Lookups['couriers'];
  onClose: () => void;
  onSaved: () => void;
}) {
  const podRef = useRef<HTMLInputElement>(null);
  const [courierPartner, setCourierPartner] = useState(current?.courierPartner ?? '');
  const [trackingNumber, setTrackingNumber] = useState(current?.trackingNumber ?? '');
  const [dispatchedOn, setDispatchedOn] = useState(
    current?.dispatchedOn?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
  );
  const [deliveryStatus, setDeliveryStatus] = useState<string>(
    current?.deliveryStatus ?? DELIVERY_STATUS.DISPATCHED,
  );
  const [deliveredOn, setDeliveredOn] = useState(current?.deliveredOn?.slice(0, 10) ?? '');
  const [contents, setContents] = useState(current?.contents ?? '');
  const [remarks, setRemarks] = useState(current?.remarks ?? '');
  const [pod, setPod] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const delivered = deliveryStatus === DELIVERY_STATUS.DELIVERED;

  async function submit() {
    setBusy(true);
    try {
      const podKey = pod ? await uploadFile(pod, 'pod', recordId) : undefined;
      await api.post('/dispatch', {
        recordId,
        courierPartner,
        trackingNumber: trackingNumber || undefined,
        dispatchedOn: dispatchedOn || undefined,
        deliveryStatus,
        deliveredOn: delivered ? deliveredOn || new Date().toISOString() : undefined,
        podKey,
        contents: contents || undefined,
        remarks: remarks || undefined,
        notifyApplicant: false,
      });
      toast.success('Dispatch updated');
      onClose();
      onSaved();
    } catch (error: unknown) {
      toast.error(error instanceof ApiError ? error.message : 'Could not save the dispatch');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={onClose}
      title={current ? 'Update dispatch' : 'Add courier details'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!courierPartner.trim()}
            onClick={() => void submit()}
          >
            Save dispatch
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Courier"
            required
            placeholder="Choose a courier"
            value={courierPartner}
            onChange={(event) => setCourierPartner(event.target.value)}
            options={couriers.map((courier) => ({ value: courier.name, label: courier.name }))}
          />
          <Input
            label="Tracking number"
            value={trackingNumber}
            onChange={(event) => setTrackingNumber(event.target.value)}
            hint="The tracking link is built automatically."
          />
          <Input
            label="Dispatch date"
            type="date"
            value={dispatchedOn}
            onChange={(event) => setDispatchedOn(event.target.value)}
          />
          <Select
            label="Delivery status"
            value={deliveryStatus}
            onChange={(event) => setDeliveryStatus(event.target.value)}
            options={Object.values(DELIVERY_STATUS).map((value) => ({
              value,
              label: humanise(value),
            }))}
          />
          {delivered ? (
            <Input
              label="Delivered on"
              type="date"
              value={deliveredOn}
              onChange={(event) => setDeliveredOn(event.target.value)}
            />
          ) : null}
        </div>

        <Input
          label="Items in parcel"
          value={contents}
          onChange={(event) => setContents(event.target.value)}
          placeholder="Certificate (hard copy) + magazine + medal"
        />

        {delivered ? (
          <FilePicker
            label="Proof of delivery"
            file={pod}
            inputRef={podRef}
            onPick={setPod}
            hint="The courier's POD scan or screenshot."
          />
        ) : null}

        <Textarea
          label="Remarks"
          value={remarks}
          onChange={(event) => setRemarks(event.target.value)}
          rows={2}
        />
      </div>
    </Dialog>
  );
}
