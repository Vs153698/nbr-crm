/**
 * Email (§7) and WhatsApp (§8) templates.
 *
 * Bodies live in the `templates` table so Admins can reword them without a
 * deploy; the codes and the dynamic-field vocabulary are compiled in because
 * the renderer validates every placeholder against this list before sending.
 */

export const TEMPLATE_CHANNEL = {
  EMAIL: 'email',
  WHATSAPP: 'whatsapp',
} as const;

export type TemplateChannel = (typeof TEMPLATE_CHANNEL)[keyof typeof TEMPLATE_CHANNEL];

export const TEMPLATE_CODE = {
  SELECTION: 'selection',
  REJECTION: 'rejection',
  PAYMENT_REMINDER: 'payment_reminder',
  PAYMENT_CONFIRMATION: 'payment_confirmation',
  CERTIFICATE_READY: 'certificate_ready',
  DISPATCH: 'dispatch',
  CONGRATULATIONS: 'congratulations',
} as const;

export type TemplateCode = (typeof TEMPLATE_CODE)[keyof typeof TEMPLATE_CODE];

/** §7 lists 7 email templates; §8 lists 6 WhatsApp templates (no rejection). */
export const EMAIL_TEMPLATE_CODES: readonly TemplateCode[] = [
  TEMPLATE_CODE.SELECTION,
  TEMPLATE_CODE.REJECTION,
  TEMPLATE_CODE.PAYMENT_REMINDER,
  TEMPLATE_CODE.PAYMENT_CONFIRMATION,
  TEMPLATE_CODE.CERTIFICATE_READY,
  TEMPLATE_CODE.DISPATCH,
  TEMPLATE_CODE.CONGRATULATIONS,
];

export const WHATSAPP_TEMPLATE_CODES: readonly TemplateCode[] = [
  TEMPLATE_CODE.SELECTION,
  TEMPLATE_CODE.PAYMENT_REMINDER,
  TEMPLATE_CODE.PAYMENT_CONFIRMATION,
  TEMPLATE_CODE.CERTIFICATE_READY,
  TEMPLATE_CODE.DISPATCH,
  TEMPLATE_CODE.CONGRATULATIONS,
];

/**
 * The codes above are *system* templates: the Smart Workflow Engine names them
 * directly (`email:selection`, `whatsapp:payment_reminder`), so a stage action
 * would silently lose its message if one were renamed or removed.
 *
 * Anything else is a custom template — an Admin's own wording for a situation
 * the workflow does not model, selectable when composing a message by hand.
 * Both kinds live in the same table and render through the same placeholder
 * validation; only deletability differs.
 */
const SYSTEM_TEMPLATE_CODES: ReadonlySet<string> = new Set(Object.values(TEMPLATE_CODE));

export function isSystemTemplateCode(code: string): boolean {
  return SYSTEM_TEMPLATE_CODES.has(code);
}

/**
 * Shape of a template code.
 *
 * Slug-like rather than free text because the code is an identifier the
 * workflow and the API both address templates by — spaces and punctuation there
 * would make `email:my template!` ambiguous.
 */
export const TEMPLATE_CODE_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;

/**
 * Dynamic fields usable in any template as `{{field}}`. The renderer resolves
 * them from the record graph; a template referencing anything not listed here
 * fails validation at save time rather than at send time.
 */
export const TEMPLATE_VARIABLES = {
  applicant_name: 'Applicant full name',
  applicant_first_name: 'Applicant first name',
  applicant_id: 'Applicant ID (NBRAP…)',
  record_id: 'Record ID (NBRR…)',
  record_title: 'Record title',
  category: 'Record category',
  status: 'Current status label',
  assigned_employee: 'Assigned employee name',
  package_name: 'Payment package name',
  amount: 'Final payable amount (₹)',
  amount_paid: 'Amount received so far (₹)',
  balance_due: 'Outstanding balance (₹)',
  due_date: 'Payment due date',
  days_remaining: 'Days remaining until the payment due date',
  invoice_number: 'Invoice number',
  transaction_id: 'Latest transaction ID',
  certificate_no: 'Certificate number',
  certificate_issue_date: 'Certificate issue date',
  courier_partner: 'Courier partner name',
  tracking_no: 'Courier tracking number',
  tracking_url: 'Courier tracking URL',
  dispatch_date: 'Dispatch date',
  magazine_name: 'Magazine name',
  magazine_page: 'Magazine page number',
  article_url: 'Published article link',
  organisation_name: 'National Book of Records',
  support_email: 'Support email address',
  support_phone: 'Support phone number',
  today: "Today's date",
} as const;

