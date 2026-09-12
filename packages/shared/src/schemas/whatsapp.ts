import { z } from 'zod';

/**
 * The WhatsApp template registry.
 *
 * WhatsApp will not deliver free text to someone who has not messaged the
 * business in the last 24 hours, and almost everything this system sends —
 * a selection notice, a payment confirmation, a dispatch update — goes to
 * someone who has not. The only route that reaches them is a *template*
 * approved in advance through Meta, which a provider such as AiSensy sends
 * under a campaign name, supplying nothing at call time but the ordered values
 * for its `{{1}}`, `{{2}}` … placeholders.
 *
 * Which values, and in what order, is knowledge this codebase cannot have: it
 * belongs to whoever wrote the template and had it approved. Getting it wrong
 * does not fail — it delivers a real message to a real applicant with the
 * tracking number where the date should be. So it is configuration, entered
 * once on the settings screen, and this is its shape.
 */

/**
 * Where a parameter's value comes from when the system fills it in.
 *
 * `manual` means there is no automatic source — someone types it. The rest
 * deliberately match the keys of the template context the CRM already builds
 * for email, so a WhatsApp parameter resolves through exactly the same lookup
 * as a `{{record_id}}` in an email body: one vocabulary, not two that drift.
 */
export const WHATSAPP_PARAM_SOURCE = {
  MANUAL: 'manual',
  APPLICANT_NAME: 'applicant_name',
  APPLICANT_FIRST_NAME: 'applicant_first_name',
  RECORD_CODE: 'record_id',
  RECORD_TITLE: 'record_title',
  CATEGORY: 'category',
  STATUS: 'status',
  PACKAGE_NAME: 'package_name',
  AMOUNT: 'amount',
  BALANCE_DUE: 'balance_due',
  DUE_DATE: 'due_date',
  INVOICE_NUMBER: 'invoice_number',
  CERTIFICATE_NUMBER: 'certificate_no',
  TRACKING_NUMBER: 'tracking_no',
  COURIER_PARTNER: 'courier_partner',
  MAGAZINE_NAME: 'magazine_name',
  ORGANISATION_NAME: 'organisation_name',
  SUPPORT_PHONE: 'support_phone',
  /**
   * Everything below is filled from the same record context as the entries
   * above and was simply never listed, so an operator whose approved template
   * asked for a tracking link or a due-date countdown had to type it by hand on
   * every send. The keys match `TemplateContext` exactly — that is what makes
   * them resolve.
   */
  APPLICANT_CODE: 'applicant_id',
  ASSIGNED_EMPLOYEE: 'assigned_employee',
  AMOUNT_PAID: 'amount_paid',
  DAYS_REMAINING: 'days_remaining',
  TRANSACTION_ID: 'transaction_id',
  CERTIFICATE_ISSUE_DATE: 'certificate_issue_date',
  TRACKING_URL: 'tracking_url',
  DISPATCH_DATE: 'dispatch_date',
  MAGAZINE_PAGE: 'magazine_page',
  ARTICLE_URL: 'article_url',
  SUPPORT_EMAIL: 'support_email',
  TODAY: 'today',
} as const;

export type WhatsAppParamSource =
  (typeof WHATSAPP_PARAM_SOURCE)[keyof typeof WHATSAPP_PARAM_SOURCE];

