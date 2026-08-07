import type { EmailBlock, EmailDocument } from '../constants/email-blocks';
import { renderTemplate, type TemplateContext } from './template';

/**
 * The public website's email design, reproduced exactly.
 *
 * An applicant must not be able to tell which system sent the mail. The
 * website's `backend/src/lib/email.ts` builds these documents by hand; this is
 * the same markup expressed once, so the two cannot drift apart the next time
 * either side is reworded.
 *
 * Everything here is table-based with inline styles, which looks archaic and is
 * correct: Outlook renders through Word's HTML engine, which ignores most of
 * flexbox, grid and `<style>` blocks entirely.
 */

/** Navy of the header, and the orange the brand accents with. */
const COLOR = {
  navyFrom: '#02182b',
  navyTo: '#0b2746',
  orange: '#f97316',
  orangeDeep: '#ea580c',
  page: '#f1f5f9',
  ink: '#1e293b',
  inkSoft: '#475569',
  inkFaint: '#94a3b8',
  line: '#e2e8f0',
} as const;

/**
 * Escape before interpolation.
 *
 * Every value reaching the markup passes through here. Applicant names, record
 * titles and admin-written copy are all untrusted for this purpose: a title
 * containing `<` would otherwise break the document, and a crafted one could
 * inject markup into a message the organisation signs its name to.
 */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Only ever emit links we would follow ourselves.
 *
 * A button URL is Admin-editable and lands in an `href`, so `javascript:` and
 * `data:` are refused outright rather than escaped — an unclickable button is a
 * visible bug, while a scripted one is a live vulnerability.
 */
function safeUrl(url: string): string | null {
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) ? esc(trimmed) : null;
}

/** Preserve the paragraph breaks an Admin typed, without allowing markup. */
function escMultiline(value: string): string {
  return esc(value).replace(/\r?\n/g, '<br/>');
}

