import { useRef, useState, type DragEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  EMPLOYEE_DOCUMENT_KIND,
  EMPLOYEE_DOCUMENT_KIND_LABELS,
  type EmployeeDocumentKind,
} from '@nbr/shared';
import { Chip } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Select } from '@/components/ui/Field';
import { useAuth } from '@/hooks/useAuth';
import { api, ApiError, hashFile, uploadToStorage } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { compressImage, compressionSaving } from '@/lib/compress-image';
import { formatBytes, formatRelative } from '@/lib/format';
import { ICON_SIZE, ICON_STROKE, Icons } from '@/lib/icons';
import { FilePreviewSheet } from '@/components/ui/FilePreviewSheet';
import { employeeKeys, type EmployeeDocument } from './types';

interface UploadingFile {
  id: string;
  name: string;
  percent: number;
  /** Set once compression has run, so the saving can be shown as it uploads. */
  originalSizeBytes?: number;
  sizeBytes?: number;
  error?: string;
}

/**
 * The onboarding file — offer letter, ID proofs, certificates, contract.
 *
 * Several files at once is the normal case: onboarding paperwork arrives as a
 * batch, and asking someone to repeat a four-step upload eight times is how
 * half a joining file ends up never being attached.
 *
 * Images are re-encoded in the browser before the upload starts. It has to
 * happen here — the bytes go straight from the browser to storage and never
 * pass through the API — and it is where the saving is largest, because most of
 * these files are phone photos of A4 paper.
 */
