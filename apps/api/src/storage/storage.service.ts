import { randomUUID } from 'node:crypto';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ValidationError } from '../common/errors';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

export type UploadScope =
  | 'evidence'
  | 'attachment'
  | 'certificate'
  | 'receipt'
  | 'invoice'
  | 'pod'
  | 'publication'
  | 'blacklist_document'
  | 'consent'
  | 'applicant_photo';

export interface PresignedUpload {
  readonly uploadUrl: string;
  readonly storageKey: string;
  readonly expiresInSeconds: number;
  readonly requiredHeaders: Record<string, string>;
}

/**
 * Object storage — Cloudflare R2 in production, MinIO locally.
 *
 * Uploads go **browser → storage directly** via a presigned URL. A 200 MB
 * record video never passes through the API, so a handful of concurrent
 * uploads cannot tie up app workers; the API only records metadata afterwards.
 *
 * Downloads are always short-lived presigned URLs. The bucket is private — there
 * is no public read path, which is what keeps applicant ID proofs out of reach
 * of anyone who guesses a URL.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;

  /**
   * MIME allow-list per scope. An allow-list rather than a deny-list because
   * new dangerous types appear faster than deny-lists get updated.
   */
  private static readonly ALLOWED_TYPES: Record<UploadScope, RegExp> = {
    evidence: /^(image\/(jpeg|png|webp|heic|heif)|video\/(mp4|quicktime|x-matroska|webm)|application\/pdf)$/,
    attachment: /^(image\/(jpeg|png|webp)|application\/(pdf|msword|vnd\.openxmlformats-officedocument\.[\w.]+)|text\/plain)$/,
    certificate: /^(application\/pdf|image\/(jpeg|png)|application\/(postscript|x-photoshop|vnd\.openxmlformats-officedocument\.wordprocessingml\.document)|image\/vnd\.adobe\.photoshop)$/,
    receipt: /^(image\/(jpeg|png|webp)|application\/pdf)$/,
    invoice: /^application\/pdf$/,
    pod: /^(image\/(jpeg|png|webp)|application\/pdf)$/,
    publication: /^(application\/pdf|image\/(jpeg|png|webp))$/,
    blacklist_document: /^(application\/pdf|image\/(jpeg|png|webp))$/,
    consent: /^(application\/pdf|image\/(jpeg|png|webp))$/,
    applicant_photo: /^image\/(jpeg|png|webp)$/,
  };

  /** Per-scope size ceilings, in MB. Videos need room; a photo does not. */
  private static readonly MAX_MB: Record<UploadScope, number> = {
    evidence: 500,
    attachment: 50,
    certificate: 25,
    receipt: 10,
    invoice: 10,
    pod: 10,
    publication: 100,
    blacklist_document: 25,
    consent: 25,
    applicant_photo: 5,
  };

  constructor(@Inject(ENV) private readonly env: Env) {
    this.client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    });
  }

  /**
   * Build a version-safe storage key.
   *
   * The UUID prefix is what implements the vault's "no overwriting" rule (§7):
   * uploading `certificate.pdf` twice produces two distinct objects, so the
   * earlier file physically cannot be replaced by the later one.
   */
  buildKey(scope: UploadScope, ownerId: string, fileName: string): string {
    const safeName = fileName
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9._-]/g, '-')
      .replace(/-+/g, '-')
      .slice(-80);

    const datePrefix = new Date().toISOString().slice(0, 7); // YYYY-MM
    return `${scope}/${datePrefix}/${ownerId}/${randomUUID()}-${safeName}`;
  }

  async presignUpload(params: {
    scope: UploadScope;
    ownerId: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
  }): Promise<PresignedUpload> {
    this.assertAcceptable(params.scope, params.contentType, params.sizeBytes);

    const storageKey = this.buildKey(params.scope, params.ownerId, params.fileName);

    const command = new PutObjectCommand({
      Bucket: this.env.S3_BUCKET,
      Key: storageKey,
      ContentType: params.contentType,
      // Signing the length pins the upload to the size we validated — without
      // it, a client could request a URL for 1 MB and push 5 GB through it.
      ContentLength: params.sizeBytes,
    });

    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: this.env.UPLOAD_PRESIGN_TTL_SECONDS,
    });

    return {
      uploadUrl,
      storageKey,
      expiresInSeconds: this.env.UPLOAD_PRESIGN_TTL_SECONDS,
      requiredHeaders: {
        'content-type': params.contentType,
        'content-length': String(params.sizeBytes),
      },
    };
  }

  /** Short-lived read URL. Never a permanent link — the bucket stays private. */
  async presignDownload(storageKey: string, downloadFileName?: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.env.S3_BUCKET,
      Key: storageKey,
      ...(downloadFileName
        ? { ResponseContentDisposition: `attachment; filename="${downloadFileName.replace(/"/g, '')}"` }
        : {}),
    });

    return getSignedUrl(this.client, command, {
      expiresIn: this.env.DOWNLOAD_PRESIGN_TTL_SECONDS,
    });
  }

  /**
   * Confirm the object actually landed, and that its real size and type match
   * what was declared. Without this, the metadata row is just the client's
   * word — a caller could declare "image/png, 2 MB" and upload something else.
   */
  async verifyUploaded(
    storageKey: string,
  ): Promise<{ exists: boolean; sizeBytes: number; contentType: string | null }> {
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.env.S3_BUCKET, Key: storageKey }),
      );
      return {
        exists: true,
        sizeBytes: head.ContentLength ?? 0,
        contentType: head.ContentType ?? null,
      };
    } catch (error: unknown) {
      this.logger.warn(
        `Upload verification failed for ${storageKey}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { exists: false, sizeBytes: 0, contentType: null };
    }
  }

  private assertAcceptable(scope: UploadScope, contentType: string, sizeBytes: number): void {
    const allowed = StorageService.ALLOWED_TYPES[scope];
    if (!allowed.test(contentType)) {
      throw new ValidationError({
        contentType: [`${contentType} files are not accepted here.`],
      });
    }

    const maxMb = Math.min(StorageService.MAX_MB[scope], this.env.MAX_UPLOAD_MB);
    if (sizeBytes > maxMb * 1024 * 1024) {
      throw new ValidationError({
        sizeBytes: [`File is too large. The limit for this upload is ${maxMb} MB.`],
      });
    }

    if (sizeBytes <= 0) {
      throw new ValidationError({ sizeBytes: ['That file appears to be empty.'] });
    }
  }

  /** Scopes whose contents are personal-sensitive and gated on `pii:reveal`. */
  static isSensitiveScope(scope: UploadScope): boolean {
    return scope === 'consent' || scope === 'blacklist_document';
  }
}
