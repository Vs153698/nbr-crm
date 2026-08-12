import { EVIDENCE_KIND, EVIDENCE_KIND_LABELS } from '@nbr/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type DragEvent } from 'react';
import { toast } from 'sonner';
import { Chip } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { CardHeader, EmptyState } from '@/components/ui/Card';
import { FilePreviewSheet } from '@/components/ui/FilePreviewSheet';
import { Select } from '@/components/ui/Field';
import { useAuth } from '@/hooks/useAuth';
import { api, ApiError, hashFile, uploadToStorage } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { formatBytes, formatRelative } from '@/lib/format';
import { ICON_SIZE, ICON_STROKE, Icons } from '@/lib/icons';
import { queryKeys } from '@/lib/query-client';
import type { EvidenceItem } from '../types';
import { useAutoOpen } from '@/hooks/useAutoOpen';

interface UploadingFile {
  id: string;
  name: string;
  size: number;
  percent: number;
  error?: string;
}

/**
 * W-09 Evidence vault (§7, P1-12).
 *
 * Uploads go browser → object storage directly via a presigned URL; the API
 * only records metadata afterwards. That is what lets a 200 MB record video
 * upload without occupying an app worker for the duration.
 *
 * There is deliberately no delete control anywhere on this screen: the vault is
 * permanent by requirement, and the database enforces it independently.
 */
