import { describe, expect, it } from 'vitest';
import { DEFAULT_TEMPLATES, TEMPLATE_CHANNEL } from '../constants/templates';
import type { EmailDocument } from '../constants/email-blocks';
import { editableStrings, renderEmail, renderEmailShell, toPlainText } from '../utils/email-layout';

const ORG = 'National Book of Records';

function doc(overrides: Partial<EmailDocument> = {}): EmailDocument {
  return {
    heading: 'Heading',
    blocks: [{ type: 'paragraph', text: 'Body text' }],
    ...overrides,
  };
}

describe('renderEmailShell', () => {
  it('wraps content in the website’s navy header and orange rule', () => {
    const html = renderEmailShell(doc(), ORG);

    expect(html).toContain('<!DOCTYPE html>');
    // The two brand colours the public site's mail is built from.
    expect(html).toContain('#02182b');
    expect(html).toContain('#f97316');
    expect(html).toContain('Heading');
    expect(html).toContain(ORG);
  });

  it('omits the strapline entirely when there is none', () => {
    // An empty <p> would still occupy vertical space in the header.
    expect(renderEmailShell(doc(), ORG)).not.toContain('rgba(255,255,255,0.6)');
    expect(renderEmailShell(doc({ subheading: 'Under review' }), ORG)).toContain('Under review');
  });
});

describe('escaping', () => {
  it('renders a name containing markup as text, not as a tag', () => {
    const { html } = renderEmail(
      doc({ blocks: [{ type: 'paragraph', text: '{{applicant_name}}' }] }),
      { applicant_name: '<script>alert(1)</script>' },
      ORG,
    );

    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('neutralises an attribute-breaking record title', () => {
    const { html } = renderEmail(
      doc({ blocks: [{ type: 'paragraph', text: '{{record_title}}' }] }),
      { record_title: '"><img src=x onerror=alert(1)>' },
      ORG,
    );

    // The payload survives as visible text but opens no tag, so the handler
    // inside it is inert.
    expect(html).toContain('&quot;&gt;&lt;img');
    expect(html).not.toMatch(/<img/i);
  });

  it('escapes every editable area, not just paragraphs', () => {
    // Each area gets a distinct marker, so a field that skipped escaping is
    // named by the failure rather than shifting an opaque count.
    const document = doc({
      heading: '<b>heading</b>',
      subheading: '<b>subheading</b>',
      signoff: '<b>signoff</b>',
      blocks: [
        {
          type: 'highlight',
          label: '<b>hlabel</b>',
          value: '<b>hvalue</b>',
          caption: '<b>hcaption</b>',
        },
        {
          type: 'details',
          title: '<b>dtitle</b>',
          rows: [{ label: '<b>drow</b>', value: '<b>dvalue</b>' }],
        },
        {
          type: 'steps',
          title: '<b>stitle</b>',
          items: [{ title: '<b>sitem</b>', text: '<b>stext</b>' }],
        },
        { type: 'note', text: '<b>note</b>' },
      ],
    });

    const { html } = renderEmail(document, {}, ORG);

    expect(html).not.toMatch(/<b>/);

    for (const area of editableStrings(document)) {
      const marker = area.replace(/<b>|<\/b>/g, '');
      expect(html, `${marker} was not escaped`).toContain(`&lt;b&gt;${marker}&lt;/b&gt;`);
    }
  });
});

describe('button links', () => {
  it('keeps an https link', () => {
    const { html } = renderEmail(
      doc({ blocks: [{ type: 'button', label: 'Track', url: 'https://example.com/t' }] }),
      {},
      ORG,
    );

    expect(html).toContain('href="https://example.com/t"');
  });

  it('drops a javascript: link rather than emitting it', () => {
    const { html } = renderEmail(
      doc({ blocks: [{ type: 'button', label: 'Track', url: 'javascript:alert(1)' }] }),
      {},
      ORG,
    );

    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('Track');
  });

  it('drops a link whose placeholder resolved to something unsafe', () => {
    // The URL is only known after the record's data is substituted in, so the
    // check has to survive that step rather than run before it.
    const { html } = renderEmail(
      doc({ blocks: [{ type: 'button', label: 'Track', url: '{{tracking_url}}' }] }),
      { tracking_url: 'javascript:alert(1)' },
      ORG,
    );

    expect(html).not.toContain('javascript:');
  });
});

describe('placeholders', () => {
  it('reports fields that resolved to nothing', () => {
    const { missing } = renderEmail(
      doc({
        blocks: [
          { type: 'paragraph', text: '{{applicant_name}}' },
          { type: 'highlight', label: 'Cert', value: '{{certificate_no}}' },
        ],
      }),
      { applicant_name: 'Ananya' },
      ORG,
    );

    expect(missing).toEqual(['certificate_no']);
  });

  it('collects every editable string for validation', () => {
    const strings = editableStrings(
      doc({
        subheading: 'sub',
        signoff: 'bye',
        blocks: [{ type: 'button', label: 'Go', url: 'https://x.test' }],
      }),
    );

    expect(strings).toContain('sub');
    expect(strings).toContain('bye');
    expect(strings).toContain('Go');
    expect(strings).toContain('https://x.test');
  });
});

describe('plain-text alternative', () => {
  it('carries the content of every block', () => {
    const text = toPlainText(
      doc({
        blocks: [
          { type: 'paragraph', text: 'Hello' },
          { type: 'highlight', label: 'ID', value: 'NBRAP1' },
          { type: 'details', title: 'Details', rows: [{ label: 'Category', value: 'Arts' }] },
          { type: 'steps', title: 'Next', items: [{ title: 'Review', text: 'We check it' }] },
          { type: 'button', label: 'Track', url: 'https://x.test' },
        ],
      }),
      ORG,
    );

    expect(text).toContain('Hello');
    expect(text).toContain('ID: NBRAP1');
    expect(text).toContain('Category: Arts');
    expect(text).toContain('1. Review — We check it');
    expect(text).toContain('Track: https://x.test');
    expect(text).toContain(ORG);
    // Nothing that only makes sense with styling attached.
    expect(text).not.toContain('<');
  });
});

describe('the shipped templates', () => {
  const emails = DEFAULT_TEMPLATES.filter((t) => t.channel === TEMPLATE_CHANNEL.EMAIL);

  it('all carry content areas rather than a text body', () => {
    expect(emails.length).toBeGreaterThan(0);
    for (const template of emails) {
      expect(template.document, `${template.code} has no document`).toBeDefined();
      expect(template.body, `${template.code} should not hand-maintain a body`).toBeUndefined();
    }
  });

  it('reference only fields the renderer knows', () => {
    // A placeholder nobody resolves reaches the applicant as a blank, so the
    // shipped defaults must not contain one.
    const context = Object.fromEntries(
      emails
        .flatMap((t) => editableStrings(t.document!))
        .flatMap((s) => [...s.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)])
        .map((m) => [m[1]!.toLowerCase(), 'x']),
    );

    for (const template of emails) {
      const { missing } = renderEmail(template.document!, context, ORG);
      expect(missing, `${template.code} has unresolved fields`).toEqual([]);
    }
  });

  it('WhatsApp templates stay plain text', () => {
    for (const template of DEFAULT_TEMPLATES.filter(
      (t) => t.channel === TEMPLATE_CHANNEL.WHATSAPP,
    )) {
      expect(template.body, `${template.code} needs a message`).toBeTruthy();
      expect(template.document, `${template.code} must not carry HTML areas`).toBeUndefined();
    }
  });
});