export function OnboardingDocuments({ employeeId }: { employeeId: string }) {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [kind, setKind] = useState<EmployeeDocumentKind>(EMPLOYEE_DOCUMENT_KIND.OFFER_LETTER);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState<UploadingFile[]>([]);
  const [previewing, setPreviewing] = useState<EmployeeDocument | null>(null);
  const [removing, setRemoving] = useState<EmployeeDocument | null>(null);

  const canEdit = can('employees:edit');

  const { data: documents, isLoading } = useQuery({
    queryKey: employeeKeys.documents(employeeId),
    queryFn: ({ signal }) =>
      api.get<EmployeeDocument[]>(`/employees/${employeeId}/documents`, undefined, signal),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: employeeKeys.documents(employeeId) });
    void queryClient.invalidateQueries({ queryKey: employeeKeys.detail(employeeId) });
  };

  const remove = useMutation({
    mutationFn: (document: EmployeeDocument) =>
      api.delete(`/employees/${employeeId}/documents/${document.id}`),
    onSuccess: () => {
      toast.success('Document removed');
      setRemoving(null);
      invalidate();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not remove that document'),
  });

  async function uploadFiles(fileList: FileList | File[]) {
    for (const original of Array.from(fileList)) {
      const uploadId = crypto.randomUUID();
      setUploading((current) => [...current, { id: uploadId, name: original.name, percent: 0 }]);

      try {
        // 1 — shrink it, if it is an image and shrinking actually helps
        const { file, originalSizeBytes, compressed } = await compressImage(original);
        setUploading((current) =>
          current.map((item) =>
            item.id === uploadId
              ? { ...item, name: file.name, originalSizeBytes, sizeBytes: file.size }
              : item,
          ),
        );

        // 2 — ask for a presigned URL
        const presigned = await api.post<{ uploadUrl: string; storageKey: string }>(
          `/employees/${employeeId}/documents/presign`,
          {
            fileName: file.name,
            contentType: file.type || 'application/octet-stream',
            sizeBytes: file.size,
          },
        );

        // 3 — push the bytes straight to storage
        await uploadToStorage(presigned.uploadUrl, file, (percent) => {
          setUploading((current) =>
            current.map((item) => (item.id === uploadId ? { ...item, percent } : item)),
          );
        });

        // 4 — the checksum is what makes a re-upload of identical bytes a
        //     rejected duplicate rather than a second copy in the folder
        const checksum = await hashFile(file);

        await api.post(`/employees/${employeeId}/documents`, {
          kind,
          storageKey: presigned.storageKey,
          fileName: file.name,
          contentType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
          originalSizeBytes,
          checksumSha256: checksum,
        });

        setUploading((current) => current.filter((item) => item.id !== uploadId));

        const saving = compressed ? compressionSaving(file.size, originalSizeBytes) : null;
        toast.success(
          saving
            ? `${original.name} attached — compressed ${saving}%`
            : `${original.name} attached`,
        );
        invalidate();
      } catch (error: unknown) {
        const message =
          error instanceof ApiError ? error.message : 'Upload failed. Check your connection.';
        setUploading((current) =>
          current.map((item) => (item.id === uploadId ? { ...item, error: message } : item)),
        );
        toast.error(`${original.name} — ${message}`);
      }
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length > 0) void uploadFiles(event.dataTransfer.files);
  }

  return (
    <section className="space-y-3">
      {canEdit ? (
        <div className="space-y-3">
          {/*
            The hint sits under the row rather than under the Select.

            `items-end` aligns the bottom of each *field*, and a field with a
            hint is two lines taller than one without — so the button lined up
            with the bottom of the hint text and floated well below the control
            it belongs beside. Moving the hint out makes both children the same
            height, which is what the alignment was assuming all along. It reads
            better there too: it describes the whole batch, not the dropdown.
          */}
          <div className="flex flex-wrap items-end gap-3">
            <Select
              label="Document type"
              value={kind}
              onChange={(event) => setKind(event.target.value as EmployeeDocumentKind)}
              options={Object.values(EMPLOYEE_DOCUMENT_KIND).map((value) => ({
                value,
                label: EMPLOYEE_DOCUMENT_KIND_LABELS[value],
              }))}
              containerClassName="w-56"
            />
            <Button
              variant="secondary"
              icon={Icons.Upload}
              onClick={() => fileInputRef.current?.click()}
            >
              Browse files
            </Button>
          </div>
          <p className="-mt-1 text-xs text-ink-3">Applies to every file in this batch.</p>

          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className={cn(
              'rounded-card border-2 border-dashed px-6 py-7 text-center transition-colors',
              dragging ? 'border-brand bg-brand-tint' : 'border-line bg-canvas',
            )}
          >
            <Icons.Upload
              size={22}
              strokeWidth={ICON_STROKE}
              className={cn('mx-auto mb-2', dragging ? 'text-brand' : 'text-ink-4')}
              aria-hidden
            />
            <p className="text-sm font-medium text-ink">
              Drop the joining paperwork here, or{' '}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-brand hover:underline"
              >
                browse
              </button>
            </p>
            <p className="mt-1 text-[11px] text-ink-3">
              Several files at once · PDF, Word, JPG, PNG · up to 20 MB each
            </p>
            <p className="mt-1 flex items-center justify-center gap-1 text-[11px] text-ok">
              <Icons.CheckCircle2 size={12} strokeWidth={2} aria-hidden />
              Photos and scans are compressed here before upload
            </p>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,application/pdf,.doc,.docx"
              className="hidden"
              onChange={(event) => {
                if (event.target.files) void uploadFiles(event.target.files);
                event.target.value = '';
              }}
            />
          </div>
        </div>
      ) : null}

      {uploading.length > 0 ? (
        <ul className="space-y-2">
          {uploading.map((item) => {
            const saving = compressionSaving(item.sizeBytes ?? 0, item.originalSizeBytes);
            return (
              <li key={item.id} className="rounded-lg border border-line bg-white p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">
                    {item.name}
                  </span>
                  {saving ? (
                    <span className="tabular shrink-0 text-[10px] font-semibold text-ok">
                      −{saving}%
                    </span>
                  ) : null}
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
            );
          })}
        </ul>
      ) : null}

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1].map((index) => (
            <div key={index} className="skeleton h-14" />
          ))}
        </div>
      ) : (documents?.length ?? 0) === 0 ? (
        <EmptyState
          icon={Icons.Inbox}
          title="No onboarding documents yet"
          description="Offer letter, ID proof, certificates and the signed contract belong here."
        />
      ) : (
        // A single column, not a grid: file names are long and the name is the
        // whole point of the row. Two columns truncated "aadhaar-front.pdf"
        // down to "aa…", which is no use to anyone looking for a document.
        <ul className="space-y-2">
          {documents!.map((document) => (
            <DocumentCard
              key={document.id}
              document={document}
              canEdit={canEdit}
              onPreview={() => setPreviewing(document)}
              onRemove={() => setRemoving(document)}
            />
          ))}
        </ul>
      )}

      {previewing ? (
        <FilePreviewSheet
          downloadPath={`/employees/${employeeId}/documents/${previewing.id}/download`}
          fileName={previewing.fileName}
          subtitle={
            <span className="flex flex-wrap items-center gap-x-1.5">
              <span>
                {EMPLOYEE_DOCUMENT_KIND_LABELS[
                  previewing.kind as keyof typeof EMPLOYEE_DOCUMENT_KIND_LABELS
                ] ?? previewing.kind}
              </span>
              <span aria-hidden>·</span>
              <span className="tabular">{formatBytes(previewing.sizeBytes)}</span>
              {compressionSaving(previewing.sizeBytes, previewing.originalSizeBytes) ? (
                <>
                  <span aria-hidden>·</span>
                  <span className="text-ok">
                    {compressionSaving(previewing.sizeBytes, previewing.originalSizeBytes)}% smaller
                    after compression
                  </span>
                </>
              ) : null}
            </span>
          }
          footerNote={
            previewing.isSensitive
              ? 'Opening this document is recorded in the audit log.'
              : undefined
          }
          onClose={() => setPreviewing(null)}
        />
      ) : null}

      {removing ? (
        <ConfirmDialog
          open
          onOpenChange={(next) => {
            if (!next) setRemoving(null);
          }}
          title={`Remove ${removing.fileName}?`}
          message="The file stops appearing on this profile. It is kept in storage and the removal is recorded, so it can still be produced if the deletion is later questioned."
          confirmLabel="Remove document"
          loading={remove.isPending}
          onConfirm={() => remove.mutate(removing)}
        />
      ) : null}
    </section>
  );
}