export function EvidenceTab({
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Evidence has no dialog — the equivalent is the file picker itself.
  useAutoOpen(autoOpen, { evidence: () => fileInputRef.current?.click() }, onAutoOpened);

  const [kind, setKind] = useState<string>(EVIDENCE_KIND.PHOTO);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState<UploadingFile[]>([]);
  const [previewing, setPreviewing] = useState<EvidenceItem | null>(null);

  const canUpload = can('evidence:create');

  const { data: files, isLoading } = useQuery({
    queryKey: queryKeys.evidence(recordId),
    queryFn: ({ signal }) => api.get<EvidenceItem[]>('/evidence', { recordId }, signal),
  });

  const downloadMutation = useMutation({
    mutationFn: (id: string) => api.get<{ url: string; fileName: string }>(`/evidence/${id}/download`),
    onSuccess: ({ url }) => {
      // A presigned URL is short-lived, so open it immediately rather than
      // rendering it into a link the user might click ten minutes later.
      window.open(url, '_blank', 'noopener,noreferrer');
    },
    onError: (error: unknown) => {
      toast.error(
        error instanceof ApiError && error.code === 'FORBIDDEN'
          ? 'You do not have permission to open identity documents'
          : 'Could not open that file',
      );
    },
  });

  async function uploadFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);

    for (const file of files) {
      const uploadId = crypto.randomUUID();
      setUploading((current) => [
        ...current,
        { id: uploadId, name: file.name, size: file.size, percent: 0 },
      ]);

      try {
        // 1 — ask for a presigned URL
        const presigned = await api.post<{
          uploadUrl: string;
          storageKey: string;
        }>('/uploads/presign', {
          scope: 'evidence',
          fileName: file.name,
          contentType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
          recordId,
        });

        // 2 — push the bytes straight to storage
        await uploadToStorage(presigned.uploadUrl, file, (percent) => {
          setUploading((current) =>
            current.map((item) => (item.id === uploadId ? { ...item, percent } : item)),
          );
        });

        // 3 — checksum makes a repeated upload of identical bytes idempotent
        const checksum = await hashFile(file);

        await api.post('/evidence/confirm', {
          recordId,
          kind,
          storageKey: presigned.storageKey,
          fileName: file.name,
          contentType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
          checksumSha256: checksum,
        });

        setUploading((current) => current.filter((item) => item.id !== uploadId));
        toast.success(`${file.name} attached`);

        void queryClient.invalidateQueries({ queryKey: queryKeys.evidence(recordId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.applicant(applicantId) });
        // Uploading evidence can unblock the has_evidence transition guard.
        // One prefix: the action panel, timeline and client-progress badge all
        // hang off it, so none of them can be left stale.
        void queryClient.invalidateQueries({ queryKey: queryKeys.record(recordId) });
      } catch (error: unknown) {
        const message =
          error instanceof ApiError ? error.message : 'Upload failed. Check your connection.';
        setUploading((current) =>
          current.map((item) => (item.id === uploadId ? { ...item, error: message } : item)),
        );
        toast.error(`${file.name} — ${message}`);
      }
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length > 0) void uploadFiles(event.dataTransfer.files);
  }

  return (
    <div className="space-y-4">
      {previewing ? (
        <FilePreviewSheet
          downloadPath={`/evidence/${previewing.id}/download`}
          fileName={previewing.fileName}
          subtitle={`${EVIDENCE_KIND_LABELS[previewing.kind as keyof typeof EVIDENCE_KIND_LABELS] ?? previewing.kind} · ${formatBytes(previewing.sizeBytes)}`}
          footerNote={
            previewing.isSensitive
              ? 'Opening an identity document is recorded in the audit log.'
              : undefined
          }
          onClose={() => setPreviewing(null)}
        />
      ) : null}

      <CardHeader
        title="Evidence vault"
        subtitle="Files are kept permanently and are never overwritten or deleted."
        icon={Icons.Upload}
        action={
          files && files.length > 0 ? (
            <Chip tone="slate">{files.length} file{files.length === 1 ? '' : 's'}</Chip>
          ) : null
        }
      />

      {canUpload ? (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <Select
              label="Evidence type"
              value={kind}
              onChange={(event) => setKind(event.target.value)}
              options={Object.values(EVIDENCE_KIND).map((value) => ({
                value,
                label: EVIDENCE_KIND_LABELS[value],
              }))}
              containerClassName="w-52"
            />
            <Button
              variant="secondary"
              icon={Icons.Upload}
              onClick={() => fileInputRef.current?.click()}
            >
              Browse files
            </Button>
          </div>

          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className={cn(
              'rounded-card border-2 border-dashed p-8 text-center transition-colors',
              dragging ? 'border-brand bg-brand-tint' : 'border-line bg-canvas',
            )}
          >
            <Icons.Upload
              size={22}
              strokeWidth={ICON_STROKE}
              className={cn('mx-auto mb-2', dragging ? 'text-brand' : 'text-ink-4')}
            />
            <p className="text-sm font-medium text-ink">
              Drag &amp; drop files here, or{' '}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-brand hover:underline"
              >
                browse
              </button>
            </p>
            <p className="mt-1 text-[11px] text-ink-3">
              Photos, videos and PDFs · up to 500 MB each · uploaded directly to secure storage
            </p>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                if (event.target.files) void uploadFiles(event.target.files);
                event.target.value = '';
              }}
            />
          </div>
        </>
      ) : null}

      {/* In-flight uploads with real progress */}
      {uploading.length > 0 ? (
        <ul className="space-y-2">
          {uploading.map((item) => (
            <li key={item.id} className="rounded-lg border border-line bg-white p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">
                  {item.name}
                </span>
                <span className="tabular shrink-0 text-[11px] text-ink-3">
                  {item.error ? 'Failed' : `${item.percent}%`}
                </span>
              </div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-slate2-tint">
                <div
                  className={cn('h-full transition-all', item.error ? 'bg-danger' : 'bg-brand')}
                  style={{ width: `${item.error ? 100 : item.percent}%` }}
                />
              </div>
              {item.error ? <p className="mt-1 text-[11px] text-danger">{item.error}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {/* Stored evidence */}
      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((index) => (
            <div key={index} className="skeleton h-14" />
          ))}
        </div>
      ) : (files?.length ?? 0) === 0 ? (
        <EmptyState
          icon={Icons.Inbox}
          title="No evidence uploaded yet"
          description="Ask the applicant for video or photos, or upload on their behalf."
        />
      ) : (
        <ul className="space-y-2">
          {files?.map((file) => (
            <li
              key={file.id}
              className="flex items-center gap-3 rounded-lg border border-line bg-white p-3 transition-colors hover:border-ink-4/40"
            >
              <span
                className={cn(
                  'grid h-9 w-9 shrink-0 place-items-center rounded-lg',
                  file.isSensitive ? 'bg-danger-tint text-danger' : 'bg-slate2-tint text-ink-2',
                )}
              >
                {file.contentType.startsWith('video') ? (
                  <Icons.PlayCircle size={ICON_SIZE.md} strokeWidth={ICON_STROKE} />
                ) : file.contentType.startsWith('image') ? (
                  <Icons.Eye size={ICON_SIZE.md} strokeWidth={ICON_STROKE} />
                ) : (
                  <Icons.FileText size={ICON_SIZE.md} strokeWidth={ICON_STROKE} />
                )}
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-ink">{file.fileName}</p>
                <p className="text-[10px] text-ink-3">
                  {EVIDENCE_KIND_LABELS[file.kind as keyof typeof EVIDENCE_KIND_LABELS] ?? file.kind}
                  {' · '}
                  {formatBytes(file.sizeBytes)}
                  {' · '}
                  {file.uploadedByName ?? 'Unknown'}
                  {' · '}
                  {formatRelative(file.createdAt)}
                </p>
              </div>

              {file.isSensitive ? (
                <Chip tone="red">
                  <Icons.Shield size={10} strokeWidth={2} /> Sensitive
                </Chip>
              ) : null}

              {/* Preview first, download second: checking whether a scan is
                  legible is the common case, and it should not require a round
                  trip through the downloads folder. */}
              <Button
                size="sm"
                variant="ghost"
                icon={Icons.Eye}
                onClick={() => setPreviewing(file)}
              >
                Preview
              </Button>

              <Button
                size="sm"
                variant="ghost"
                icon={Icons.Download}
                loading={downloadMutation.isPending && downloadMutation.variables === file.id}
                onClick={() => downloadMutation.mutate(file.id)}
              >
                Download
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
