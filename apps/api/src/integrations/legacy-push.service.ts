import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { toRupees } from '@nbr/shared';
import { and, eq, isNull, notInArray } from 'drizzle-orm';
import { AUDIT, AuditService } from '../audit/audit.service';
import { ValidationError } from '../common/errors';
import { CacheService, CacheTag } from '../redis/cache.service';
import type { Database } from '../database/client';
import { DB } from '../database/database.tokens';
import * as schema from '../database/schema';
import { GovernanceService } from '../governance/governance.service';

/** Settings keys holding the connection back to the legacy admin system. */
export const LEGACY_SETTING_KEYS = {
  enabled: 'integrations.legacy.enabled',
  baseUrl: 'integrations.legacy.base_url',
  secret: 'integrations.legacy.secret',
} as const;

/** Connector endpoints exposed by the legacy backend. */
const LEGACY_PATHS = {
  payment: '/api/crm-connector/payment',
  dispatch: '/api/crm-connector/dispatch',
  certificate: '/api/crm-connector/certificate',
} as const;

/** Read-only endpoints carrying the website's reference data. */
const LEGACY_PLANS_PATH = '/api/crm-connector/plans';
const LEGACY_CATEGORIES_PATH = '/api/crm-connector/categories';

/** GST the website charges. Its plan prices are inclusive, with no separate line. */
const LEGACY_GST_PERCENT = '0.00';

interface LegacyPlan {
  /** `payment_plans.id` on the website. Absent from older connector builds. */
  readonly id?: string;
  readonly code: string;
  readonly label: string;
  readonly amountPaise: number;
  readonly features: string[];
  readonly isActive: boolean;
  readonly sortOrder: number;
  readonly acceptedByPaymentsTable: boolean;
}

interface LegacyCategory {
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly isActive: boolean;
  readonly sortOrder: number;
}

export interface PackageSyncResult {
  readonly imported: number;
  readonly updated: number;
  readonly skipped: number;
  /** CRM-only entries switched off, because the website never offered them. */
  readonly retired: number;
  readonly packages: Array<{ name: string; legacyCode: string; amount: string }>;
}

export interface CategorySyncResult {
  readonly imported: number;
  readonly updated: number;
  readonly retired: number;
  readonly categories: string[];
}

const PUSH_TIMEOUT_MS = 15_000;
const RETRY_DELAYS_MS = [1_000, 5_000] as const;

export type LegacyPushKind = keyof typeof LEGACY_PATHS;

export interface LegacyConfig {
  readonly enabled: boolean;
  readonly baseUrl: string;
  readonly secret: string;
}

export interface PushResult {
  readonly ok: boolean;
  readonly skipped: boolean;
  readonly reason?: string;
  readonly httpStatus?: number;
}

/**
 * Pushes CRM-side changes back to the public NBR website's admin system.
 *
 * This is the return leg of the mirror. When an operator records a payment,
 * issues a certificate or updates a courier here, the customer site has to
 * learn about it — its applicant portal, its invoices and its public
 * verification page are all still served from there.
 *
 * Three properties keep this safe to run alongside a live public site:
 *
 *  • **Only records that came from there.** A push needs a `legacy_mirror` row.
 *    Records created directly in the CRM have no counterpart on the website and
 *    are never pushed — which is exactly the behaviour asked for.
 *  • **Echo suppression.** Applying an inbound snapshot records its hash; a
 *    push whose hash matches is recognised as the echo of a change that
 *    originated on the far side and is dropped, so the two systems cannot
 *    volley one update back and forth.
 *  • **Never throws into a request.** A failed push is written to the mirror
 *    row and surfaced on the integrations screen. The operator's action here
 *    has already succeeded and must not be rolled back by a network problem.
 */
@Injectable()
export class LegacyPushService {
  private readonly logger = new Logger(LegacyPushService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly governance: GovernanceService,
    private readonly audit: AuditService,
    private readonly cache: CacheService,
  ) {}