function DocumentCard({
  document,
  canEdit,
  onPreview,
  onRemove,
}: {
  document: EmployeeDocument;
  canEdit: boolean;
  onPreview: () => void;
  onRemove: () => void;
}) {
  const saving = compressionSaving(document.sizeBytes, document.originalSizeBytes);
  const isImage = document.contentType.startsWith('image/');

  return (
    <li className="group flex items-center gap-3 rounded-card border border-line bg-white p-3 transition-colors hover:border-brand-ring">
      <span
        className={cn(
          'grid h-9 w-9 shrink-0 place-items-center rounded-lg',
          document.isSensitive ? 'bg-danger-tint text-danger' : 'bg-brand-tint text-brand',
        )}
        aria-hidden
      >
        {isImage ? (
          <Icons.FileImage size={ICON_SIZE.md} strokeWidth={ICON_STROKE} />
        ) : (
          <Icons.FileText size={ICON_SIZE.md} strokeWidth={ICON_STROKE} />
        )}
      </span>

      <button
        type="button"
        onClick={onPreview}
        className="min-w-0 flex-1 text-left"
        aria-label={`Preview ${document.fileName}`}
      >
        <p className="truncate text-xs font-semibold text-ink group-hover:text-brand">
          {document.fileName}
        </p>
        <p className="mt-0.5 truncate text-[10px] text-ink-3">
          {EMPLOYEE_DOCUMENT_KIND_LABELS[
            document.kind as keyof typeof EMPLOYEE_DOCUMENT_KIND_LABELS
          ] ?? document.kind}
          {' · '}
          <span className="tabular">{formatBytes(document.sizeBytes)}</span>
          {saving ? <span className="text-ok"> · −{saving}%</span> : null}
          {' · '}
          {formatRelative(document.createdAt)}
        </p>
      </button>

      {document.isSensitive ? (
        <Chip tone="red">
          <Icons.Shield size={10} strokeWidth={2} /> ID
        </Chip>
      ) : null}

      <Button size="sm" variant="ghost" icon={Icons.Eye} onClick={onPreview}>
        Preview
      </Button>

      {canEdit ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${document.fileName}`}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-ink-4 transition-colors hover:bg-danger-tint hover:text-danger"
        >
          <Icons.Trash2 size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />
        </button>
      ) : null}
    </li>
  );
}