export type TemplateVariable = keyof typeof TEMPLATE_VARIABLES;

export const TEMPLATE_VARIABLE_NAMES = Object.keys(TEMPLATE_VARIABLES) as TemplateVariable[];

/** Matches `{{ variable }}` with optional surrounding whitespace. */
export const TEMPLATE_PLACEHOLDER_RE = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

export interface TemplateSeed {
  readonly code: TemplateCode;
  readonly channel: TemplateChannel;
  readonly name: string;
  readonly subject: string | null;
  readonly body: string;
}

export const DEFAULT_TEMPLATES: readonly TemplateSeed[] = [
  {
    code: TEMPLATE_CODE.SELECTION,
    channel: TEMPLATE_CHANNEL.EMAIL,
    name: 'Selection',
    subject: 'Congratulations! Your record has been approved — {{organisation_name}}',
    body: `Dear {{applicant_name}},

We are delighted to inform you that your record attempt "{{record_title}}" (Application ID {{applicant_id}}, Record ID {{record_id}}) has been officially approved by the National Book of Records review panel.

To confirm your entry, the {{package_name}} fee of ₹{{amount}} is payable by {{due_date}}.

Our team will reach out with the next steps. If you have any questions, write to {{support_email}} or call {{support_phone}}.

Warm regards,
{{organisation_name}}`,
  },
  {
    code: TEMPLATE_CODE.REJECTION,
    channel: TEMPLATE_CHANNEL.EMAIL,
    name: 'Rejection',
    subject: 'Update on your record application — {{organisation_name}}',
    body: `Dear {{applicant_name}},

Thank you for submitting your record attempt "{{record_title}}" (Application ID {{applicant_id}}).

After a careful review of the evidence provided, our panel is unable to approve this attempt at this time.

You are welcome to submit a fresh application with additional evidence. For guidance on what our reviewers look for, write to {{support_email}}.

Warm regards,
{{organisation_name}}`,
  },
  {
    code: TEMPLATE_CODE.PAYMENT_REMINDER,
    channel: TEMPLATE_CHANNEL.EMAIL,
    name: 'Payment Reminder',
    subject: 'Reminder: ₹{{balance_due}} pending for your record entry',
    body: `Dear {{applicant_name}},

This is a gentle reminder that ₹{{balance_due}} is still pending against your approved record "{{record_title}}" ({{package_name}} — ₹{{amount}}).

Due date: {{due_date}} ({{days_remaining}} days remaining)

Once payment is received, we will begin preparing your certificate.

Warm regards,
{{organisation_name}}`,
  },
  {
    code: TEMPLATE_CODE.PAYMENT_CONFIRMATION,
    channel: TEMPLATE_CHANNEL.EMAIL,
    name: 'Payment Confirmation',
    subject: 'Payment received — invoice {{invoice_number}}',
    body: `Dear {{applicant_name}},

We have received your payment of ₹{{amount_paid}} against record "{{record_title}}".

Invoice number: {{invoice_number}}
Transaction ID: {{transaction_id}}

Your certificate is now being prepared. We will notify you as soon as it is ready.

Warm regards,
{{organisation_name}}`,
  },
  {
    code: TEMPLATE_CODE.CERTIFICATE_READY,
    channel: TEMPLATE_CHANNEL.EMAIL,
    name: 'Certificate Ready',
    subject: 'Your certificate {{certificate_no}} is ready',
    body: `Dear {{applicant_name}},

Your National Book of Records certificate for "{{record_title}}" has been issued.

Certificate number: {{certificate_no}}
Issue date: {{certificate_issue_date}}

The hard copy will be dispatched shortly and you will receive tracking details by email and WhatsApp.

Warm regards,
{{organisation_name}}`,
  },
  {
    code: TEMPLATE_CODE.DISPATCH,
    channel: TEMPLATE_CHANNEL.EMAIL,
    name: 'Dispatch',
    subject: 'Your certificate has been dispatched — {{tracking_no}}',
    body: `Dear {{applicant_name}},

Your certificate and record memento have been dispatched.

Courier: {{courier_partner}}
Tracking number: {{tracking_no}}
Dispatched on: {{dispatch_date}}
Track here: {{tracking_url}}

Warm regards,
{{organisation_name}}`,
  },
  {
    code: TEMPLATE_CODE.CONGRATULATIONS,
    channel: TEMPLATE_CHANNEL.EMAIL,
    name: 'Congratulations',
    subject: 'Welcome to the National Book of Records, {{applicant_first_name}}!',
    body: `Dear {{applicant_name}},

Congratulations once again on "{{record_title}}" — you are now formally part of the National Book of Records.

Certificate number: {{certificate_no}}
Featured in: {{magazine_name}}, page {{magazine_page}}
Read the article: {{article_url}}

Thank you for letting us be part of your achievement.

Warm regards,
{{organisation_name}}`,
  },

  // ── WhatsApp (click-to-chat, prefilled) ───────────────────────────────────
  {
    code: TEMPLATE_CODE.SELECTION,
    channel: TEMPLATE_CHANNEL.WHATSAPP,
    name: 'Selection',
    subject: null,
    body: `Congratulations {{applicant_first_name}}!

Your record attempt "{{record_title}}" has been APPROVED by the National Book of Records.

Application ID: {{applicant_id}}
Package: {{package_name}} — ₹{{amount}}
Payment due by: {{due_date}}

Our team will guide you through the next steps.
— {{organisation_name}}`,
  },
  {
    code: TEMPLATE_CODE.PAYMENT_REMINDER,
    channel: TEMPLATE_CHANNEL.WHATSAPP,
    name: 'Payment Reminder',
    subject: null,
    body: `Hello {{applicant_first_name}}, a gentle reminder from {{organisation_name}}.

₹{{balance_due}} is pending against your approved record "{{record_title}}".
Due date: {{due_date}} ({{days_remaining}} days left)

Reply here if you need any help completing the payment.`,
  },
  {
    code: TEMPLATE_CODE.PAYMENT_CONFIRMATION,
    channel: TEMPLATE_CHANNEL.WHATSAPP,
    name: 'Payment Confirmation',
    subject: null,
    body: `Payment received — thank you, {{applicant_first_name}}!

Amount: ₹{{amount_paid}}
Invoice: {{invoice_number}}
Record: {{record_title}}

Your certificate is now being prepared.
— {{organisation_name}}`,
  },
  {
    code: TEMPLATE_CODE.CERTIFICATE_READY,
    channel: TEMPLATE_CHANNEL.WHATSAPP,
    name: 'Certificate Ready',
    subject: null,
    body: `{{applicant_first_name}}, your certificate is ready!

Certificate no: {{certificate_no}}
Issued on: {{certificate_issue_date}}
Record: {{record_title}}

Dispatch details will follow shortly.
— {{organisation_name}}`,
  },
  {
    code: TEMPLATE_CODE.DISPATCH,
    channel: TEMPLATE_CHANNEL.WHATSAPP,
    name: 'Dispatch',
    subject: null,
    body: `Your certificate is on its way, {{applicant_first_name}}!

Courier: {{courier_partner}}
Tracking: {{tracking_no}}
Dispatched: {{dispatch_date}}
{{tracking_url}}

— {{organisation_name}}`,
  },
  {
    code: TEMPLATE_CODE.CONGRATULATIONS,
    channel: TEMPLATE_CHANNEL.WHATSAPP,
    name: 'Congratulations',
    subject: null,
    body: `Congratulations {{applicant_first_name}}!

"{{record_title}}" is now officially part of the National Book of Records.
Certificate no: {{certificate_no}}

Thank you for letting us be part of your achievement.
— {{organisation_name}}`,
  },
];
