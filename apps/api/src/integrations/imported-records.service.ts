import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { buildWhatsAppLink } from '@nbr/shared';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { ValidationError } from '../common/errors';
import { getActor } from '../common/request-context';
import type { Database } from '../database/client';
import { DB } from '../database/database.tokens';
import * as schema from '../database/schema';
import { MailService } from '../mail/mail.service';
import { LegacyPushService } from './legacy-push.service';

/** Read-only endpoint on the website carrying its offline certificates. */
const LEGACY_IMPORTED_PATH = '/api/crm-connector/imported-certificates';

const FETCH_TIMEOUT_MS = 20_000;
const PAGE_SIZE = 200;

interface LegacyImportedCertificate {
  readonly certificateNumber: string;
  readonly holderName: string;
  readonly recordTitle: string;
  readonly category: string | null;
  readonly issuedAt: string;
  readonly revoked: boolean;
  readonly revokeReason: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly awardeeSlug: string | null;
  readonly bio: string | null;
  readonly location: string | null;
  readonly achievementDate: string | null;
  readonly coverImageUrl: string | null;
  readonly extraData: Record<string, unknown>;
  readonly isPublished: boolean;
  readonly verifyUrl: string | null;
  readonly awardeeUrl: string | null;
}

export interface ImportedSyncResult {
  readonly imported: number;
  readonly updated: number;
  readonly total: number;
}

/** India's country code, prepended to the bare 10-digit numbers the site stores. */
const DEFAULT_DIAL_CODE = '91';
const NATIONAL_NUMBER_LENGTH = 10;

/**
 * Put a stored phone number into the form `wa.me` can route.
 *
 * The website records whatever was typed at import time, which for historic
 * records is almost always a bare Indian mobile. `wa.me/9876543210` opens a
 * chat with nobody, and does it silently — so a number that is exactly ten
 * digits gets the country code it was always assumed to have. Anything longer
 * already carries one and is passed through untouched.
 */
function toDialable(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length === NATIONAL_NUMBER_LENGTH ? `${DEFAULT_DIAL_CODE}${digits}` : digits;
}

/**
 * Mirrors the website's offline certificates into the CRM.
 *
 * Deliberately separate from `NbrWebsiteService`, which imports applications.
 * These records have no application, no applicant and no pipeline — sharing
 * that service would mean threading "unless it is an offline certificate"
 * through every branch of it.
 *
 * The website remains the source of truth: it issues, revokes and publicly
 * verifies. Nothing here is ever pushed back.
 */
@Injectable()
export class ImportedRecordsService {
  private readonly logger = new Logger(ImportedRecordsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly legacy: LegacyPushService,
    private readonly mail: MailService,
  ) {}

  private sign(body: string, secret: string): string {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
    return `t=${timestamp},v1=${signature}`;
  }

