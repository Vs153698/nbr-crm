import { renderTemplate, type EmailBlock, type EmailDocument, type TemplateContext } from '@nbr/shared';

/**
 * Example details for the template preview.
 *
 * A template belongs to no applicant, so a preview has nothing real to fill
 * itself with. Leaving the placeholders visible would show `{{amount}}` where
 * the recipient sees `4,500` — which is exactly the kind of thing an Admin
 * needs to judge the spacing and line breaks of.
 *
 * Obviously fictional on purpose: a preview that looked like a real applicant
 * would eventually be mistaken for one.
 */
export const SAMPLE_CONTEXT: TemplateContext = {
  applicant_name: 'Ananya Sharma',
  applicant_first_name: 'Ananya',
  applicant_id: 'NBRAP12548',
  record_id: 'NBRR08921',
  record_title: 'Longest continuous Bharatanatyam performance by a solo dancer',
  category: 'Performing Arts',
  status: 'Approved',
  assigned_employee: 'Rahul Verma',
  package_name: 'Gold Package',
  amount: '11,800',
  amount_paid: '5,000',
  balance_due: '6,800',
  due_date: '30 September 2026',
  days_remaining: '12',
  invoice_number: 'INV-2026-0417',
  transaction_id: 'TXN8842019773',
  certificate_no: 'NBR-2026-PA-40218',
  certificate_issue_date: '18 September 2026',
  courier_partner: 'Blue Dart',
  tracking_no: 'BD449021785IN',
  tracking_url: 'https://www.bluedart.com/tracking',
  dispatch_date: '20 September 2026',
  magazine_name: 'NBR Achievers Quarterly',
  magazine_page: '34',
  article_url: 'https://nationalbookofrecords.org/features/ananya-sharma',
  organisation_name: 'National Book of Records',
  support_email: 'support@nationalbookofrecords.org',
  support_phone: '+91 90000 00000',
  today: '18 September 2026',
};

/** Resolve every editable string in a document against the example details. */
export function fillDocument(document: EmailDocument): EmailDocument {
  const fill = (value: string): string => renderTemplate(value, SAMPLE_CONTEXT).output;

  const blocks = document.blocks.map((block): EmailBlock => {
    switch (block.type) {
      case 'paragraph':
        return { type: 'paragraph', text: fill(block.text) };
      case 'note':
        return { type: 'note', text: fill(block.text) };
      case 'highlight':
        return {
          type: 'highlight',
          label: fill(block.label),
          value: fill(block.value),
          caption: block.caption ? fill(block.caption) : undefined,
        };
      case 'details':
        return {
          type: 'details',
          title: block.title ? fill(block.title) : undefined,
          rows: block.rows.map((row) => ({ label: fill(row.label), value: fill(row.value) })),
        };
      case 'steps':
        return {
          type: 'steps',
          title: fill(block.title),
          items: block.items.map((item) => ({ title: fill(item.title), text: fill(item.text) })),
        };
      case 'button':
        return { type: 'button', label: fill(block.label), url: fill(block.url) };
    }
  });

  return {
    heading: fill(document.heading),
    subheading: document.subheading ? fill(document.subheading) : undefined,
    blocks,
    signoff: document.signoff ? fill(document.signoff) : undefined,
  };
}
