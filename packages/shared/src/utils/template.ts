import {
  TEMPLATE_PLACEHOLDER_RE,
  TEMPLATE_VARIABLE_NAMES,
  type TemplateVariable,
} from '../constants/templates';

export type TemplateContext = Partial<Record<TemplateVariable, string | number | null | undefined>>;

export interface RenderResult {
  readonly output: string;
  /** Placeholders that resolved to nothing — the send modal warns before sending. */
  readonly missing: readonly TemplateVariable[];
  /** Placeholders that aren't part of the supported vocabulary at all. */
  readonly unknown: readonly string[];
}

/**
 * Render `{{variable}}` placeholders against a context.
 *
 * Deliberately not a general-purpose template engine: no conditionals, no
 * loops, no arbitrary property access. A template is data an Admin can edit, so
 * the renderer must not be able to reach into anything the caller didn't
 * explicitly pass in.
 */
export function renderTemplate(body: string, context: TemplateContext): RenderResult {
  const missing = new Set<TemplateVariable>();
  const unknown = new Set<string>();

  const output = body.replace(TEMPLATE_PLACEHOLDER_RE, (match, rawName: string) => {
    const name = rawName.toLowerCase() as TemplateVariable;

    if (!TEMPLATE_VARIABLE_NAMES.includes(name)) {
      unknown.add(rawName);
      return match;
    }

    const value = context[name];
    if (value === null || value === undefined || value === '') {
      missing.add(name);
      return '';
    }
    return String(value);
  });

  return {
    output,
    missing: [...missing],
    unknown: [...unknown],
  };
}

/** Validate a template at save time so bad placeholders never reach send time. */
export function validateTemplate(body: string): { valid: boolean; unknown: string[] } {
  const unknown = new Set<string>();
  const matches = body.matchAll(new RegExp(TEMPLATE_PLACEHOLDER_RE.source, 'gi'));
  for (const match of matches) {
    const name = (match[1] ?? '').toLowerCase();
    if (!TEMPLATE_VARIABLE_NAMES.includes(name as TemplateVariable)) unknown.add(match[1] ?? '');
  }
  return { valid: unknown.size === 0, unknown: [...unknown] };
}

/**
 * Build a wa.me click-to-chat deep link with the rendered message prefilled.
 * Phase 1–2 uses this instead of the WhatsApp Business API (explicitly deferred
 * to a future phase); staff click through and then confirm "mark as sent".
 */
export function buildWhatsAppLink(e164Phone: string, message: string): string {
  const number = e164Phone.replace(/\D/g, '');
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}