function renderBlock(block: EmailBlock): string {
  switch (block.type) {
    case 'paragraph':
      return `
          <p style="margin:0 0 24px;color:${COLOR.inkSoft};font-size:15px;line-height:1.7;">
            ${escMultiline(block.text)}
          </p>`;

    case 'highlight':
      return `
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:32px;">
            <tr>
              <td style="background:linear-gradient(135deg,#fff7ed,#ffedd5);border:2px solid #fed7aa;border-radius:12px;padding:24px;text-align:center;">
                <p style="margin:0 0 6px;color:#92400e;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;">${esc(block.label)}</p>
                <p style="margin:0;color:#c2410c;font-size:28px;font-weight:800;letter-spacing:0.08em;font-family:'Courier New',monospace;">${esc(block.value)}</p>
                ${block.caption ? `<p style="margin:8px 0 0;color:#b45309;font-size:12px;">${esc(block.caption)}</p>` : ''}
              </td>
            </tr>
          </table>`;

    case 'details':
      return `
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:32px;border-radius:12px;overflow:hidden;border:1px solid ${COLOR.line};">
            ${
              block.title
                ? `<tr><td style="background:#f8fafc;padding:12px 20px;border-bottom:1px solid ${COLOR.line};">
              <p style="margin:0;color:#64748b;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">${esc(block.title)}</p>
            </td></tr>`
                : ''
            }
            ${block.rows
              .map(
                (row, index) => `<tr><td style="padding:12px 20px;${
                  index === block.rows.length - 1 ? '' : 'border-bottom:1px solid #f1f5f9;'
                }">
              <table role="presentation" width="100%"><tr>
                <td width="140"><p style="margin:0;color:${COLOR.inkFaint};font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">${esc(row.label)}</p></td>
                <td><p style="margin:0;color:${COLOR.ink};font-size:14px;font-weight:600;">${esc(row.value)}</p></td>
              </tr></table>
            </td></tr>`,
              )
              .join('')}
          </table>`;

    case 'steps': {
      // The website cycles these three accents in order; matching it keeps a
      // three-step message pixel-identical to the one the site sends.
      const dots = ['#0ea5e9', '#6366f1', '#16a34a'];

      return `
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:32px;">
            <tr><td style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:12px;padding:24px;">
              <p style="margin:0 0 16px;color:#0369a1;font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">${esc(block.title)}</p>
              ${block.items
                .map(
                  (item, index) => `<table role="presentation" width="100%" style="${
                    index === block.items.length - 1 ? '' : 'margin-bottom:12px;'
                  }"><tr>
                <td width="36" valign="top"><div style="width:28px;height:28px;background:${dots[index % dots.length]};border-radius:50%;text-align:center;line-height:28px;color:#fff;font-size:12px;font-weight:800;">${index + 1}</div></td>
                <td style="padding-left:12px;" valign="top">
                  <p style="margin:0 0 2px;color:${COLOR.ink};font-size:13px;font-weight:700;">${esc(item.title)}</p>
                  <p style="margin:0;color:#64748b;font-size:12px;line-height:1.5;">${esc(item.text)}</p>
                </td>
              </tr></table>`,
                )
                .join('')}
            </td></tr>
          </table>`;
    }

    case 'button': {
      const href = safeUrl(block.url);
      if (!href) return '';

      return `
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:32px;">
            <tr><td align="center">
              <a href="${href}" style="display:inline-block;background:linear-gradient(135deg,${COLOR.orange},${COLOR.orangeDeep});color:#ffffff;font-size:14px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;text-decoration:none;padding:14px 36px;border-radius:10px;">
                ${esc(block.label)}
              </a>
            </td></tr>
          </table>`;
    }

    case 'note':
      return `
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:8px;">
            <tr><td style="background:#fafafa;border-left:3px solid ${COLOR.orange};border-radius:0 8px 8px 0;padding:16px 20px;">
              <p style="margin:0;color:${COLOR.inkSoft};font-size:13px;line-height:1.6;">
                ${escMultiline(block.text)}
              </p>
            </td></tr>
          </table>`;
  }
}

/**
 * Wrap rendered blocks in the website's shell.
 *
 * Exported separately from `renderEmailHtml` so the editor can preview a
 * document that has not been saved, and so the preview and the real send go
 * through one function rather than two that agree by coincidence.
 */
