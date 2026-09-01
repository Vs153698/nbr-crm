import { Inject, Injectable, Logger } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import { ValidationError } from '../common/errors';
import type { Database } from '../database/client';
import { DB } from '../database/database.tokens';
import * as schema from '../database/schema';

/** Settings keys — nothing here has an environment fallback; see the module doc. */
export const WHATSAPP_SETTING_KEYS = {
  enabled: 'whatsapp.enabled',
  phoneNumberId: 'whatsapp.phone_number_id',
  accessToken: 'whatsapp.access_token',
  apiVersion: 'whatsapp.api_version',
} as const;

export interface WhatsAppConfig {
  readonly enabled: boolean;
  readonly phoneNumberId: string;
  readonly accessToken: string;
  readonly apiVersion: string;
}

/** How long a resolved configuration is reused before Settings is re-read. */
const CONFIG_TTL_MS = 60_000;

/**
 * Meta's documented, stable code for "this is a business-initiated message and
 * the customer has not written to you in the last 24 hours" — the one failure
 * worth telling apart from every other, because it is not a misconfiguration.
 * See the module doc for what it means for this app.
 */
const OUTSIDE_SESSION_WINDOW_CODE = 131047;

export class WhatsAppSendError extends Error {
  constructor(
    message: string,
    readonly metaCode: number | null,
    /** True for the specific, expected, unfixable-by-retrying case above. */
    readonly outsideSessionWindow: boolean,
  ) {
    super(message);
  }
}

/**
 * WhatsApp Cloud API — configured entirely from Settings, never from the
 * environment.
 *
 * The customer holds their own Meta Business account; this exists so wiring it
 * up is four fields on a settings screen rather than an environment variable
 * only whoever has server access can set. Same shape as `MailService`: read
 * from `settings`, cache the result briefly, fall back to "not configured"
 * rather than to some hidden default.
 *
 * ── Why a message can still fail to send once this is configured ───────────
 *
 * The Cloud API only allows free-form text (`type: "text"`) inside a 24-hour
 * "session" — the window after the customer last messaged the business
 * number. Everything the templates in this CRM send — a payment reminder, a
 * selection notice, a certificate-ready message — is business-initiated, and
 * the applicant usually has not written in first, so most of these calls will
 * genuinely hit Meta's block on that route (`131047`, checked for specifically
 * below). Meta's own name for the fix is a "message template": a canned
 * message registered and *approved* through Meta Business Manager ahead of
 * time, sent via `type: "template"` instead of `type: "text"`. That approval
 * step happens in Meta's own console, on Meta's own review queue — nothing a
 * settings screen here can do can skip it or stand in for it.
 *
 * So this sends as a session message and reports the specific failure back
 * rather than pretending it worked: inside the window it goes straight out,
 * outside it the operator gets told exactly why and still has the existing
 * manual click-to-chat send as a fallback that was never touched.
 */
