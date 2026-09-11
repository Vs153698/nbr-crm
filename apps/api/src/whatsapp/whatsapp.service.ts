import {
  WHATSAPP_PROVIDER,
  buildWhatsAppParams,
  whatsappRegistrySchema,
  type WhatsAppProvider,
  type WhatsAppTemplate,
} from '@nbr/shared';
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
  /** Which transport carries the message — see `WHATSAPP_PROVIDER`. */
  provider: 'whatsapp.provider',
  aisensyApiKey: 'whatsapp.aisensy_api_key',
  /** Filed against the contact inside AiSensy; not shown to the applicant. */
  aisensySenderName: 'whatsapp.aisensy_sender_name',
  /** The template registry, as a JSON array. */
  templates: 'whatsapp.templates',
} as const;

/** AiSensy's campaign endpoint. The API key travels in the body, not a header. */
const AISENSY_CAMPAIGN_URL = 'https://backend.aisensy.com/campaign/t1/api/v2';

/** A send must never hold a request open behind it. */
const SEND_TIMEOUT_MS = 15_000;

/** Assumed when a stored number carries no country code of its own. */
const DEFAULT_DIAL_CODE = '91';
const NATIONAL_NUMBER_LENGTH = 10;

/**
 * A destination in the form AiSensy's API reference documents: `+917428526285`.
 *
 * Callers hold numbers in every shape the CRM has ever stored — `+91 98765
 * 43210` from `toE164`, a bare ten-digit mobile imported from the website — and
 * two of them used to strip the plus before calling in. That was wrong: AiSensy
 * accepts the plus, and for any number outside India requires it. Indian
 * numbers survived the stripping only because AiSensy defaults an unresolvable
 * number to +91, which is why nobody noticed.
 *
 * Normalising here rather than at each call site means a new caller cannot
 * reintroduce the same bug.
 */
export function toAiSensyDestination(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length === NATIONAL_NUMBER_LENGTH
    ? `+${DEFAULT_DIAL_CODE}${digits}`
    : `+${digits}`;
}

export interface WhatsAppConfig {
  readonly enabled: boolean;
  readonly provider: WhatsAppProvider;
  readonly phoneNumberId: string;
  readonly accessToken: string;
  readonly apiVersion: string;
  readonly aisensyApiKey: string;
  readonly aisensySenderName: string;
  readonly templates: readonly WhatsAppTemplate[];
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

    const rawProvider = text(WHATSAPP_SETTING_KEYS.provider);
    const provider: WhatsAppProvider =
      rawProvider === WHATSAPP_PROVIDER.AISENSY ? WHATSAPP_PROVIDER.AISENSY : WHATSAPP_PROVIDER.META;

    const config: WhatsAppConfig = {
      enabled: stored[WHATSAPP_SETTING_KEYS.enabled] === true,
      provider,
      phoneNumberId: text(WHATSAPP_SETTING_KEYS.phoneNumberId),
      accessToken: text(WHATSAPP_SETTING_KEYS.accessToken),
      apiVersion: text(WHATSAPP_SETTING_KEYS.apiVersion) || 'v22.0',
      aisensyApiKey: text(WHATSAPP_SETTING_KEYS.aisensyApiKey),
      aisensySenderName:
        text(WHATSAPP_SETTING_KEYS.aisensySenderName) || 'National Book of Records',
      templates: this.parseRegistry(stored[WHATSAPP_SETTING_KEYS.templates]),
    };