export function renderEmailShell(document: EmailDocument, organisationName: string): string {
  const year = new Date().getFullYear();
  const body = document.blocks.map(renderBlock).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:${COLOR.page};font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${COLOR.page};padding:40px 0;">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;width:100%;">
      <tr>
        <td style="background:linear-gradient(135deg,${COLOR.navyFrom} 0%,${COLOR.navyTo} 100%);border-radius:16px 16px 0 0;padding:40px 48px 36px;">
          <div style="display:inline-block;background:${COLOR.orange};border-radius:10px;padding:10px 14px;margin-bottom:20px;">
            <span style="color:#ffffff;font-size:13px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;">${esc(organisationName)}</span>
          </div>
          <h1 style="margin:0 0 8px;color:#ffffff;font-size:26px;font-weight:800;line-height:1.2;">${esc(document.heading)}</h1>
          ${document.subheading ? `<p style="margin:0;color:rgba(255,255,255,0.6);font-size:14px;">${esc(document.subheading)}</p>` : ''}
        </td>
      </tr>
      <tr><td style="background:${COLOR.orange};height:4px;font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr>
        <td style="background:#ffffff;padding:40px 48px;">${body}
          <p style="margin:24px 0 0;color:${COLOR.inkFaint};font-size:13px;line-height:1.6;">
            ${escMultiline(document.signoff ?? 'Warm regards,')}<br/>
            <strong style="color:${COLOR.navyFrom};">${esc(organisationName)}</strong>
          </p>
        </td>
      </tr>
      <tr>
        <td style="background:#f8fafc;border-radius:0 0 16px 16px;padding:20px 48px;border-top:1px solid ${COLOR.line};">
          <p style="margin:0;color:#9ca3af;font-size:11px;line-height:1.6;">
            © ${year} ${esc(organisationName)}
          </p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

/**
 * Every Admin-editable string in a document, flattened.
 *
 * Used to validate placeholders at save time. A typo inside a highlighted
 * value or a button label breaks the send exactly as one in a paragraph does,
 * so checking only the prose would let the worst cases through.
 */
export function editableStrings(document: EmailDocument): string[] {
  const strings: string[] = [document.heading];
  if (document.subheading) strings.push(document.subheading);
  if (document.signoff) strings.push(document.signoff);

  for (const block of document.blocks) {
    switch (block.type) {
      case 'paragraph':
      case 'note':
        strings.push(block.text);
        break;
      case 'highlight':
        strings.push(block.label, block.value);
        if (block.caption) strings.push(block.caption);
        break;
      case 'details':
        if (block.title) strings.push(block.title);
        for (const row of block.rows) strings.push(row.label, row.value);
        break;
      case 'steps':
        strings.push(block.title);
        for (const item of block.items) strings.push(item.title, item.text);
        break;
      case 'button':
        strings.push(block.label, block.url);
        break;
    }
  }

  return strings;
}

/** Placeholders resolved across every editable string in the document. */
function resolveDocument(
  document: EmailDocument,
  context: TemplateContext,
): { document: EmailDocument; missing: string[] } {
  const missing = new Set<string>();

  const fill = (value: string): string => {
    const result = renderTemplate(value, context);
    for (const name of result.missing) missing.add(name);
    return result.output;
  };

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
    document: {
      heading: fill(document.heading),
      subheading: document.subheading ? fill(document.subheading) : undefined,
      blocks,
      signoff: document.signoff ? fill(document.signoff) : undefined,
    },
    missing: [...missing],
  };
}

export interface RenderedEmail {
  readonly html: string;
  /** Plain-text alternative, and what the communication history stores. */
  readonly text: string;
  /** Placeholders that resolved to nothing, so the send modal can warn first. */
  readonly missing: readonly string[];
}

/**
 * Render a template document against an applicant's data.
 *
 * The single entry point for both preview and send. A preview produced by any
 * other path would be a promise the send does not have to keep.
 */
export function renderEmail(
  document: EmailDocument,
  context: TemplateContext,
  organisationName: string,
): RenderedEmail {
  const resolved = resolveDocument(document, context);

  return {
    html: renderEmailShell(resolved.document, organisationName),
    text: toPlainText(resolved.document, organisationName),
    missing: resolved.missing,
  };
}

/**
 * Plain-text alternative.
 *
 * Not a stripped copy of the HTML: text-only clients, and the communication
 * history an employee reads back, both deserve something written for them.
 */
export function toPlainText(document: EmailDocument, organisationName: string): string {
  const parts: string[] = [document.heading];
  if (document.subheading) parts.push(document.subheading);

  for (const block of document.blocks) {
    switch (block.type) {
      case 'paragraph':
      case 'note':
        parts.push(block.text);
        break;
      case 'highlight':
        parts.push(`${block.label}: ${block.value}${block.caption ? `\n${block.caption}` : ''}`);
        break;
      case 'details':
        parts.push(
          [
            block.title,
            ...block.rows.map((row) => `${row.label}: ${row.value}`),
          ]
            .filter(Boolean)
            .join('\n'),
        );
        break;
      case 'steps':
        parts.push(
          [
            block.title,
            ...block.items.map((item, index) => `${index + 1}. ${item.title} — ${item.text}`),
          ].join('\n'),
        );
        break;
      case 'button':
        parts.push(`${block.label}: ${block.url}`);
        break;
    }
  }

  parts.push(`${document.signoff ?? 'Warm regards,'}\n${organisationName}`);
  return parts.join('\n\n');
}