  async getConfig(): Promise<LegacyConfig> {
    try {
      const [enabled, baseUrl, secret] = await Promise.all([
        this.governance.getSetting(LEGACY_SETTING_KEYS.enabled),
        this.governance.getSetting(LEGACY_SETTING_KEYS.baseUrl),
        this.governance.getSetting(LEGACY_SETTING_KEYS.secret),
      ]);

      const url = String(baseUrl ?? '').trim().replace(/\/+$/, '');
      const sharedSecret = String(secret ?? '').trim();

      return {
        // Switched on but incomplete counts as off: a half-configured push that
        // fails on every payment would bury the real failures in noise.
        enabled: enabled === true && url.length > 0 && sharedSecret.length > 0,
        baseUrl: url,
        secret: sharedSecret,
      };
    } catch (error: unknown) {
      this.logger.error(
        `Could not read legacy settings: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { enabled: false, baseUrl: '', secret: '' };
    }
  }

  /**
   * The mirror row for a record, or `null` when the record is CRM-only.
   *
   * Callers treat `null` as "nothing to do" rather than an error — most records
   * in a mature system will eventually be CRM-native.
   */
  private async mirrorFor(recordId: string) {
    const [mirror] = await this.db
      .select()
      .from(schema.legacyMirror)
      .where(eq(schema.legacyMirror.recordId, recordId))
      .limit(1);

    return mirror ?? null;
  }

  private sign(body: string, secret: string): string {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
    return `t=${timestamp},v1=${signature}`;
  }

  private hash(value: unknown): string {
    return createHmac('sha256', 'legacy-echo').update(JSON.stringify(value)).digest('hex');
  }

  /**
   * Send one change to the legacy connector.
   *
   * `payload.applicationId` is filled in from the mirror row rather than taken
   * from the caller — the CRM's record id means nothing on the far side, and
   * letting a caller supply it would be one more way to write to the wrong
   * application.
   */
  async push(
    kind: LegacyPushKind,
    recordId: string,
    payload: Record<string, unknown>,
  ): Promise<PushResult> {
    const config = await this.getConfig();
    if (!config.enabled) return { ok: false, skipped: true, reason: 'legacy sync is switched off' };

    const mirror = await this.mirrorFor(recordId);
    if (!mirror) {
      return { ok: false, skipped: true, reason: 'record does not exist on the website' };
    }

    const body = JSON.stringify({ ...payload, applicationId: mirror.externalId });
    const fingerprint = this.hash([kind, body]);

    // The change we are about to send is the one we just received from them.
    if (mirror.inboundHash && fingerprint === mirror.outboundHash) {
      return { ok: false, skipped: true, reason: 'echo of an inbound change' };
    }

    const url = `${config.baseUrl}${LEGACY_PATHS[kind]}`;
    let lastStatus: number | undefined;
    let lastError: string | undefined;

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // Signed per attempt: a signature minted for the first try would
            // fall outside the far side's freshness window by the last retry.
            'X-NBR-Signature': this.sign(body, config.secret),
          },
          body,
          signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
        });

        lastStatus = response.status;

        if (response.ok) {
          await this.db
            .update(schema.legacyMirror)
            .set({ outboundHash: fingerprint, lastOutboundAt: new Date(), lastOutboundError: null })
            .where(eq(schema.legacyMirror.recordId, recordId));

          await this.audit.record({
            action: AUDIT.WEBHOOK_RECEIVED,
            entityType: 'integration',
            entityId: recordId,
            entityLabel: `push:${kind} → ${mirror.externalId}`,
          });

          return { ok: true, skipped: false, httpStatus: response.status };
        }

        lastError = (await response.text().catch(() => '')).slice(0, 500);

        // A 4xx is a payload the far side will never accept; retrying is waste.
        if (response.status < 500 && response.status !== 429) break;
      } catch (error: unknown) {
        lastStatus = undefined;
        lastError = error instanceof Error ? error.message : String(error);
      }

      if (attempt < RETRY_DELAYS_MS.length) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
      }
    }

    const message = `${kind} push failed${lastStatus ? ` (HTTP ${lastStatus})` : ''}: ${lastError ?? 'no response'}`;
    this.logger.error(`${message} — record ${recordId}`);

    await this.db
      .update(schema.legacyMirror)
      .set({ lastOutboundError: message, lastOutboundAt: new Date() })
      .where(eq(schema.legacyMirror.recordId, recordId));

    return { ok: false, skipped: false, httpStatus: lastStatus, reason: message };
  }

  /**
   * Fire a push without waiting for it and without letting it reject.
   *
   * The form every call site inside a service uses: the operator's action has
   * already been committed and answered.
   */
  pushDetached(kind: LegacyPushKind, recordId: string, payload: Record<string, unknown>): void {
    setImmediate(() => {
      void this.push(kind, recordId, payload).catch((error: unknown) => {
        this.logger.error(
          `Detached ${kind} push threw: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    });
  }