export const WHATSAPP_PARAM_SOURCE_LABELS: Readonly<Record<WhatsAppParamSource, string>> = {
  [WHATSAPP_PARAM_SOURCE.MANUAL]: 'Typed when sending',
  [WHATSAPP_PARAM_SOURCE.APPLICANT_NAME]: 'Applicant name',
  [WHATSAPP_PARAM_SOURCE.APPLICANT_FIRST_NAME]: 'Applicant first name',
  [WHATSAPP_PARAM_SOURCE.RECORD_CODE]: 'Record ID',
  [WHATSAPP_PARAM_SOURCE.RECORD_TITLE]: 'Record title',
  [WHATSAPP_PARAM_SOURCE.CATEGORY]: 'Category',
  [WHATSAPP_PARAM_SOURCE.STATUS]: 'Current status',
  [WHATSAPP_PARAM_SOURCE.PACKAGE_NAME]: 'Package name',
  [WHATSAPP_PARAM_SOURCE.AMOUNT]: 'Amount',
  [WHATSAPP_PARAM_SOURCE.BALANCE_DUE]: 'Balance due',
  [WHATSAPP_PARAM_SOURCE.DUE_DATE]: 'Payment due date',
  [WHATSAPP_PARAM_SOURCE.INVOICE_NUMBER]: 'Invoice number',
  [WHATSAPP_PARAM_SOURCE.CERTIFICATE_NUMBER]: 'Certificate number',
  [WHATSAPP_PARAM_SOURCE.TRACKING_NUMBER]: 'Tracking number',
  [WHATSAPP_PARAM_SOURCE.COURIER_PARTNER]: 'Courier',
  [WHATSAPP_PARAM_SOURCE.MAGAZINE_NAME]: 'Magazine name',
  [WHATSAPP_PARAM_SOURCE.ORGANISATION_NAME]: 'Organisation name',
  [WHATSAPP_PARAM_SOURCE.SUPPORT_PHONE]: 'Support phone',
  [WHATSAPP_PARAM_SOURCE.APPLICANT_CODE]: 'Applicant ID',
  [WHATSAPP_PARAM_SOURCE.ASSIGNED_EMPLOYEE]: 'Assigned employee',
  [WHATSAPP_PARAM_SOURCE.AMOUNT_PAID]: 'Amount paid',
  [WHATSAPP_PARAM_SOURCE.DAYS_REMAINING]: 'Days remaining until due',
  [WHATSAPP_PARAM_SOURCE.TRANSACTION_ID]: 'Transaction reference',
  [WHATSAPP_PARAM_SOURCE.CERTIFICATE_ISSUE_DATE]: 'Certificate issue date',
  [WHATSAPP_PARAM_SOURCE.TRACKING_URL]: 'Tracking link',
  [WHATSAPP_PARAM_SOURCE.DISPATCH_DATE]: 'Dispatch date',
  [WHATSAPP_PARAM_SOURCE.MAGAZINE_PAGE]: 'Magazine page number',
  [WHATSAPP_PARAM_SOURCE.ARTICLE_URL]: 'Article link',
  [WHATSAPP_PARAM_SOURCE.SUPPORT_EMAIL]: 'Support email',
  [WHATSAPP_PARAM_SOURCE.TODAY]: "Today's date",
};

/** Which provider actually carries the message. */
export const WHATSAPP_PROVIDER = {
  /** Meta Cloud API directly. Free text only, inside a 24-hour session. */
  META: 'meta',
  /** AiSensy. Approved templates, so business-initiated messages arrive. */
  AISENSY: 'aisensy',
} as const;

export type WhatsAppProvider = (typeof WHATSAPP_PROVIDER)[keyof typeof WHATSAPP_PROVIDER];

export const whatsappTemplateParamSchema = z.object({
  /** Stable key; doubles as the form field name on a manual send. */
  key: z.string().trim().min(1).max(60),
  /** What the person filling this in is being asked for. */
  label: z.string().trim().max(120).default(''),
  source: z.nativeEnum(WHATSAPP_PARAM_SOURCE).default(WHATSAPP_PARAM_SOURCE.MANUAL),
});

export type WhatsAppTemplateParam = z.infer<typeof whatsappTemplateParamSchema>;

export const whatsappTemplateSchema = z.object({
  id: z.string().trim().min(1).max(60),
  /** The friendly name shown wherever a template is chosen. */
  label: z.string().trim().min(1).max(120),
  /** The AiSensy campaign name. Must match the campaign exactly. */
  campaignName: z.string().trim().min(1).max(200),
  description: z.string().trim().max(500).optional(),
  /**
   * Ordered. Position is meaning: the first entry fills `{{1}}`, the second
   * `{{2}}`. Reordering changes what the applicant reads.
   */
  params: z.array(whatsappTemplateParamSchema).max(20).default([]),
  /**
   * The CRM template code this answers, so an existing send path can pick the
   * right approved template. Null for templates only ever sent by hand.
   */
  templateCode: z.string().trim().max(40).nullable().default(null),
  isActive: z.boolean().default(true),
});

export type WhatsAppTemplate = z.infer<typeof whatsappTemplateSchema>;

/** The whole registry, as stored in one settings row. */
export const whatsappRegistrySchema = z.array(whatsappTemplateSchema).max(100);

/**
 * Turn named values into the positional array the provider expects.
 *
 * A parameter with no value becomes an empty string rather than being dropped:
 * dropping it would shift every later value one place left, putting the wrong
 * text in front of an applicant, which is worse than a visible gap.
 */
export function buildWhatsAppParams(
  template: Pick<WhatsAppTemplate, 'params'>,
  values: Readonly<Record<string, string | number | null | undefined>>,
): string[] {
  return template.params.map((param) => {
    const value = values[param.key] ?? values[param.source];
    return value === null || value === undefined ? '' : String(value);
  });
}