    this.cachedConfig = config;
    this.cachedAt = Date.now();
    return config;
  }

  /**
   * Read the stored registry.
   *
   * Deliberately total. A settings row hand-edited into something unreadable
   * disables template sending; it does not throw inside whichever approval or
   * payment flow happened to trigger the message. Entries that do not parse are
   * dropped rather than taking the rest of the registry with them.
   */
  private parseRegistry(raw: unknown): WhatsAppTemplate[] {
    if (raw === null || raw === undefined) return [];

    let candidate: unknown = raw;
    if (typeof raw === 'string') {
      if (!raw.trim()) return [];
      try {
        candidate = JSON.parse(raw);
      } catch {
        this.logger.warn('WhatsApp template registry is not valid JSON — treating it as empty');
        return [];
      }
    }

    if (!Array.isArray(candidate)) return [];

    const templates: WhatsAppTemplate[] = [];
    for (const entry of candidate) {
      const parsed = whatsappRegistrySchema.element.safeParse(entry);
      if (parsed.success) templates.push(parsed.data);
    }
    return templates;
  }

  isConfigured(config: WhatsAppConfig): boolean {
    if (!config.enabled) return false;
    if (config.provider === WHATSAPP_PROVIDER.AISENSY) return config.aisensyApiKey.length > 0;
    return config.phoneNumberId.length > 0 && config.accessToken.length > 0;
  }

  async status(): Promise<{
    configured: boolean;
    provider: WhatsAppProvider;
    templateCount: number;
  }> {
    const config = await this.resolveConfig();
    return {
      configured: this.isConfigured(config),
      provider: config.provider,
      templateCount: config.templates.filter((t) => t.isActive).length,
    };
  }

  /** Active registered templates, for the settings screen and the send dialog. */
  async listTemplates(): Promise<readonly WhatsAppTemplate[]> {
    return (await this.resolveConfig()).templates.filter((template) => template.isActive);
  }

  /**
   * Send one approved template through AiSensy.
   *
   * `templateParams` goes on the wire positionally and unnamed: AiSensy drops
   * the values into `{{1}}`, `{{2}}` … in the order given. The registry is what
   * keeps that order meaningful — see the shared `whatsapp` schema.
   */
  async sendTemplate(input: {
    to: string;
    templateId: string;
    values: Readonly<Record<string, string | number | null | undefined>>;
    recipientName?: string;
  }): Promise<{ providerMessageId: string }> {
    const config = await this.resolveConfig();

    if (!this.isConfigured(config)) {
      /**
       * Say which half is missing.
       *
       * "Not configured" is unhelpful to someone standing on the settings
       * screen with a key pasted in: the usual cause is the enable checkbox
       * still being off, which does not look like configuration at all.
       */
      throw new ValidationError({
        whatsapp: [
          !config.enabled
            ? 'Tick “Send WhatsApp messages automatically” and save — sending is switched off.'
            : 'Add your AiSensy API key and save first.',
        ],
      });
    }
    if (config.provider !== WHATSAPP_PROVIDER.AISENSY) {
      throw new ValidationError({
        whatsapp: ['Template messages require the AiSensy provider. Change it under Settings.'],
      });
    }

    const template = config.templates.find((entry) => entry.id === input.templateId);
    if (!template) {
      // Most often an unsaved one: the editor holds it locally until Save, and
      // only saved templates exist here.
      throw new ValidationError({
        whatsapp: [
          'That template is not saved yet. Save your settings, then send the test.',
        ],
      });
    }
    if (!template.isActive) {
      throw new ValidationError({ whatsapp: [`"${template.label}" is switched off.`] });
    }

    let response: Response;
    try {
      response = await fetch(AISENSY_CAMPAIGN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: config.aisensyApiKey,
          campaignName: template.campaignName,
          destination: toAiSensyDestination(input.to),
          userName: input.recipientName || config.aisensySenderName,
          source: 'nbr-crm',
          templateParams: buildWhatsAppParams(template, input.values),
        }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
    } catch (error: unknown) {
      throw new WhatsAppSendError(
        `Could not reach AiSensy: ${error instanceof Error ? error.message : String(error)}`,
        null,
        false,
      );
    }

    if (!response.ok) {
      const { message } = await this.readError(response);
      throw new WhatsAppSendError(message, null, false);
    }

    /**
     * AiSensy answers a successful campaign send with a plain acknowledgement
     * and no per-message id. There is therefore nothing provider-side to trace
     * a delivery complaint back to, so the campaign name is recorded instead —
     * enough to find the send in their dashboard, which is where the delivery
     * report lives anyway.
     */
    return { providerMessageId: `aisensy:${template.campaignName}` };
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

    /**
     * Free text is a Meta-only route.
     *
     * On AiSensy the phone number id and access token are blank — the account
     * is theirs, not ours — so without this the call would go to Meta with
     * empty credentials and fail with an authentication error that says nothing
     * about the real cause. Approved templates are the route here.
     */
    if (config.provider !== WHATSAPP_PROVIDER.META) {
      throw new ValidationError({
        whatsapp: [
          'This account sends through AiSensy, which only carries approved templates. Choose a template instead.',
        ],
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

    /**
     * AiSensy has no equivalent of Meta's phone-number lookup — the only way to
     * learn whether a key works is to send with it. The settings screen offers
     * a real test send against a chosen template for that reason, and this
     * method stays Meta's.
     */
    if (config.provider === WHATSAPP_PROVIDER.AISENSY) {
      throw new ValidationError({
        whatsapp: [
          'AiSensy has no way to verify a key without sending. Use the “Send a test message” box on this screen instead — it sends one of your approved templates to a number you choose.',
        ],
      });
    }

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