@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private cachedConfig: WhatsAppConfig | null = null;
  private cachedAt = 0;

  constructor(
    // Read straight from the table, same reasoning as MailService: this is
    // @Global and GovernanceService is not, and routing every send through the
    // governance module would couple outbound messaging to the reporting and
    // audit graph for one SELECT.
    @Inject(DB) private readonly db: Database,
  ) {}

  async resolveConfig(options: { fresh?: boolean } = {}): Promise<WhatsAppConfig> {
    if (!options.fresh && this.cachedConfig && Date.now() - this.cachedAt < CONFIG_TTL_MS) {
      return this.cachedConfig;
    }

    let stored: Record<string, unknown> = {};
    try {
      const rows = await this.db
        .select({ key: schema.settings.key, value: schema.settings.value })
        .from(schema.settings)
        .where(inArray(schema.settings.key, Object.values(WHATSAPP_SETTING_KEYS)));

      stored = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    } catch (error: unknown) {
      this.logger.warn(
        `Could not read WhatsApp settings: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const text = (key: string): string => {
      const value = stored[key];
      return typeof value === 'string' ? value.trim() : '';
    };

    const config: WhatsAppConfig = {
      enabled: stored[WHATSAPP_SETTING_KEYS.enabled] === true,
      phoneNumberId: text(WHATSAPP_SETTING_KEYS.phoneNumberId),
      accessToken: text(WHATSAPP_SETTING_KEYS.accessToken),
      apiVersion: text(WHATSAPP_SETTING_KEYS.apiVersion) || 'v22.0',
    };

    this.cachedConfig = config;
    this.cachedAt = Date.now();
    return config;
  }

  isConfigured(config: WhatsAppConfig): boolean {
    return config.enabled && config.phoneNumberId.length > 0 && config.accessToken.length > 0;
  }

  async status(): Promise<{ configured: boolean }> {
    return { configured: this.isConfigured(await this.resolveConfig()) };
  }

  private graphUrl(config: WhatsAppConfig, path: string): string {
    return `https://graph.facebook.com/${config.apiVersion}/${path}`;
  }

  /**
   * Extract Meta's error shape.
   *
   * The Graph API always answers with `{ error: { message, code, ... } }` on
   * failure, whatever the HTTP status — never plain text, so parsing as JSON
   * first and falling back to the status line is the reading that survives an
   * API version Meta has since changed the wording of.
   */
  private async readError(response: Response): Promise<{ message: string; code: number | null }> {
    try {
      const body = (await response.json()) as { error?: { message?: string; code?: number } };
      if (body?.error?.message) {
        return { message: body.error.message, code: body.error.code ?? null };
      }
    } catch {
      // Not JSON — fall through to the status line.
    }
    return { message: `WhatsApp API returned ${response.status} ${response.statusText}`, code: null };
  }

  /**
   * Send one text message.
   *
   * `to` must be digits only (no leading `+`) — Meta's own format for the
   * `to` field, and the plus sign is rejected outright rather than stripped.
   */
  async sendText(to: string, body: string): Promise<{ providerMessageId: string }> {
    const config = await this.resolveConfig();
    if (!this.isConfigured(config)) {
      throw new ValidationError({
        whatsapp: ['WhatsApp is not configured. Set it up under Settings → WhatsApp first.'],
      });
    }

    const response = await fetch(this.graphUrl(config, `${config.phoneNumberId}/messages`), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { preview_url: false, body },
      }),
    });

    if (!response.ok) {
      const { message, code } = await this.readError(response);
      throw new WhatsAppSendError(message, code, code === OUTSIDE_SESSION_WINDOW_CODE);
    }

    const result = (await response.json()) as { messages?: Array<{ id: string }> };
    const providerMessageId = result.messages?.[0]?.id;
    if (!providerMessageId) {
      // Meta returned 2xx with no message id — treat as a failure rather than
      // record a "sent" row with nothing to trace a delivery complaint back to.
      throw new WhatsAppSendError('WhatsApp accepted the request but returned no message id.', null, false);
    }

    return { providerMessageId };
  }

  /**
   * Confirm the credentials actually work, and say which number they reach.
   *
   * A real call rather than a shape check: the access token can be well-formed
   * and still be expired, revoked, or scoped to a different phone number, and
   * the operator needs to know that before relying on it for the first
   * applicant-facing send.
   */
  async testConnection(): Promise<{ displayPhoneNumber: string; verifiedName: string }> {
    const config = await this.resolveConfig({ fresh: true });
    if (!config.phoneNumberId || !config.accessToken) {
      throw new ValidationError({
        whatsapp: ['Enter a phone number ID and access token before testing.'],
      });
    }

    const response = await fetch(
      this.graphUrl(config, `${config.phoneNumberId}?fields=display_phone_number,verified_name`),
      { headers: { Authorization: `Bearer ${config.accessToken}` } },
    );

    if (!response.ok) {
      const { message } = await this.readError(response);
      throw new ValidationError({ whatsapp: [message] });
    }

    const result = (await response.json()) as {
      display_phone_number?: string;
      verified_name?: string;
    };

    return {
      displayPhoneNumber: result.display_phone_number ?? 'Unknown',
      verifiedName: result.verified_name ?? 'Unknown',
    };
  }
}
