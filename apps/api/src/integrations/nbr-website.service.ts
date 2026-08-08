import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, createHmac } from 'node:crypto';

/**
 * Label for the shared-secret fingerprint. Must stay byte-identical to the
 * constant of the same name in the website's connector, or the two fingerprints
 * will differ for secrets that are in fact the same — which is precisely the
 * confusion this exists to remove.
 */
const SECRET_FINGERPRINT_LABEL = 'nbr-crm:secret-fingerprint:v1';
import {
  APPLICATION_SOURCE,
  ageInYears,
  CHILD_AGE_THRESHOLD_YEARS,
  CONSENT_NOTICE_VERSION,
  formatApplicantId,
  formatRecordId,
  INTEGRATION_IMPORT_STATUS,
  normaliseEmail,
  normaliseMobile,
  normaliseName,
  nbrWebhookApplicationSchema,
  PURPOSE_META,
  RECORD_STATUS,
  TIMELINE_EVENT,
  type NbrWebhookApplication,
  type RecordStatus,
} from '@nbr/shared';
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { AUDIT, AuditService } from '../audit/audit.service';
import { verifyWebhookSignature } from '../common/crypto';
import { UnauthorisedError, ValidationError } from '../common/errors';
import { INTEGRATION_ACTOR_NAME } from '../common/request-context';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import type { Database } from '../database/client';
import { DB } from '../database/database.tokens';
import * as schema from '../database/schema';
import { DuplicateService } from '../applicants/duplicate.service';
import { CacheService, CacheTag } from '../redis/cache.service';
import { StorageService } from '../storage/storage.service';
import { TimelineService } from '../timeline/timeline.service';
import { LegacyLifecycleService } from './legacy-lifecycle.service';

/**
 * Fingerprint of a snapshot's meaningful content.
 *
 * `externalUrl` and the timestamps the sender stamps on each delivery are
 * excluded — they change on every push without anything about the application
 * having changed, and including them would defeat duplicate detection entirely.
 */
/**
 * Plain-language cause for each verification failure, returned to the sender.
 *
 * Each one names the thing to go and check, because the four causes have four
 * completely different fixes and they are indistinguishable from a bare 401.
 */
const SIGNATURE_FAILURE_HINT: Readonly<Record<string, string>> = {
  missing_signature:
    'No X-NBR-Signature header arrived. Either the sender is not signing, or a proxy in front of this API is stripping the header.',
  malformed_signature:
    'The X-NBR-Signature header could not be parsed. It must read t=<unix seconds>,v1=<hex>.',
  timestamp_outside_tolerance:
    'The signature timestamp is outside the accepted window. The two servers’ clocks disagree by more than the tolerance — check NTP on both.',
  signature_mismatch:
    'The signature did not match. The shared secret differs between the two systems, or something rewrote the request body in transit.',
};

/**
 * Fields the website stores as unbounded TEXT but we store in a sized column.
 *
 * The columns are now generous — a record title holds 1000 characters — so in
 * practice nothing should reach this. It stays as a backstop because the
 * website's side genuinely has no limit, and the alternative when something
 * does exceed ours is losing the whole record over the tail of a display
 * string. The ellipsis makes any trim visible rather than looking like the
 * title simply ended oddly.
 */
const TRUNCATE_TO_FIT: ReadonlyArray<{ path: readonly string[]; max: number }> = [
  { path: ['achievement', 'recordTitle'], max: 1400 },
  { path: ['certificate', 'recordTitle'], max: 1400 },
  { path: ['achievement', 'location'], max: 250 },
  { path: ['applicant', 'fullName'], max: 150 },
];

function truncateOversizedFields(body: unknown): unknown {
  if (typeof body !== 'object' || body === null) return body;
  const clone = structuredClone(body) as Record<string, unknown>;

  for (const { path, max } of TRUNCATE_TO_FIT) {
    let parent: Record<string, unknown> | undefined = clone;
    for (const segment of path.slice(0, -1)) {
      const next: unknown = parent?.[segment];
      parent = typeof next === 'object' && next !== null ? (next as Record<string, unknown>) : undefined;
    }

    const leaf = path[path.length - 1]!;
    const value = parent?.[leaf];
    if (parent && typeof value === 'string' && value.length > max) {
      // A trailing ellipsis makes the truncation visible to whoever reads it,
      // rather than looking like the title simply ended oddly.
      parent[leaf] = `${value.slice(0, max - 1).trimEnd()}\u2026`;
    }
  }

  return clone;
}

