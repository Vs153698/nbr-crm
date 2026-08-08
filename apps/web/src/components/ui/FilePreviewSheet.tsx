import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { api, ApiError } from '@/lib/api-client';
import { ICON_STROKE, Icons } from '@/lib/icons';

export interface SignedFile {
  url: string;
  fileName: string;
  contentType: string;
}

/**
 * Look at a stored file without leaving the screen.
 *
 * One sheet for every kind of document the CRM holds — evidence, applicant
 * attachments, employee onboarding files — because "can I just see it?" is the
 * same question in each case and the answer used to be "download it, find it in
 * your downloads folder, open it, come back". For an operator checking whether a
 * scan is legible before approving, that round trip is the whole task.
 *
 * The signed URL is fetched per open and never cached: a stale one is a broken
 * frame, and a cached one is a link that outlives the permission that granted it.
 */
export function FilePreviewSheet({
  /** Endpoint returning a signed URL. `?mode=inline` is appended. */
  downloadPath,
  fileName,
  subtitle,
  footerNote,
  onClose,
}: {
  downloadPath: string;
  fileName: string;
  subtitle?: React.ReactNode;
  /** Shown bottom-left — used to say when an access is being audited. */
  footerNote?: React.ReactNode;
  onClose: () => void;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['file-preview', downloadPath],
    queryFn: ({ signal }) => api.get<SignedFile>(downloadPath, { mode: 'inline' }, signal),
    gcTime: 0,
    staleTime: 0,
  });

  async function download() {
    try {
      const file = await api.get<SignedFile>(downloadPath);
      // Opened immediately rather than rendered into a link the user might
      // click ten minutes later, by which time the signature has expired.
      window.open(file.url, '_blank', 'noopener,noreferrer');
    } catch (error: unknown) {
      toast.error(
        error instanceof ApiError && error.code === 'FORBIDDEN'
          ? 'You do not have permission to open this file'
          : 'Could not open that file',
      );
    }
  }

  return (
    <Sheet
      open
      onOpenChange={onClose}
      size="lg"
      title={fileName}
      description={subtitle}
      footer={
        <>
          {footerNote ? <div className="mr-auto text-[11px] text-ink-3">{footerNote}</div> : null}
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button variant="secondary" icon={Icons.Download} onClick={() => void download()}>
            Download
          </Button>
        </>
      }
    >
      <div className="flex min-h-full flex-col bg-canvas p-4">
        <div className="flex min-h-[24rem] flex-1 items-center justify-center overflow-hidden rounded-card border border-line bg-white">
          {isLoading ? (
            <div className="skeleton h-full w-full" />
          ) : isError || !data ? (
            <Unavailable
              title="Could not load this file"
              description="The link may have expired, or you may not have permission to open it."
              onDownload={() => void download()}
            />
          ) : (
            <PreviewFrame file={data} onDownload={() => void download()} />
          )}
        </div>
      </div>
    </Sheet>
  );
}

/**
 * Only images, PDFs and video render in place.
 *
 * A Word document has no browser-native viewer, and an `<iframe>` pointed at one
 * shows a download prompt or a blank white box — worse than saying plainly that
 * it has to be opened elsewhere.
 */
function PreviewFrame({ file, onDownload }: { file: SignedFile; onDownload: () => void }) {
  if (file.contentType.startsWith('image/')) {
    return (
      <img
        src={file.url}
        alt={file.fileName}
        className="max-h-[70vh] w-full object-contain"
        loading="eager"
      />
    );
  }

  if (file.contentType.startsWith('video/')) {
    return <video src={file.url} controls className="max-h-[70vh] w-full" />;
  }

  if (file.contentType === 'application/pdf') {
    return <iframe src={file.url} title={file.fileName} className="h-[70vh] w-full border-0" />;
  }

  return (
    <Unavailable
      title="No in-app preview for this file type"
      description="Word documents and archives open in the application that handles them on your machine."
      onDownload={onDownload}
    />
  );
}

function Unavailable({
  title,
  description,
  onDownload,
}: {
  title: string;
  description: string;
  onDownload: () => void;
}) {
  return (
    <div className="px-6 py-12 text-center">
      <Icons.FileText
        size={26}
        strokeWidth={ICON_STROKE}
        className="mx-auto mb-2 text-ink-4"
        aria-hidden
      />
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-xs text-ink-3">{description}</p>
      <Button className="mt-3" size="sm" variant="secondary" icon={Icons.Download} onClick={onDownload}>
        Download to open
      </Button>
    </div>
  );
}
