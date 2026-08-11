import { ATTACHMENT_KIND } from '@nbr/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { CardHeader, EmptyState } from '@/components/ui/Card';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { FilePreviewSheet } from '@/components/ui/FilePreviewSheet';
import { Input, Select, Textarea } from '@/components/ui/Field';
import { RowActions } from '@/components/ui/RowActions';
import { useAuth } from '@/hooks/useAuth';
import { api, ApiError, uploadToStorage } from '@/lib/api-client';
import { formatDateTime, formatRelative, humanise } from '@/lib/format';
import { ICON_SIZE, ICON_STROKE, Icons } from '@/lib/icons';
import { queryKeys } from '@/lib/query-client';
import type { AttachmentItem } from '../types';

/** Human file size, for the row subtitle. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * W-18 Attachments (§16).
 *
 * The miscellaneous drawer: OCR copies, legal notices, correction letters,
 * anything that belongs to the applicant rather than to one stage of one
 * record. Deliberately keyed on the **applicant** — the master profile — so a
 * letter filed against last year's application is still in front of whoever
 * opens the file today, with the record it came from named on the row where
 * there is one.
 *
 * Removal is a withdrawal, not a destruction: the row and the stored object
 * survive, the file leaves the list and stops being downloadable, and who took
 * it away and why is on the timeline. Evidence files are a different thing
 * entirely and cannot be removed at all — a database trigger refuses.
 */