  /**
   * Mirror the website's plan catalogue into our packages list.
   *
   * The reason this exists rather than a mapping table: the website's payments
   * table only accepts three plan codes, and a payment recorded here against a
   * CRM-invented package had to be guessed back onto one of them by price.
   * Guessing works until someone prices two packages the same. Sharing the
   * catalogue means an operator picks the same package on either side and the
   * code round-trips exactly.
   *
   * Matched on `legacyCode`, so renaming a package here does not orphan it, and
   * an operator's own packages are never touched.
   */
  async syncPackages(): Promise<PackageSyncResult> {
    const config = await this.getConfig();
    if (!config.enabled) {
      throw new ValidationError({
        integration: ['Set the website URL and secret, and switch the integration on, first.'],
      });
    }

    // The website signs GETs over the literal "{}" — it has no body to sign and
    // its verifier falls back to an empty object.
    const signedEmptyBody = '{}';
    const response = await fetch(`${config.baseUrl}${LEGACY_PLANS_PATH}`, {
      method: 'GET',
      headers: { 'X-NBR-Signature': this.sign(signedEmptyBody, config.secret) },
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ValidationError({
        integration: [
          `The website returned HTTP ${response.status} for its plan catalogue${detail ? `: ${detail.slice(0, 200)}` : ''}.`,
        ],
      });
    }

    const body = (await response.json()) as { data?: LegacyPlan[] };
    const plans = body.data ?? [];

    const result: PackageSyncResult = { imported: 0, updated: 0, skipped: 0, retired: 0, packages: [] };
    let imported = 0;
    let updated = 0;
    let skipped = 0;
    const packages: PackageSyncResult['packages'] = [];

    for (const plan of plans) {
      // A code the website cannot write back to its own payments table would
      // give an operator a package that silently degrades on push. Better not
      // to offer it at all.
      if (!plan.acceptedByPaymentsTable) {
        skipped++;
        continue;
      }

      const amount = toRupees(plan.amountPaise);
      // The website's own label, unqualified. Once the CRM-only packages below
      // are retired this is the whole catalogue, so a "(website)" suffix on
      // every row would only add noise to the Raise Payment dropdown.
      const name = plan.label;

      // Match by identity first — the plan's own id — so a plan that was
      // relabelled or re-priced on the website updates the package it already
      // owns. Matching on code alone could not tell that apart from a different
      // plan reusing one of the three permitted codes.
      //
      // Then the code, for packages mirrored before the website sent ids.
      //
      // Then the name: the CRM shipped its own "Basic" and "Premium", and
      // package names are uniquely indexed, so inserting alongside them would
      // simply fail. Adopting rewrites that row to the website's price, code and
      // id, leaving one "Basic" in the dropdown at the price on the applicant's
      // invoice — better than a rename that would read as two packages.
      const [byId] = plan.id
        ? await this.db
            .select({ id: schema.packages.id })
            .from(schema.packages)
            .where(eq(schema.packages.legacyPlanId, plan.id))
            .limit(1)
        : [];

      const [byCode] = byId
        ? []
        : await this.db
            .select({ id: schema.packages.id })
            .from(schema.packages)
            .where(eq(schema.packages.legacyCode, plan.code))
            .limit(1);

      const existing = byId ?? byCode;

      const [byName] = existing
        ? []
        : await this.db
            .select({ id: schema.packages.id })
            .from(schema.packages)
            .where(eq(schema.packages.name, name))
            .limit(1);

      const target = existing ?? byName;

      if (target) {
        await this.db
          .update(schema.packages)
          .set({
            name,
            legacyCode: plan.code,
            legacyPlanId: plan.id ?? null,
            amount,
            // The website's prices are all-inclusive with no separate GST line,
            // so mirroring them at 18% would overstate every invoice by 18%.
            gstPercent: LEGACY_GST_PERCENT,
            description: plan.features.join(' · ') || null,
            isActive: plan.isActive,
            sortOrder: plan.sortOrder,
          })
          .where(eq(schema.packages.id, target.id));
        updated++;
      } else {
        await this.db.insert(schema.packages).values({
          name,
          legacyCode: plan.code,
          legacyPlanId: plan.id ?? null,
          amount,
          gstPercent: LEGACY_GST_PERCENT,
          description: plan.features.join(' · ') || null,
          isActive: plan.isActive,
          sortOrder: plan.sortOrder,
        });
        imported++;
      }

      packages.push({ name, legacyCode: plan.code, amount });
    }

    // Retire anything the website does not offer.
    //
    // An operator picking a CRM-only package raises an invoice at a price no
    // applicant was ever quoted, and the push back to the website has no plan
    // code to carry, so it degrades to a name-and-amount match that the
    // website's three-value CHECK constraint then rejects. Leaving these in the
    // dropdown is offering the operator a way to get it wrong.
    //
    // Switched off rather than deleted: payments already raised against them
    // must keep resolving, and their package name is stored on the payment row.
    let retired = 0;
    if (packages.length > 0) {
      const retiredRows = await this.db
        .update(schema.packages)
        .set({ isActive: false })
        .where(and(isNull(schema.packages.legacyCode), eq(schema.packages.isActive, true)))
        .returning({ id: schema.packages.id });
      retired = retiredRows.length;
    }

    await this.cache.invalidateTags(CacheTag.settings());

    this.logger.log(
      `Package sync: ${imported} imported, ${updated} updated, ${skipped} skipped, ${retired} retired`,
    );
    return { ...result, imported, updated, skipped, retired, packages };
  }

  /**
   * Mirror the website's category list into the CRM.
   *
   * Applications are created on the website, against the website's categories.
   * When the CRM keeps its own list, every arriving application carries a name
   * the CRM cannot match — "Sports" against "Sports & Adventure" — and raises an
   * operator alert about a mismatch nobody can resolve, because the applicant
   * only ever saw the website's list.
   *
   * Matched on slug, so renaming a category on the website updates the CRM row
   * instead of orphaning it and creating a duplicate.
   */
  async syncCategories(): Promise<CategorySyncResult> {
    const config = await this.getConfig();
    if (!config.enabled) {
      throw new ValidationError({
        integration: ['Set the website URL and secret, and switch the integration on, first.'],
      });
    }

    const signedEmptyBody = '{}';
    const response = await fetch(`${config.baseUrl}${LEGACY_CATEGORIES_PATH}`, {
      method: 'GET',
      headers: { 'X-NBR-Signature': this.sign(signedEmptyBody, config.secret) },
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ValidationError({
        integration: [
          `The website returned HTTP ${response.status} for its category list${detail ? `: ${detail.slice(0, 200)}` : ''}.`,
        ],
      });
    }

    const body = (await response.json()) as { data?: LegacyCategory[] };
    const remote = body.data ?? [];

    let imported = 0;
    let updated = 0;
    const names: string[] = [];

    for (const category of remote) {
      const [existing] = await this.db
        .select({ id: schema.categories.id })
        .from(schema.categories)
        .where(eq(schema.categories.slug, category.slug))
        .limit(1);

      if (existing) {
        await this.db
          .update(schema.categories)
          .set({
            name: category.name,
            description: category.description,
            isActive: category.isActive,
            sortOrder: category.sortOrder,
          })
          .where(eq(schema.categories.id, existing.id));
        updated++;
      } else {
        await this.db.insert(schema.categories).values({
          name: category.name,
          slug: category.slug,
          description: category.description,
          isActive: category.isActive,
          sortOrder: category.sortOrder,
        });
        imported++;
      }

      names.push(category.name);
    }

    // Same reasoning as packages: a category the website does not offer cannot
    // arrive on an application, so leaving it selectable only creates records
    // the website will never recognise. Deactivated, never deleted — existing
    // records point at these rows.
    let retired = 0;
    if (remote.length > 0) {
      const slugs = remote.map((category) => category.slug);
      const retiredRows = await this.db
        .update(schema.categories)
        .set({ isActive: false })
        .where(
          and(eq(schema.categories.isActive, true), notInArray(schema.categories.slug, slugs)),
        )
        .returning({ id: schema.categories.id });
      retired = retiredRows.length;
    }

    await this.cache.invalidateTags(CacheTag.settings());

    this.logger.log(
      `Category sync: ${imported} imported, ${updated} updated, ${retired} retired`,
    );
    return { imported, updated, retired, categories: names };
  }

  // ── Typed helpers for the three mirrored events ───────────────────────────

  /**
   * A payment banked in the CRM. Amounts cross the wire in paise.
   *
   * `packageId` is what makes this exact: a package mirrored from the website
   * carries its `legacyCode`, so the push sends the code the website's payments
   * table actually stores. Without one — a CRM-only package — the name goes
   * over and the website matches it by name and amount.
   */
  async pushPayment(
    recordId: string,
    input: {
      plan: string;
      packageId?: string | null;
      amountPaise: number;
      method: string;
      referenceNumber: string;
      notes?: string;
      /** Let the website send its own invoice mail. Off by default so the
       *  applicant does not receive two messages for one payment. */
      sendNotifications?: boolean;
    },
  ): Promise<void> {
    let plan = input.plan;

    if (input.packageId) {
      const [pkg] = await this.db
        .select({ legacyCode: schema.packages.legacyCode })
        .from(schema.packages)
        .where(eq(schema.packages.id, input.packageId))
        .limit(1);

      if (pkg?.legacyCode) plan = pkg.legacyCode;
    }

    this.pushDetached('payment', recordId, {
      plan,
      amountPaise: input.amountPaise,
      method: input.method,
      referenceNumber: input.referenceNumber,
      notes: input.notes,
      sendNotifications: input.sendNotifications ?? false,
    });
  }

  pushDispatch(
    recordId: string,
    input: {
      status?: string;
      courierName?: string;
      trackingNumber?: string;
      trackingUrl?: string;
      notes?: string;
    },
  ): void {
    this.pushDetached('dispatch', recordId, input);
  }

  pushCertificate(
    recordId: string,
    input: {
      action?: 'issue' | 'revoke' | 'unrevoke';
      certificateId?: string;
      holderName?: string;
      recordTitle?: string;
      category?: string;
      reason?: string;
    },
  ): void {
    this.pushDetached('certificate', recordId, { action: 'issue', ...input });
  }

  /** Connection health for the integrations screen. */
  async status(): Promise<{
    configured: boolean;
    baseUrl: string;
    mirroredRecords: number;
    failing: Array<{ recordId: string; externalId: string; error: string; at: string | null }>;
  }> {
    const config = await this.getConfig();

    const rows = await this.db
      .select({
        recordId: schema.legacyMirror.recordId,
        externalId: schema.legacyMirror.externalId,
        error: schema.legacyMirror.lastOutboundError,
        at: schema.legacyMirror.lastOutboundAt,
      })
      .from(schema.legacyMirror);

    return {
      configured: config.enabled,
      baseUrl: config.baseUrl,
      mirroredRecords: rows.length,
      failing: rows
        .filter((row) => row.error)
        .slice(0, 20)
        .map((row) => ({
          recordId: row.recordId,
          externalId: row.externalId,
          error: row.error!,
          at: row.at?.toISOString() ?? null,
        })),
    };
  }
}
