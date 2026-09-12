import {
  WHATSAPP_PROVIDER,
  buildWhatsAppParams,
  whatsappRegistrySchema,
  type WhatsAppProvider,
  type WhatsAppTemplate,
} from '@nbr/shared';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import { DomainError, ValidationError } from '../common/errors';
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
 * Put a number people actually typed into the form AiSensy documents.
 *
 * Applicants write the same mobile every way there is — `9876543210`,
 * `09876543210`, `91 98765 43210`, `+91-98765-43210`, `0091 9876543210` — and
 * only the bare ten-digit form was understood here. Everything else went out as
 * typed: `09876543210` became `+09876543210`, which AiSensy rejects as "Invalid
 * Number", so the applicant never heard from us.
 *
 * The two prefixes handled are the ones that actually turn up:
 *
 *  - `00` — the international access code, meaning what a `+` means.
 *  - `0`  — India's trunk prefix, dialled before a mobile from a landline and
 *           habitually written down that way. It appears bare, and after the
 *           country code (`910XXXXXXXXXX`).
 *
 * The leading plus is kept: their reference shows `+917428526285` and requires
 * that form for any number outside India. Normalising here rather than at each
 * call site means a new caller cannot reintroduce either bug.
 */
export function toAiSensyDestination(phone: string): string {
  let digits = phone.replace(/\D/g, '');

  if (digits.startsWith('00')) digits = digits.slice(2);

  // Trunk prefix, bare: 0 + ten digits.
  if (digits.length === NATIONAL_NUMBER_LENGTH + 1 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  // Trunk prefix kept after the country code: 91 + 0 + ten digits.
  if (digits.length === NATIONAL_NUMBER_LENGTH + 3 && digits.startsWith(`${DEFAULT_DIAL_CODE}0`)) {
    digits = `${DEFAULT_DIAL_CODE}${digits.slice(3)}`;
  }

  // No country code of its own. A bare ten-digit number is never a complete
  // international number, so this is safe even when the writer typed a `+`.
  if (digits.length === NATIONAL_NUMBER_LENGTH) {
    digits = `${DEFAULT_DIAL_CODE}${digits}`;
  }

  return `+${digits}`;
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

/**
 * A send the provider refused, or could not be reached to attempt.
 *
 * A `DomainError` rather than a plain `Error` deliberately. As a plain Error it
 * carried no HTTP mapping, so the exception filter fell through to a generic
 * 500 and the provider's own explanation — the single most useful thing here,
 * and usually something only the operator can fix, like a campaign that does
 * not exist — reached the server log and nothing else. `testConnection` in this
 * same service always surfaced its provider message properly; this path did
 * not, for no reason beyond the base class.
 *
 * The message goes in `fields.whatsapp` as well as the body so the settings
 * screen shows it against the WhatsApp form rather than as a bare toast.
 */
export class WhatsAppSendError extends DomainError {
  constructor(
    message: string,
    readonly metaCode: number | null,
    /** True for the specific, expected, unfixable-by-retrying case above. */
    readonly outsideSessionWindow: boolean,
    /**
     * A refusal is the operator's to fix and is reported as such; a provider we
     * could not reach at all is a gateway fault and must not be blamed on them.
     */
    status: HttpStatus = HttpStatus.UNPROCESSABLE_ENTITY,
  ) {
    super('WHATSAPP_SEND_FAILED', message, status, { whatsapp: [message] });
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
      /**
       * `templateParams` is omitted entirely for a template with no
       * placeholders, rather than sent as `[]`.
       *
       * AiSensy rejects the message outright when the array length does not
       * match the campaign's parameter count, and documents the field as
       * optional — so for a campaign that takes none, absent is the shape they
       * describe and an empty array is a guess.
       */
      const templateParams = buildWhatsAppParams(template, input.values);

      response = await fetch(AISENSY_CAMPAIGN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: config.aisensyApiKey,
          campaignName: template.campaignName,
          destination: toAiSensyDestination(input.to),
          userName: input.recipientName || config.aisensySenderName,
          source: 'nbr-crm',
          ...(templateParams.length > 0 ? { templateParams } : {}),
        }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
    } catch (error: unknown) {
      throw new WhatsAppSendError(
        `Could not reach AiSensy: ${error instanceof Error ? error.message : String(error)}`,
        null,
        false,
        HttpStatus.BAD_GATEWAY,
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
    const raw = await response.text().catch(() => '');

    // Always logged, whatever shape it is. The parsing below is best-effort and
    // the operator's report of "it just says 400" has to be answerable.
    if (raw) this.logger.warn(`Provider error body (${response.status}): ${raw.slice(0, 1000)}`);

    let parsed: unknown = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      // Not JSON. The raw text is still the best thing to show.
    }

    if (parsed !== null && typeof parsed === 'object') {
      const body = parsed as Record<string, unknown>;

      // Meta nests under `error`; AiSensy does not document its error shape at
      // all, and has been seen to use several. Rather than guess one, take the
      // first plausible message-bearing field — and if none matches, fall back
      // to the raw body rather than throwing the provider's explanation away,
      // which is exactly what this method used to do.
      const nested = body.error;
      if (typeof nested === 'object' && nested !== null) {
        const inner = nested as Record<string, unknown>;
        if (typeof inner.message === 'string' && inner.message.trim()) {
          return {
            message: inner.message,
            code: typeof inner.code === 'number' ? inner.code : null,
          };
        }
      }

      for (const key of ['message', 'errorMessage', 'error', 'msg', 'description', 'detail']) {
        const value = body[key];
        if (typeof value === 'string' && value.trim()) {
          return { message: value, code: typeof body.code === 'number' ? body.code : null };
        }
      }
    }

    const detail = raw.trim().slice(0, 300);
    return {
      message: detail
        ? `WhatsApp API returned ${response.status}: ${detail}`
        : `WhatsApp API returned ${response.status} ${response.statusText}`,
      code: null,
    };
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
      throw new WhatsAppSendError(
        'WhatsApp accepted the request but returned no message id.',
        null,
        false,
        HttpStatus.BAD_GATEWAY,
      );
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
