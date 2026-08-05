import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { AUDIT, AuditService } from '../audit/audit.service';
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

  // ── Typed helpers for the three mirrored events ───────────────────────────

  /** A payment banked in the CRM. Amounts cross the wire in paise. */
  pushPayment(
    recordId: string,
    input: {
      plan: string;
      amountPaise: number;
      method: string;
      referenceNumber: string;
      notes?: string;
      /** Let the website send its own invoice mail. Off by default so the
       *  applicant does not receive two messages for one payment. */
      sendNotifications?: boolean;
    },
  ): void {
    this.pushDetached('payment', recordId, {
      plan: input.plan,
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