/**
 * Validate an inbound snapshot, reporting a bad payload as the sender's problem.
 *
 * A raw `.parse()` throws ZodError, which the filter has no case for, so every
 * malformed payload came back as a 500 reading "Something went wrong on our
 * side" — pointing the operator at the wrong system entirely. A validation
 * failure is a 422 that names the offending field.
 */
function parseWebhookPayload(body: unknown): NbrWebhookApplication {
  const result = nbrWebhookApplicationSchema.safeParse(truncateOversizedFields(body));
  if (result.success) return result.data;

  const fields: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || 'payload';
    (fields[key] ??= []).push(issue.message);
  }

  throw new ValidationError(fields, 'The website sent a payload this system cannot accept.');
}

function snapshotHash(payload: NbrWebhookApplication): string {
  const significant = {
    externalId: payload.externalId,
    stage: payload.stage ?? null,
    applicant: payload.applicant,
    achievement: payload.achievement,
    evidence: payload.evidence.map((file) => file.url).sort(),
    payment: payload.payment ?? null,
    certificate: payload.certificate ?? null,
    dispatch: payload.dispatch ?? null,
    awardee: payload.awardee ?? null,
  };

  return createHash('sha256').update(JSON.stringify(significant)).digest('hex');
}

export interface SyncStatus {
  readonly lastWebhookAt: string | null;
  readonly pending: number;
  readonly importedToday: number;
  readonly failedToday: number;
  readonly pollingEnabled: boolean;
  readonly recentFailures: ReadonlyArray<{ externalId: string; error: string; at: string }>;
}

/**
 * Inbound integration with the existing NBR website (P2-14).
 *
 * When an application is approved in the current admin panel it POSTs here and
 * the CRM creates or merges the master applicant, opens a record with source
 * "Website", copies the evidence into the vault and notifies the assigned team
 * — no re-typing.
 *
 * The design points that matter:
 *
 *  • **Store first, process later.** The payload is persisted and acknowledged
 *    with 202 before any work happens. A slow import must never make the
 *    client's approval button hang, and a crash mid-import loses nothing.
 *  • **Idempotent by construction.** `(source, externalId)` is unique, so the
 *    same approval can arrive fifty times and produce exactly one record.
 *  • **Evidence is copied, not linked.** The files are pulled into our own
 *    vault so they survive the legacy system being retired.
 */
