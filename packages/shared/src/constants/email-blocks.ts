/**
 * The editable areas of an email, and nothing about how they are drawn.
 *
 * Kept in `constants` rather than beside the renderer because the default
 * templates reference these types, and the renderer reads the placeholder
 * vocabulary from the templates — putting the types with the renderer would
 * close that loop into an import cycle.
 */

/**
 * One area an Admin can place in an email.
 *
 * A closed set on purpose: an Admin writes the words inside a block and never
 * the markup around them. That is what keeps every message on-brand, and why
 * the template editor never has to show anyone HTML.
 */
export type EmailBlock =
  | { readonly type: 'paragraph'; readonly text: string }
  | {
      readonly type: 'highlight';
      readonly label: string;
      readonly value: string;
      readonly caption?: string;
    }
  | {
      readonly type: 'details';
      readonly title?: string;
      readonly rows: ReadonlyArray<{ readonly label: string; readonly value: string }>;
    }
  | {
      readonly type: 'steps';
      readonly title: string;
      readonly items: ReadonlyArray<{ readonly title: string; readonly text: string }>;
    }
  | { readonly type: 'button'; readonly label: string; readonly url: string }
  | { readonly type: 'note'; readonly text: string };

export type EmailBlockType = EmailBlock['type'];

/** One email template's editable content. */
export interface EmailDocument {
  /** Large white headline in the navy header. */
  readonly heading: string;
  /** Muted line beneath it. Optional — some messages need no strapline. */
  readonly subheading?: string;
  readonly blocks: ReadonlyArray<EmailBlock>;
  /** Closing line above the organisation name. */
  readonly signoff?: string;
}

/** Labels for the editor, so the UI never invents its own wording. */
export const EMAIL_BLOCK_META: Record<
  EmailBlockType,
  { readonly label: string; readonly hint: string }
> = {
  paragraph: { label: 'Paragraph', hint: 'A block of text.' },
  highlight: {
    label: 'Highlighted box',
    hint: 'An orange panel for one important value — an ID, a number, an amount.',
  },
  details: { label: 'Details table', hint: 'Label-and-value rows in a bordered box.' },
  steps: { label: 'Numbered steps', hint: 'A blue panel explaining what happens next.' },
  button: { label: 'Button', hint: 'An orange call-to-action linking somewhere.' },
  note: { label: 'Side note', hint: 'A quieter aside with an orange edge — support details.' },
};

export const EMAIL_BLOCK_TYPES = Object.keys(EMAIL_BLOCK_META) as EmailBlockType[];

/** A newly added block, pre-filled so the preview never shows empty furniture. */
export function blankEmailBlock(type: EmailBlockType): EmailBlock {
  switch (type) {
    case 'paragraph':
      return { type, text: '' };
    case 'highlight':
      return { type, label: 'Your Application ID', value: '{{applicant_id}}', caption: '' };
    case 'details':
      return { type, title: 'Details', rows: [{ label: '', value: '' }] };
    case 'steps':
      return { type, title: 'What happens next?', items: [{ title: '', text: '' }] };
    case 'button':
      return { type, label: 'View your record', url: 'https://' };
    case 'note':
      return { type, text: '' };
  }
}