  /**
   * Pull the website's offline certificates.
   *
   * `since` narrows the request to what has been issued since we last agreed,
   * so routine runs stay small. Omit it to re-read everything — safe, because
   * rows are keyed on the certificate number and update in place.
   */
  async sync(options: { full?: boolean } = {}): Promise<ImportedSyncResult> {
    const config = await this.legacy.getConfig();
    if (!config.enabled) {
      throw new ValidationError({
        integration: ['Set the website URL and secret, and switch the integration on, first.'],
      });
    }

    const since = options.full ? null : await this.latestIssuedAt();

    const url = new URL(`${config.baseUrl}${LEGACY_IMPORTED_PATH}`);
    url.searchParams.set('limit', String(PAGE_SIZE));
    if (since) url.searchParams.set('since', since.toISOString());

    // The website signs GETs over the literal "{}" — no body to sign, and its
    // verifier falls back to an empty object.
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'X-NBR-Signature': this.sign('{}', config.secret) },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ValidationError({
        integration: [
          `The website returned HTTP ${response.status} for its imported certificates${detail ? `: ${detail.slice(0, 200)}` : ''}.`,
        ],
      });
    }

    const body = (await response.json()) as { data?: LegacyImportedCertificate[] };
    const rows = body.data ?? [];

    let imported = 0;
    let updated = 0;

    for (const row of rows) {
      const values = {
        certificateNumber: row.certificateNumber,
        holderName: row.holderName,
        recordTitle: row.recordTitle,
        category: row.category,
        issuedAt: new Date(row.issuedAt),
        email: row.email,
        phone: row.phone,
        location: row.location,
        bio: row.bio,
        achievementDate: row.achievementDate ? new Date(row.achievementDate) : null,
        coverImageUrl: row.coverImageUrl,
        extraData: row.extraData ?? {},
        awardeeSlug: row.awardeeSlug,
        verifyUrl: row.verifyUrl,
        awardeeUrl: row.awardeeUrl,
        isPublished: row.isPublished,
        revoked: row.revoked,
        revokeReason: row.revokeReason,
        syncedAt: new Date(),
      };

      // Keyed on the certificate number, so a re-run refreshes rather than
      // duplicates — including a revocation made on the website since.
      const result = await this.db
        .insert(schema.importedRecords)
        .values(values)
        .onConflictDoUpdate({
          target: schema.importedRecords.certificateNumber,
          set: values,
        })
        .returning({ createdAt: schema.importedRecords.createdAt });

      const created = result[0]?.createdAt;
      // A row whose createdAt is its syncedAt was inserted just now.
      if (created && Math.abs(created.getTime() - values.syncedAt.getTime()) < 2000) imported++;
      else updated++;
    }

    this.logger.log(`Imported records sync: ${imported} new, ${updated} refreshed`);
    return { imported, updated, total: rows.length };
  }

  /** Newest issue date we hold, so the next sync can ask only for what follows. */
  private async latestIssuedAt(): Promise<Date | null> {
    const [row] = await this.db
      .select({ issuedAt: schema.importedRecords.issuedAt })
      .from(schema.importedRecords)
      .orderBy(desc(schema.importedRecords.issuedAt))
      .limit(1);

    return row?.issuedAt ?? null;
  }

  async list(params: { search?: string; limit?: number; offset?: number }) {
    const limit = Math.min(params.limit ?? 50, 200);
    const offset = params.offset ?? 0;
    const term = params.search?.trim();

    const where = term
      ? or(
          ilike(schema.importedRecords.holderName, `%${term}%`),
          ilike(schema.importedRecords.recordTitle, `%${term}%`),
          ilike(schema.importedRecords.certificateNumber, `%${term}%`),
        )
      : undefined;

    const [rows, [count]] = await Promise.all([
      this.db
        .select()
        .from(schema.importedRecords)
        .where(where)
        .orderBy(desc(schema.importedRecords.issuedAt))
        .limit(limit)
        .offset(offset),
      this.db
        .select({ value: sql<number>`count(*)::int` })
        .from(schema.importedRecords)
        .where(where),
    ]);

    return { rows, total: count?.value ?? 0, limit, offset };
  }

  async get(id: string) {
    const [record] = await this.db
      .select()
      .from(schema.importedRecords)
      .where(eq(schema.importedRecords.id, id))
      .limit(1);

    if (!record) return null;

    const activity = await this.db
      .select()
      .from(schema.importedRecordActivity)
      .where(eq(schema.importedRecordActivity.importedRecordId, id))
      .orderBy(desc(schema.importedRecordActivity.createdAt));

    return { ...record, activity };
  }

  /**
   * Perform one of the four permitted actions and record it.
   *
   * Email is genuinely sent here rather than merely logged — an activity row
   * saying "email" that never left the building is worse than no row at all,
   * because the next operator reads it as "they have been contacted".
   *
   * A send failure still writes the row, marked `failed` with the reason. The
   * attempt is history and must survive; only the caller's success/failure
   * signal changes.
   */
  async addActivity(input: {
    importedRecordId: string;
    kind: 'email' | 'whatsapp' | 'note' | 'task';
    subject?: string;
    body: string;
    dueAt?: Date;
  }): Promise<{ id: string; status: string | null; whatsappUrl?: string }> {
    const [record] = await this.db
      .select()
      .from(schema.importedRecords)
      .where(eq(schema.importedRecords.id, input.importedRecordId))
      .limit(1);

    if (!record) {
      throw new ValidationError({ importedRecordId: ['That imported record no longer exists.'] });
    }

    let status: string | null = null;
    let error: string | null = null;
    let whatsappUrl: string | undefined;

    if (input.kind === 'email') {
      // Refuse rather than invent: many historic holders were catalogued with
      // no contact details at all, and the website is the only place that can
      // fix that.
      if (!record.email) {
        throw new ValidationError({
          body: ['This record has no email address on the website, so there is nowhere to send it.'],
        });
      }

      try {
        await this.mail.send({
          to: record.email,
          subject: input.subject?.trim() || `Regarding your record — ${record.certificateNumber}`,
          text: input.body,
        });
        status = 'sent';
      } catch (cause) {
        status = 'failed';
        error = cause instanceof Error ? cause.message : 'The mail server rejected the message.';
        this.logger.warn(`Imported-record email to ${record.email} failed: ${error}`);
      }
    }

    if (input.kind === 'whatsapp') {
      if (!record.phone) {
        throw new ValidationError({
          body: ['This record has no phone number on the website, so there is nowhere to send it.'],
        });
      }

      // No WhatsApp Business API is configured — the product defers it to a
      // later phase — so this hands back a click-to-chat link the operator
      // sends from their own WhatsApp, exactly as the applicant pipeline does.
      whatsappUrl = buildWhatsAppLink(toDialable(record.phone), input.body);
      status = 'logged';
    }

    const actor = getActor();

    const [row] = await this.db
      .insert(schema.importedRecordActivity)
      .values({
        importedRecordId: input.importedRecordId,
        kind: input.kind,
        subject: input.subject ?? null,
        body: input.body,
        dueAt: input.dueAt ?? null,
        status,
        error,
        createdByUserId: actor?.userId ?? null,
      })
      .returning({ id: schema.importedRecordActivity.id });

    if (status === 'failed') {
      throw new ValidationError({
        body: [`The message was recorded but could not be sent: ${error}`],
      });
    }

    return { id: row!.id, status, whatsappUrl };
  }

  async completeTask(activityId: string) {
    await this.db
      .update(schema.importedRecordActivity)
      .set({ completedAt: new Date() })
      .where(
        and(
          eq(schema.importedRecordActivity.id, activityId),
          eq(schema.importedRecordActivity.kind, 'task'),
        ),
      );
  }
}
