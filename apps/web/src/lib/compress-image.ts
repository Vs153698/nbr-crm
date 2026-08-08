/**
 * Client-side image compression for uploads.
 *
 * Onboarding documents are overwhelmingly phone photos of paperwork — a PAN
 * card shot on a 48 MP camera arrives as 8 MB of JPEG carrying no more legible
 * detail than 300 KB of WebP. Re-encoding in the browser is what keeps the
 * bucket from filling with that, and it has to happen here: uploads go straight
 * from the browser to storage, so the server never sees the bytes in time to
 * shrink them.
 *
 * Three rules keep this from ever making things worse:
 *  - only real raster images are touched; a PDF or a Word file is passed
 *    through untouched, because nothing useful can be done to one here;
 *  - the result is used only if it is actually smaller than the original;
 *  - any failure — an unsupported codec, a decode error, no canvas — returns
 *    the original file rather than blocking the upload.
 */

/** Formats a canvas can decode and re-encode without losing the document. */
const COMPRESSIBLE = /^image\/(jpeg|png|webp)$/;

/** Long edge, in pixels. Well past what any A4 scan needs to stay readable. */
const MAX_EDGE = 2200;

const QUALITY = 0.78;

/** Below this, re-encoding overhead tends to outweigh anything it saves. */
const MIN_BYTES_TO_BOTHER = 150 * 1024;

export interface CompressionResult {
  /** What to upload — the re-encoded file, or the original when untouched. */
  readonly file: File;
  /** What the user picked, for reporting the saving honestly. */
  readonly originalSizeBytes: number;
  readonly compressed: boolean;
}

export async function compressImage(file: File): Promise<CompressionResult> {
  const untouched: CompressionResult = {
    file,
    originalSizeBytes: file.size,
    compressed: false,
  };

  if (!COMPRESSIBLE.test(file.type)) return untouched;
  if (file.size < MIN_BYTES_TO_BOTHER) return untouched;
  if (typeof createImageBitmap !== 'function') return untouched;

  try {
    // `from-image` applies the EXIF rotation. Without it, a document
    // photographed in portrait is stored on its side — canvas drops the tag.
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });

    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) return untouched;

    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await toBlob(canvas, 'image/webp', QUALITY);
    // A browser without WebP encoding silently hands back a PNG, which is
    // routinely larger than the JPEG we started with — so compare, don't assume.
    if (!blob || blob.type !== 'image/webp' || blob.size >= file.size) return untouched;

    return {
      file: new File([blob], toWebpName(file.name), {
        type: 'image/webp',
        lastModified: file.lastModified,
      }),
      originalSizeBytes: file.size,
      compressed: true,
    };
  } catch {
    // A file that cannot be decoded is still a file the user meant to attach.
    return untouched;
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** `aadhaar-front.jpg` → `aadhaar-front.webp`, so the name matches the bytes. */
function toWebpName(fileName: string): string {
  return `${fileName.replace(/\.[^./\\]+$/, '')}.webp`;
}

/** "68% smaller" — the saving, or null when the file was stored as-is. */
export function compressionSaving(
  sizeBytes: number,
  originalSizeBytes: number | null | undefined,
): number | null {
  if (!originalSizeBytes || originalSizeBytes <= sizeBytes) return null;
  return Math.round(((originalSizeBytes - sizeBytes) / originalSizeBytes) * 100);
}