export function AttachmentsTab({
  applicantId,
  recordId,
}: {
  applicantId: string;
  /** Attaches new uploads to the open record where there is one. */
  recordId?: string;
}) {
  const queryClient = useQueryClient();
  const { can } = useAuth();

  const [previewing, setPreviewing] = useState<AttachmentItem | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<AttachmentItem | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.attachments(applicantId),
    queryFn: ({ signal }) => api.get<AttachmentItem[]>('/attachments', { applicantId }, signal),
  });

  const removeMutation = useMutation({
    mutationFn: (target: AttachmentItem) =>
      api.post(`/attachments/${target.id}/remove`, {
        reason: 'Removed by staff from the applicant profile',
      }),
    onSuccess: () => {
      toast.success('Attachment removed', {
        description: 'It stays on the audit trail with who removed it.',
      });
      setRemoveTarget(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.attachments(applicantId) });
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not remove the attachment'),
  });

  async function download(file: AttachmentItem) {
    try {
      // Fetched and opened in one gesture — the signature is short-lived, and a
      // link left on the page is a broken one by the time anyone clicks it.
      const signed = await api.get<{ url: string }>(`/attachments/${file.id}/download`);
      window.open(signed.url, '_blank', 'noopener,noreferrer');
    } catch (error: unknown) {
      toast.error(error instanceof ApiError ? error.message : 'Could not open that file');
    }
  }

  const canUpload = can('evidence:create');
  const canRemove = can('evidence:delete');

  return (
    <div className="space-y-4">
      <CardHeader
        title="Attachments"
        subtitle="Files held against this applicant, across every record on the profile."
        icon={Icons.FilePlus2}
        action={
          canUpload ? (
            <Button size="sm" variant="primary" icon={Icons.Upload} onClick={() => setUploadOpen(true)}>
              Upload attachment
            </Button>
          ) : null
        }
      />

      {isLoading ? (
        <div className="skeleton h-24" />
      ) : (data?.length ?? 0) === 0 ? (
        <EmptyState
          icon={Icons.FileText}
          title="No attachments"
          description="OCR copies, legal notices, correction letters and other miscellaneous files live here."
          action={
            canUpload ? (
              <Button variant="primary" icon={Icons.Upload} onClick={() => setUploadOpen(true)}>
                Upload attachment
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="space-y-2">
          {data?.map((file) => (
            <li
              key={file.id}
              className="flex items-center gap-3 rounded-lg border border-line p-3 transition-colors hover:border-brand-ring"
            >
              <Icons.FileText
                size={ICON_SIZE.md}
                strokeWidth={ICON_STROKE}
                className="shrink-0 text-ink-3"
              />

              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-ink">{file.fileName}</p>
                {/* Name, who put it here and when — the three things asked for,
                    plus the record it belongs to where that is not the whole
                    profile. */}
                <p className="text-[10px] text-ink-3">
                  {humanise(file.kind)} · {formatBytes(file.sizeBytes)} · uploaded by{' '}
                  {file.uploadedByName ?? 'unknown'} ·{' '}
                  <span title={formatDateTime(file.createdAt)}>
                    {formatRelative(file.createdAt)}
                  </span>
                  {file.recordCode ? ` · ${file.recordCode}` : ''}
                </p>
                {file.description ? (
                  <p className="mt-0.5 truncate text-[10px] text-ink-2">{file.description}</p>
                ) : null}
              </div>

              <Button size="sm" variant="ghost" icon={Icons.Eye} onClick={() => setPreviewing(file)}>
                Preview
              </Button>

              <RowActions
                label={file.fileName}
                actions={[
                  {
                    id: 'download',
                    label: 'Download',
                    icon: Icons.Download,
                    onSelect: () => void download(file),
                  },
                  {
                    id: 'remove',
                    label: 'Remove attachment',
                    icon: Icons.Trash2,
                    danger: true,
                    disabled: !canRemove,
                    disabledReason: 'You do not have permission to remove attachments.',
                    onSelect: () => setRemoveTarget(file),
                  },
                ]}
              />
            </li>
          ))}
        </ul>
      )}

      {previewing ? (
        <FilePreviewSheet
          downloadPath={`/attachments/${previewing.id}/download`}
          fileName={previewing.fileName}
          subtitle={`${humanise(previewing.kind)} · uploaded by ${previewing.uploadedByName ?? 'unknown'} · ${formatDateTime(previewing.createdAt)}`}
          onClose={() => setPreviewing(null)}
        />
      ) : null}

      {uploadOpen ? (
        <UploadAttachmentDialog
          applicantId={applicantId}
          recordId={recordId}
          onClose={() => setUploadOpen(false)}
          onSaved={() =>
            void queryClient.invalidateQueries({ queryKey: queryKeys.attachments(applicantId) })
          }
        />
      ) : null}

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title="Remove this attachment?"
        message={
          <>
            <strong>{removeTarget?.fileName}</strong> will stop appearing on this profile and can no
            longer be downloaded. It is not destroyed — the audit trail keeps a record of the file
            and of your removing it.
          </>
        }
        confirmLabel="Remove"
        variant="danger"
        loading={removeMutation.isPending}
        onConfirm={() => removeTarget && removeMutation.mutate(removeTarget)}
      />
    </div>
  );
}

/**
 * Upload one file against the applicant.
 *
 * Three steps, same as every other upload here: ask for a presigned URL, PUT
 * the bytes straight to storage, then tell the API it landed. The bytes never
 * pass through an app worker, so a large scan cannot tie up a request handler.
 */
function UploadAttachmentDialog({
  applicantId,
  recordId,
  onClose,
  onSaved,
}: {
  applicantId: string;
  recordId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<string>(ATTACHMENT_KIND.MISC);
  const [description, setDescription] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Choose a file first');

      const presigned = await api.post<{ uploadUrl: string; storageKey: string }>(
        '/uploads/presign',
        {
          scope: 'attachment',
          fileName: file.name,
          contentType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
          applicantId,
          ...(recordId ? { recordId } : {}),
        },
      );

      await uploadToStorage(presigned.uploadUrl, file);

      return api.post<{ id: string }>('/attachments/confirm', {
        applicantId,
        ...(recordId ? { recordId } : {}),
        kind,
        storageKey: presigned.storageKey,
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        ...(description.trim() ? { description: description.trim() } : {}),
      });
    },
    onSuccess: () => {
      toast.success('Attachment uploaded');
      onSaved();
      onClose();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not upload that file'),
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Upload attachment"
      description="Held against the applicant, so it stays with them across every record."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={Icons.Upload}
            disabled={!file}
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            Upload
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <Input
            ref={inputRef}
            label="File"
            required
            type="file"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          {file ? (
            <p className="mt-1 text-[11px] text-ink-3">
              {file.name} · {formatBytes(file.size)}
            </p>
          ) : null}
        </div>

        <Select
          label="Type"
          hint="What kind of document this is. Used to group the list."
          value={kind}
          onChange={(event) => setKind(event.target.value)}
          options={Object.values(ATTACHMENT_KIND).map((value) => ({
            value,
            label: humanise(value),
          }))}
        />

        <Textarea
          label="Description"
          hint="Optional. Why this file is on the profile — the next person will thank you."
          rows={2}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>
    </Dialog>
  );
}