@Injectable()
export class NbrWebsiteService {
  private readonly logger = new Logger(NbrWebsiteService.name);
  private static readonly SOURCE = 'nbr_website';

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly duplicates: DuplicateService,
    private readonly storage: StorageService,
    private readonly timeline: TimelineService,
    private readonly audit: AuditService,
    private readonly cache: CacheService,
    private readonly lifecycle: LegacyLifecycleService,
  ) {}

  /**
   * Verify the signature and store the event.
   *
   * Signature verification happens before the body is even parsed as our
   * schema — an unsigned request should cost us nothing beyond an HMAC.
   */
  async receive(
    rawBody: string,
    signatureHeader: string | undefined,
    parsedBody: unknown,
  ): Promise<{ eventId: string; status: string; duplicate: boolean }> {
    const verification = verifyWebhookSignature({
      header: signatureHeader,
      rawBody,
      secret: this.env.NBR_WEBHOOK_SECRET,
      toleranceSeconds: this.env.NBR_WEBHOOK_TOLERANCE_SECONDS,
    });

    if (!verification.valid) {
      this.logger.warn(`Rejected webhook: ${verification.reason}`);

      await this.audit.record({
        action: AUDIT.WEBHOOK_REJECTED,
        entityType: 'integration',
        entityLabel: NbrWebsiteService.SOURCE,
        meta: { reason: verification.reason },
      });

      /**
       * The reason is returned, not just logged.
       *
       * Withholding it sounds safer but is not: an attacker learns the same
       * thing by experiment — resend with a fresh timestamp, and if it still
       * fails the signature is wrong — while the operator setting the
       * integration up cannot see the server log and is left guessing between a
       * mismatched secret, a drifting clock and a proxy stripping the header.
       * Stripe, GitHub and Shopify all name the reason for exactly this reason.
       *
       * Nothing here is derived from the secret; these four strings are the
       * complete vocabulary.
       */
      throw new UnauthorisedError(
        'WEBHOOK_SIGNATURE_INVALID',
        `${SIGNATURE_FAILURE_HINT[verification.reason ?? 'signature_mismatch']} (${verification.reason})`,
      );
    }

    const payload = parseWebhookPayload(parsedBody);

    /**
     * The event log is keyed by application *and content*, not by application
     * alone.
     *
     * The website sends a full snapshot on every lifecycle event — approval,
     * payment, certificate, dispatch — all carrying the same `externalId`.
     * Keying on the id by itself would mean only the first of those was ever
     * processed and the record would freeze at approval. Folding a content
     * hash into the key keeps genuine retries idempotent (identical bytes, same
     * key, dropped) while letting each real change through as its own event.
     */
    const contentHash = snapshotHash(payload);
    const eventKey = `${payload.externalId}#${contentHash.slice(0, 16)}`;

    const [event] = await this.db
      .insert(schema.integrationEvents)
      .values({
        source: NbrWebsiteService.SOURCE,
        externalId: eventKey,
        eventType: payload.stage ? `application.${payload.stage}` : 'application.approved',
        payload: payload as unknown as Record<string, unknown>,
        signatureValid: true,
        deliveryMode: 'webhook',
        status: INTEGRATION_IMPORT_STATUS.RECEIVED,
      })
      .onConflictDoNothing({
        target: [schema.integrationEvents.source, schema.integrationEvents.externalId],
      })
      .returning({ id: schema.integrationEvents.id });

    if (!event) {
      const [existing] = await this.db
        .select({ id: schema.integrationEvents.id, status: schema.integrationEvents.status })
        .from(schema.integrationEvents)
        .where(
          and(
            eq(schema.integrationEvents.source, NbrWebsiteService.SOURCE),
            eq(schema.integrationEvents.externalId, eventKey),
          ),
        )
        .limit(1);

      return {
        eventId: existing?.id ?? '',
        status: existing?.status ?? INTEGRATION_IMPORT_STATUS.DUPLICATE_SKIPPED,
        duplicate: true,
      };
    }

    await this.audit.record({
      action: AUDIT.WEBHOOK_RECEIVED,
      entityType: 'integration',
      entityId: event.id,
      entityLabel: payload.externalId,
    });

    // Processing is deliberately not awaited — the sender gets its 202 now.
    void this.processEvent(event.id);

    return { eventId: event.id, status: INTEGRATION_IMPORT_STATUS.RECEIVED, duplicate: false };
  }

  /**
   * Import one stored event.
   *
   * Runs outside the request, so every failure mode is recorded on the event
   * row rather than surfacing to the sender — which is what makes the queue
   * inspectable and replayable when a field mapping turns out to be wrong.
   */
  async processEvent(eventId: string): Promise<void> {
    try {
      await this.db
        .update(schema.integrationEvents)
        .set({
          status: INTEGRATION_IMPORT_STATUS.PROCESSING,
          attemptCount: sql`${schema.integrationEvents.attemptCount} + 1`,
        })
        .where(eq(schema.integrationEvents.id, eventId));

      const [event] = await this.db
        .select()
        .from(schema.integrationEvents)
        .where(eq(schema.integrationEvents.id, eventId))
        .limit(1);

      if (!event) return;

      const payload = nbrWebhookApplicationSchema.parse(event.payload);
      const result = await this.importApplication(payload);

      await this.db
        .update(schema.integrationEvents)
        .set({
          status: result.status,
          applicantId: result.applicantId,
          recordId: result.recordId,
          processedAt: new Date(),
          error: null,
        })
        .where(eq(schema.integrationEvents.id, eventId));

      await this.cache.invalidateTags(CacheTag.dashboard(), CacheTag.applicantList());
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Import ${eventId} failed: ${message}`);

      await this.db
        .update(schema.integrationEvents)
        .set({
          status: INTEGRATION_IMPORT_STATUS.FAILED,
          error: message,
          processedAt: new Date(),
        })
        .where(eq(schema.integrationEvents.id, eventId));
    }
  }

  private async importApplication(payload: NbrWebhookApplication): Promise<{
    status: string;
    applicantId: string | null;
    recordId: string | null;
  }> {
    // An application we have already imported takes the update path: merge the
    // new lifecycle state onto the record that exists rather than opening a
    // second one for the same achievement.
    const [known] = await this.db
      .select({
        recordId: schema.records.id,
        applicantId: schema.records.applicantId,
        status: schema.records.status,
      })
      .from(schema.records)
      .where(
        and(
          eq(schema.records.externalSource, NbrWebsiteService.SOURCE),
          eq(schema.records.externalId, payload.externalId),
        ),
      )
      .limit(1);

    if (known) return this.updateExisting(known, payload);

    // Reuse the same duplicate engine the manual form uses, so an applicant who
    // walked in last year and applies online this year lands on one profile.
    const matches = await this.duplicates.check({
      mobile: payload.applicant.mobile,
      email: payload.applicant.email,
      fullName: payload.applicant.fullName,
      dateOfBirth: payload.applicant.dateOfBirth,
    });

    const blacklisted = matches.find((match) => match.isBlacklisted);
    if (blacklisted) {
      // A blacklisted applicant's website submission is held for a human
      // rather than silently imported or silently dropped.
      this.logger.warn(
        `Import blocked — ${payload.externalId} matches blacklisted ${blacklisted.applicantCode}`,
      );
      await this.raiseOperatorAlert(
        'Blacklisted applicant submitted via website',
        `${payload.applicant.fullName} (${payload.externalId}) matches blacklisted ${blacklisted.applicantCode}.`,
        blacklisted.applicantId,
      );
      return {
        status: INTEGRATION_IMPORT_STATUS.BLOCKED_BLACKLIST,
        applicantId: blacklisted.applicantId,
        recordId: null,
      };
    }

    // A confident identifier match means the same person — merge onto them.
    const existing = matches.find((match) => match.confidence >= 0.99);

    const category = await this.resolveCategory(payload.achievement.category);

    const imported = await this.db.transaction(async (tx) => {
      let applicantId: string;
      let merged = false;

      if (existing) {
        applicantId = existing.applicantId;
        merged = true;
      } else {
        const seq = await nextSequence(tx, 'applicant_code_seq');
        const dob = payload.applicant.dateOfBirth;
        const isMinor = dob ? ageInYears(dob) < CHILD_AGE_THRESHOLD_YEARS : false;

        const [applicant] = await tx
          .insert(schema.applicants)
          .values({
            applicantCode: formatApplicantId(seq),
            fullName: payload.applicant.fullName,
            fatherName: payload.applicant.fatherName ?? null,
            motherName: payload.applicant.motherName ?? null,
            dateOfBirth: dob ? dob.toISOString().slice(0, 10) : null,
            gender: payload.applicant.gender ?? null,
            mobile: payload.applicant.mobile,
            mobileNormalised: normaliseMobile(payload.applicant.mobile),
            whatsapp: payload.applicant.whatsapp ?? null,
            email: payload.applicant.email,
            emailNormalised: normaliseEmail(payload.applicant.email),
            addressLine: payload.applicant.addressLine ?? null,
            city: payload.applicant.city ?? null,
            state: payload.applicant.state ?? null,
            country: payload.applicant.country ?? 'India',
            pincode: payload.applicant.pincode ?? null,
            nationality: payload.applicant.nationality ?? null,
            nameNormalised: normaliseName(payload.applicant.fullName),
            recordCount: 0,
            isMinorAtIntake: isMinor,
          })
          .returning({ id: schema.applicants.id });

        applicantId = applicant!.id;
      }

      const recordSeq = await nextSequence(tx, 'record_code_seq');
      const recordCode = formatRecordId(recordSeq);

      const [record] = await tx
        .insert(schema.records)
        .values({
          recordCode,
          applicantId,
          // Approved on the website, so it arrives ready for verification
          // rather than as a cold lead.
          status: RECORD_STATUS.APPLICATION_SUBMITTED,
          source: APPLICATION_SOURCE.NBR_WEBSITE_SYNC,
          applicationDate: payload.approvedAt ?? new Date(),
          externalId: payload.externalId,
          externalSource: NbrWebsiteService.SOURCE,
          internalRemarks: payload.externalUrl
            ? `Imported from the NBR website: ${payload.externalUrl}`
            : 'Imported from the NBR website.',
        })
        .returning({ id: schema.records.id });

      const recordId = record!.id;

      await tx.insert(schema.achievements).values({
        recordId,
        recordTitle: payload.achievement.recordTitle,
        categoryId: category.id,
        recordType: payload.achievement.recordType,
        description: payload.achievement.description ?? null,
        achievementDate: payload.achievement.achievementDate
          ? payload.achievement.achievementDate.toISOString().slice(0, 10)
          : null,
        location: payload.achievement.location ?? null,
        participantCount: payload.achievement.participantCount,
      });

      await tx
        .update(schema.applicants)
        .set({ recordCount: sql`${schema.applicants.recordCount} + 1` })
        .where(eq(schema.applicants.id, applicantId));

      // ── DPDP consent, carried across with its real timestamp ─────────────
      if (payload.consent && payload.consent.purposes.length > 0) {
        await tx.insert(schema.consentRecords).values(
          payload.consent.purposes.map((purpose) => ({
            applicantId,
            recordId,
            purpose,
            state: 'granted',
            lawfulBasis: PURPOSE_META[purpose].basis,
            noticeVersion: payload.consent!.noticeVersion ?? CONSENT_NOTICE_VERSION,
            channel: 'website_form',
            // The applicant's real acceptance time, not the import time —
            // otherwise the ledger would misstate when consent was given.
            occurredAt: payload.consent!.acceptedAt,
            ipAddress: payload.consent!.ipAddress ?? null,
            userAgent: payload.consent!.userAgent ?? null,
          })),
        );
      }

      const summaryParts = [
        `Imported from NBR website — "${payload.achievement.recordTitle}"`,
        merged ? '(added to existing profile)' : '',
      ].filter(Boolean);

      await this.timeline.writeMany(
        [
          {
            applicantId,
            recordId,
            eventType: TIMELINE_EVENT.RECORD_IMPORTED,
            summary: summaryParts.join(' '),
            meta: {
              externalId: payload.externalId,
              externalUrl: payload.externalUrl ?? null,
              merged,
              categoryMatched: category.matched,
            },
            actorKind: 'integration' as const,
            actorName: INTEGRATION_ACTOR_NAME,
          },
          ...(payload.consent
            ? [
                {
                  applicantId,
                  recordId,
                  eventType: TIMELINE_EVENT.CONSENT_RECORDED,
                  summary: `Consent captured on the website for ${payload.consent.purposes.length} purpose(s)`,
                  meta: { purposes: payload.consent.purposes },
                  actorKind: 'integration' as const,
                  actorName: INTEGRATION_ACTOR_NAME,
                },
              ]
            : []),
        ],
        tx,
      );

      await this.audit.record(
        {
          action: AUDIT.IMPORT_COMPLETED,
          entityType: 'record',
          entityId: recordId,
          entityLabel: `${recordCode} — ${payload.achievement.recordTitle}`,
          meta: { externalId: payload.externalId, merged },
        },
        tx,
      );

      // Everything the website already did to this application — payment,
      // certificate, courier — applied in the same transaction that created the
      // record, so a backfilled application arrives at its true stage rather
      // than at the start of the workflow.
      await this.lifecycle.apply(tx, {
        recordId,
        applicantId,
        currentStatus: RECORD_STATUS.APPLICATION_SUBMITTED,
        payload,
      });

      await this.lifecycle.upsertMirror(tx, {
        recordId,
        applicantId,
        payload,
        inboundHash: snapshotHash(payload),
      });

      return {
        status: merged ? INTEGRATION_IMPORT_STATUS.MERGED : INTEGRATION_IMPORT_STATUS.IMPORTED,
        applicantId,
        recordId,
        recordCode,
        categoryMatched: category.matched,
        categoryName: category.name,
      };
    });

    /**
     * Post-commit work.
     *
     * Both of these write rows that reference the record by foreign key, and
     * both run on a pooled connection rather than `tx` — so until the
     * transaction commits, the record they point at does not exist as far as
     * their connection is concerned. Running them inside the transaction meant
     * every import with an unrecognised category name died on
     * `notifications_record_id_records_id_fk` and rolled the whole thing back.
     */
    if (!imported.categoryMatched) {
      // Filed under "Other" and flagged, so it does not quietly distort the
      // category-wise report.
      await this.raiseOperatorAlert(
        'Imported record needs a category',
        `${imported.recordCode} arrived with category "${payload.achievement.category ?? '(none)'}", which does not match ours. It has been filed under ${imported.categoryName}.`,
        imported.applicantId,
        imported.recordId,
      );
    }

    // Not awaited — a large video must not hold the import open.
    void this.copyEvidence(payload, imported.applicantId, imported.recordId);

    return {
      status: imported.status,
      applicantId: imported.applicantId,
      recordId: imported.recordId,
    };
  }

  /**
   * Apply a snapshot to a record we already hold.
   *
   * Only the lifecycle blocks are merged. The applicant's own details and the
   * achievement text are left alone on purpose: once a record is in the CRM,
   * the verification team's corrections to a name or an approved description
   * are the authoritative version, and a later website snapshot carrying the
   * applicant's original wording must not quietly undo them.
   */
  private async updateExisting(
    known: { recordId: string; applicantId: string; status: string },
    payload: NbrWebhookApplication,
  ): Promise<{ status: string; applicantId: string | null; recordId: string | null }> {
    const inboundHash = snapshotHash(payload);

    const [mirror] = await this.db
      .select({ inboundHash: schema.legacyMirror.inboundHash })
      .from(schema.legacyMirror)
      .where(eq(schema.legacyMirror.recordId, known.recordId))
      .limit(1);

    // Byte-identical to what we last applied — a retry, not a change.
    if (mirror?.inboundHash === inboundHash) {
      return {
        status: INTEGRATION_IMPORT_STATUS.DUPLICATE_SKIPPED,
        applicantId: known.applicantId,
        recordId: known.recordId,
      };
    }

    await this.db.transaction(async (tx) => {
      await this.lifecycle.apply(tx, {
        recordId: known.recordId,
        applicantId: known.applicantId,
        currentStatus: known.status as RecordStatus,
        payload,
      });

      await this.lifecycle.upsertMirror(tx, {
        recordId: known.recordId,
        applicantId: known.applicantId,
        payload,
        inboundHash,
      });
    });

    // New evidence can appear at any point in the lifecycle — a proof of
    // delivery scan, a corrected ID document. Already-copied files are skipped
    // by the storage-key check inside copyEvidence.
    void this.copyEvidence(payload, known.applicantId, known.recordId);

    return {
      status: INTEGRATION_IMPORT_STATUS.MERGED,
      applicantId: known.applicantId,
      recordId: known.recordId,
    };
  }

  /**
   * Pull each evidence file into our own vault.
   *
   * Hot-linking would mean the evidence for a record disappears the day the
   * legacy site is retired — which is precisely when NBR would need it to
   * defend a record claim.
   */
  private async copyEvidence(
    payload: NbrWebhookApplication,
    applicantId: string,
    recordId: string,
  ): Promise<void> {
    for (const file of payload.evidence) {
      try {
        const fileName = file.fileName ?? file.url.split('/').pop() ?? 'evidence';

        // Snapshots repeat the whole evidence list on every push. Without this
        // check, a record that reaches delivery would hold five copies of the
        // same video — and we would have paid to download it five times.
        const [alreadyCopied] = await this.db
          .select({ id: schema.evidenceFiles.id })
          .from(schema.evidenceFiles)
          .where(
            and(
              eq(schema.evidenceFiles.recordId, recordId),
              eq(schema.evidenceFiles.fileName, fileName),
            ),
          )
          .limit(1);

        if (alreadyCopied) continue;

        const response = await fetch(file.url, { signal: AbortSignal.timeout(60_000) });
        if (!response.ok) throw new Error(`source returned ${response.status}`);

        const buffer = Buffer.from(await response.arrayBuffer());
        const contentType =
          file.contentType ?? response.headers.get('content-type') ?? 'application/octet-stream';

        const storageKey = this.storage.buildKey('evidence', recordId, fileName);
        await this.storage.putObject(storageKey, buffer, contentType);

        await this.db.insert(schema.evidenceFiles).values({
          recordId,
          applicantId,
          kind: file.kind ?? 'document',
          storageKey,
          fileName,
          contentType,
          sizeBytes: buffer.length,
          description: 'Imported from the NBR website',
          isSensitive: file.kind === 'id_proof' || file.kind === 'consent_form',
          scanStatus: 'pending',
        });

        await this.db
          .update(schema.records)
          .set({ evidenceCount: sql`${schema.records.evidenceCount} + 1` })
          .where(eq(schema.records.id, recordId));
      } catch (error: unknown) {
        // One unreachable file must not abandon the rest, and the record is
        // already imported — this is a gap to flag, not a failure to retry.
        this.logger.warn(
          `Evidence copy failed for ${file.url}: ${error instanceof Error ? error.message : String(error)}`,
        );
        await this.raiseOperatorAlert(
          'Evidence could not be imported',
          `A file from the NBR website could not be copied: ${file.url}. Ask the website team to re-share it.`,
          applicantId,
          recordId,
        );
      }
    }
  }

  /** Map the website's free-text category name onto ours. */
  private async resolveCategory(
    name: string | undefined,
  ): Promise<{ id: string; name: string; matched: boolean }> {
    if (name) {
      const [match] = await this.db
        .select({ id: schema.categories.id, name: schema.categories.name })
        .from(schema.categories)
        // Case- and whitespace-insensitive, because "physical fitness" and
        // "Physical Fitness" are obviously the same category to a human.
        .where(sql`lower(trim(${schema.categories.name})) = lower(trim(${name}))`)
        .limit(1);

      if (match) return { ...match, matched: true };
    }

    const [fallback] = await this.db
      .select({ id: schema.categories.id, name: schema.categories.name })
      .from(schema.categories)
      .where(eq(schema.categories.slug, 'other'))
      .limit(1);

    if (fallback) return { ...fallback, matched: false };

    const [any] = await this.db
      .select({ id: schema.categories.id, name: schema.categories.name })
      .from(schema.categories)
      .limit(1);

    return { id: any!.id, name: any!.name, matched: false };
  }

  private async raiseOperatorAlert(
    title: string,
    body: string,
    applicantId?: string | null,
    recordId?: string | null,
  ): Promise<void> {
    await this.db
      .insert(schema.notifications)
      .values({
        // Broadcast — anyone with the integrations permission should see it.
        userId: null,
        kind: 'integration_attention',
        title,
        body,
        severity: 'warning',
        applicantId: applicantId ?? null,
        recordId: recordId ?? null,
        link: applicantId ? `/applicants/${applicantId}` : '/admin/integrations',
        dedupeKey: `integration_attention:${recordId ?? applicantId ?? title}`,
      })
      .onConflictDoNothing();
  }

  /**
   * Fingerprint of the secret this API verifies against, plus its own clock.
   *
   * The counterpart shows the same fingerprint for the secret it signs with, so
   * "are the two secrets the same?" becomes a two-value comparison instead of a
   * guess. It is `HMAC-SHA256(secret, label)` truncated to 8 hex characters —
   * one-way, and the secret is never displayed, transmitted or logged.
   *
   * Behind the integrations permission, not public: the endpoint is a
   * convenience for an operator who is already an authenticated admin, and a
   * fingerprint served to anonymous callers would let a weak secret be attacked
   * offline.
   */
  secretIdentity(): {
    fingerprint: string;
    secretLength: number;
    serverTime: string;
    toleranceSeconds: number;
  } {
    const secret = this.env.NBR_WEBHOOK_SECRET;
    return {
      fingerprint: createHmac('sha256', secret)
        .update(SECRET_FINGERPRINT_LABEL)
        .digest('hex')
        .slice(0, 8),
      secretLength: secret.length,
      serverTime: new Date().toISOString(),
      toleranceSeconds: this.env.NBR_WEBHOOK_TOLERANCE_SECONDS,
    };
  }

  /** GET /integrations/nbr-website/sync-status */
  async syncStatus(): Promise<SyncStatus> {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [counts] = await this.db
      .select({
        pending: sql<number>`count(*) FILTER (WHERE ${schema.integrationEvents.status} IN ('received','processing'))::int`,
        importedToday: sql<number>`count(*) FILTER (WHERE ${schema.integrationEvents.status} IN ('imported','merged') AND ${schema.integrationEvents.processedAt} >= ${startOfToday.toISOString()}::timestamptz)::int`,
        failedToday: sql<number>`count(*) FILTER (WHERE ${schema.integrationEvents.status} = 'failed' AND ${schema.integrationEvents.processedAt} >= ${startOfToday.toISOString()}::timestamptz)::int`,
      })
      .from(schema.integrationEvents);

    const [latest] = await this.db
      .select({ receivedAt: schema.integrationEvents.receivedAt })
      .from(schema.integrationEvents)
      .orderBy(desc(schema.integrationEvents.receivedAt))
      .limit(1);

    const failures = await this.db
      .select({
        externalId: schema.integrationEvents.externalId,
        error: schema.integrationEvents.error,
        at: schema.integrationEvents.processedAt,
      })
      .from(schema.integrationEvents)
      .where(eq(schema.integrationEvents.status, INTEGRATION_IMPORT_STATUS.FAILED))
      .orderBy(desc(schema.integrationEvents.processedAt))
      .limit(10);

    return {
      lastWebhookAt: latest?.receivedAt.toISOString() ?? null,
      pending: counts?.pending ?? 0,
      importedToday: counts?.importedToday ?? 0,
      failedToday: counts?.failedToday ?? 0,
      pollingEnabled: this.env.NBR_POLL_ENABLED,
      recentFailures: failures.map((failure) => ({
        externalId: failure.externalId,
        error: failure.error ?? 'unknown',
        at: failure.at?.toISOString() ?? '',
      })),
    };
  }

  /** Replay a failed import after the underlying problem is fixed. */
  async replay(eventId: string): Promise<{ ok: true }> {
    await this.processEvent(eventId);
    return { ok: true };
  }

  /** The event queue, for the operations screen. */
  async listEvents(limit = 50) {
    const rows = await this.db
      .select({
        id: schema.integrationEvents.id,
        externalId: schema.integrationEvents.externalId,
        status: schema.integrationEvents.status,
        attemptCount: schema.integrationEvents.attemptCount,
        error: schema.integrationEvents.error,
        applicantId: schema.integrationEvents.applicantId,
        recordId: schema.integrationEvents.recordId,
        receivedAt: schema.integrationEvents.receivedAt,
        processedAt: schema.integrationEvents.processedAt,
      })
      .from(schema.integrationEvents)
      .orderBy(desc(schema.integrationEvents.receivedAt))
      .limit(limit);

    return rows.map((row) => ({
      ...row,
      receivedAt: row.receivedAt.toISOString(),
      processedAt: row.processedAt?.toISOString() ?? null,
    }));
  }
}

async function nextSequence(tx: Database, sequence: string): Promise<number> {
  const result = await tx.execute<{ nextval: string }>(
    sql`SELECT nextval(${sequence})::text AS nextval`,
  );
  return Number((result as unknown as Array<{ nextval: string }>)[0]!.nextval);
}
