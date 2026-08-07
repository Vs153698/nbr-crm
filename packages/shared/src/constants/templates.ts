/**
 * Email (§7) and WhatsApp (§8) templates.
 *
 * Bodies live in the `templates` table so Admins can reword them without a
 * deploy; the codes and the dynamic-field vocabulary are compiled in because
 * the renderer validates every placeholder against this list before sending.
 */

import type { EmailDocument } from './email-blocks';

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
  /**
   * Plain text. The message itself for WhatsApp; for email it is only the text
   * alternative, generated from `document` rather than typed.
   */
  readonly body?: string;
  /** Email only — the areas that render into the website's layout. */
  readonly document?: EmailDocument;
}

export const DEFAULT_TEMPLATES: readonly TemplateSeed[] = [
  {
    code: TEMPLATE_CODE.SELECTION,
    channel: TEMPLATE_CHANNEL.EMAIL,
    name: 'Selection',
    subject: 'Congratulations! Your record has been approved — {{organisation_name}}',
    document: {
      heading: 'Your record has been approved! 🎉',
      subheading: 'Reviewed and accepted by our expert panel',
      blocks: [
        { type: 'paragraph', text: 'Dear {{applicant_name}},' },
        {
          type: 'paragraph',
          text: 'We are delighted to tell you that your record attempt "{{record_title}}" has been officially approved by the National Book of Records review panel.',
        },
        {
          type: 'highlight',
          label: 'Your Application ID',
          value: '{{applicant_id}}',
          caption: 'Keep this ID safe for tracking your application status',
        },
        {
          type: 'details',
          title: 'Record details',
          rows: [
            { label: 'Record ID', value: '{{record_id}}' },
            { label: 'Category', value: '{{category}}' },
            { label: 'Approved on', value: '{{today}}' },
          ],
        },
        {
          type: 'steps',
          title: 'What happens next?',
          items: [
            {
              title: 'Choose your package',
              text: 'Our team will share the available packages and the fee for each.',
            },
            {
              title: 'Complete payment',
              text: 'Once the fee is received, we begin preparing your certificate.',
            },
            {
              title: 'Certificate and dispatch',
              text: 'Your certificate is issued and posted to you with tracking.',
            },
          ],
        },
        {
          type: 'note',
          text: 'Any questions in the meantime? Write to {{support_email}} or call {{support_phone}}, quoting your Application ID.',
        },
      ],
      signoff: 'Warm regards,',
    },
  },
  {
    code: TEMPLATE_CODE.REJECTION,
    channel: TEMPLATE_CHANNEL.EMAIL,
    name: 'Rejection',
    subject: 'Update on your record application — {{organisation_name}}',
    document: {
      heading: 'An update on your application',
      subheading: 'Our panel has completed its review',
      blocks: [
        { type: 'paragraph', text: 'Dear {{applicant_name}},' },
        {
          type: 'paragraph',
          text: 'Thank you for submitting your record attempt "{{record_title}}".',
        },
        {
          type: 'details',
          title: 'Application',
          rows: [
            { label: 'Application ID', value: '{{applicant_id}}' },
            { label: 'Record title', value: '{{record_title}}' },
          ],
        },
        {
          type: 'paragraph',
          text: 'After a careful review of the evidence provided, our panel is unable to approve this attempt at this time.',
        },
        {
          type: 'paragraph',
          text: 'You are very welcome to submit a fresh application with additional evidence — many successful records are accepted on a later attempt.',
        },
        {
          type: 'note',
          text: 'For guidance on what our reviewers look for, write to {{support_email}}.',
        },
      ],
      signoff: 'Warm regards,',
    },
  },
  {
    code: TEMPLATE_CODE.PAYMENT_REMINDER,
    channel: TEMPLATE_CHANNEL.EMAIL,
    name: 'Payment Reminder',
    subject: 'Reminder: ₹{{balance_due}} pending for your record entry',
    document: {
      heading: 'A gentle payment reminder',
      subheading: 'Your approved record is waiting on one last step',
      blocks: [
        { type: 'paragraph', text: 'Dear {{applicant_name}},' },
        {
          type: 'paragraph',
          text: 'This is a gentle reminder that payment is still pending against your approved record "{{record_title}}".',
        },
        {
          type: 'highlight',
          label: 'Amount outstanding',
          value: '₹{{balance_due}}',
          caption: 'Due by {{due_date}} — {{days_remaining}} days remaining',
        },
        {
          type: 'details',
          title: 'Payment details',
          rows: [
            { label: 'Package', value: '{{package_name}}' },
            { label: 'Total', value: '₹{{amount}}' },
            { label: 'Received', value: '₹{{amount_paid}}' },
            { label: 'Outstanding', value: '₹{{balance_due}}' },
          ],
        },
        {
          type: 'paragraph',
          text: 'Once payment is received, we will begin preparing your certificate straight away.',
        },
        {
          type: 'note',
          text: 'Already paid, or need help completing it? Write to {{support_email}} and we will sort it out.',
        },
      ],
      signoff: 'Warm regards,',
    },
  },
  {
    code: TEMPLATE_CODE.PAYMENT_CONFIRMATION,
    channel: TEMPLATE_CHANNEL.EMAIL,
    name: 'Payment Confirmation',
    subject: 'Payment received — invoice {{invoice_number}}',
    document: {
      heading: 'Payment received — thank you!',
      subheading: 'Your certificate is now being prepared',
      blocks: [
        { type: 'paragraph', text: 'Dear {{applicant_name}},' },
        {
          type: 'paragraph',
          text: 'We have received your payment against record "{{record_title}}". Thank you.',
        },
        {
          type: 'highlight',
          label: 'Amount received',
          value: '₹{{amount_paid}}',
          caption: 'Received on {{today}}',
        },
        {
          type: 'details',
          title: 'Receipt',
          rows: [
            { label: 'Invoice', value: '{{invoice_number}}' },
            { label: 'Transaction', value: '{{transaction_id}}' },
            { label: 'Record', value: '{{record_title}}' },
          ],
        },
        {
          type: 'paragraph',
          text: 'We will notify you as soon as your certificate is ready to dispatch.',
        },
      ],
      signoff: 'Warm regards,',
    },
  },
  {
    code: TEMPLATE_CODE.CERTIFICATE_READY,
    channel: TEMPLATE_CHANNEL.EMAIL,
    name: 'Certificate Ready',
    subject: 'Your certificate {{certificate_no}} is ready',
    document: {
      heading: 'Your certificate has been issued 🏆',
      subheading: 'Officially recorded in the National Book of Records',
      blocks: [
        { type: 'paragraph', text: 'Dear {{applicant_name}},' },
        {
          type: 'paragraph',
          text: 'Your National Book of Records certificate for "{{record_title}}" has been issued.',
        },
        {
          type: 'highlight',
          label: 'Certificate number',
          value: '{{certificate_no}}',
          caption: 'Issued on {{certificate_issue_date}}',
        },
        {
          type: 'paragraph',
          text: 'The hard copy will be dispatched shortly, and you will receive tracking details by email and WhatsApp as soon as it is on its way.',
        },
        {
          type: 'note',
          text: 'Questions about your certificate? Write to {{support_email}} quoting {{certificate_no}}.',
        },
      ],
      signoff: 'Warm regards,',
    },
  },
  {
    code: TEMPLATE_CODE.DISPATCH,
    channel: TEMPLATE_CHANNEL.EMAIL,
    name: 'Dispatch',
    subject: 'Your certificate has been dispatched — {{tracking_no}}',
    document: {
      heading: 'Your certificate is on its way 📦',
      subheading: 'Dispatched and trackable',
      blocks: [
        { type: 'paragraph', text: 'Dear {{applicant_name}},' },
        {
          type: 'paragraph',
          text: 'Your certificate and record memento have been dispatched.',
        },
        {
          type: 'highlight',
          label: 'Tracking number',
          value: '{{tracking_no}}',
          caption: 'Dispatched on {{dispatch_date}} via {{courier_partner}}',
        },
        {
          type: 'details',
          title: 'Dispatch details',
          rows: [
            { label: 'Courier', value: '{{courier_partner}}' },
            { label: 'Tracking no.', value: '{{tracking_no}}' },
            { label: 'Dispatched', value: '{{dispatch_date}}' },
          ],
        },
        { type: 'button', label: 'Track your delivery', url: '{{tracking_url}}' },
        {
          type: 'note',
          text: 'If your parcel has not arrived within the expected window, write to {{support_email}} and we will chase it for you.',
        },
      ],
      signoff: 'Warm regards,',
    },
  },
  {
    code: TEMPLATE_CODE.CONGRATULATIONS,
    channel: TEMPLATE_CHANNEL.EMAIL,
    name: 'Congratulations',
    subject: 'Welcome to the National Book of Records, {{applicant_first_name}}!',
    document: {
      heading: 'Welcome to the National Book of Records! 🎉',
      subheading: 'Your achievement is now part of the record',
      blocks: [
        { type: 'paragraph', text: 'Dear {{applicant_name}},' },
        {
          type: 'paragraph',
          text: 'Congratulations once again on "{{record_title}}" — you are now formally part of the National Book of Records.',
        },
        {
          type: 'details',
          title: 'Your record',
          rows: [
            { label: 'Certificate', value: '{{certificate_no}}' },
            { label: 'Featured in', value: '{{magazine_name}}, page {{magazine_page}}' },
            { label: 'Category', value: '{{category}}' },
          ],
        },
        { type: 'button', label: 'Read your feature', url: '{{article_url}}' },
        {
          type: 'paragraph',
          text: 'Thank you for letting us be part of your achievement.',
        },
      ],
      signoff: 'Warm regards,',
    },
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
