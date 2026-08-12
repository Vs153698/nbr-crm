import { describe, expect, it } from 'vitest';
import {
  letterBlocksFromHtml,
  letterBlocksToText,
  renderSelectionLetter,
  SELECTION_KIND,
  type SelectionLetterInput,
  type SelectionLetterOrganisation,
} from '../utils/selection-letter';

const ORGANISATION: SelectionLetterOrganisation = {
  name: 'National Book of Records',
  supportEmail: 'support@nbr.example',
  supportPhone: '+91 90000 00001',
  dispatchPhone: '+91 90000 00002',
  website: 'https://nbr.example',
  bankAccountName: 'NBR Trust',
  bankAccountNumber: '1234567890',
  bankIfsc: 'HDFC0000123',
  bankName: 'HDFC Bank',
  upiNumber: '9000000003',
  achieverPackDocumentName: 'NBR Achiever Pack 2026',
};

function letter(overrides: Partial<SelectionLetterInput> = {}): SelectionLetterInput {
  return {
    kind: SELECTION_KIND.RECORD,
    holderName: 'Priya Sharma',
    toEmail: 'priya@example.com',
    applicationId: 'NBRAP00042',
    title: 'Longest continuous recitation of the Ramayana',
    description: 'reciting for 52 hours without a break',
    dateOfBirth: '14 March 1992',
    city: 'Lucknow',
    state: 'Uttar Pradesh',
    confirmedOn: '3 August 2026',
    signatoryName: 'A. Verma',
    signatoryTitle: 'Official Registrar & Documentation Body',
    ...overrides,
  };
}

/**
 * What a browser would show, for comparison against the parsed blocks.
 *
 * Inline tags introduce no space — `<b>Records</b>,` reads as "Records," — so
 * they are removed rather than replaced with one. Only block-level tags and
 * `<br />` end a line.
 */
function visibleText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h3|li|ol|div)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
    .replace(/&ndash;/g, '–')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The guarantee this file exists for.
 *
 * The PDF an operator previews and downloads is built by parsing the very HTML
 * the email sends, so the two cannot say different things — but only for as
 * long as the parser understands every construct the letter uses. These tests
 * fail the moment the letter gains markup the PDF would silently drop, which is
 * exactly how the two drifted apart before.
 */
describe('letterBlocksFromHtml', () => {
  for (const kind of Object.values(SELECTION_KIND)) {
    it(`carries every word of the ${kind} letter into blocks`, () => {
      const html = renderSelectionLetter(letter({ kind }), ORGANISATION);
      const blocks = letterBlocksFromHtml(html);

      const fromBlocks = letterBlocksToText(blocks)
        .replace(/^- /gm, '')
        .replace(/\s+/g, ' ')
        .trim();

      expect(fromBlocks).toBe(visibleText(html));
    });
  }

  it('keeps a letter with no date of birth or place readable', () => {
    const html = renderSelectionLetter(
      letter({ dateOfBirth: undefined, city: undefined, state: undefined }),
      ORGANISATION,
    );
    const fromBlocks = letterBlocksToText(letterBlocksFromHtml(html))
      .replace(/^- /gm, '')
      .replace(/\s+/g, ' ')
      .trim();

    expect(fromBlocks).toBe(visibleText(html));
  });

  it('splits a multi-paragraph description without losing any of it', () => {
    const html = renderSelectionLetter(
      letter({ description: 'first paragraph\n\nsecond paragraph\nwith a soft break' }),
      ORGANISATION,
    );
    const fromBlocks = letterBlocksToText(letterBlocksFromHtml(html))
      .replace(/^- /gm, '')
      .replace(/\s+/g, ' ')
      .trim();

    expect(fromBlocks).toBe(visibleText(html));
    expect(fromBlocks).toContain('second paragraph with a soft break');
  });

  it('reads styling, not just words', () => {
    const blocks = letterBlocksFromHtml(renderSelectionLetter(letter(), ORGANISATION));

    // The stamp is an image in the email and has no text of its own.
    expect(blocks.filter((block) => block.type === 'stamp')).toHaveLength(1);

    // The payment heading is the one printed in red.
    const red = blocks.filter((block) => block.type === 'heading' && block.red);
    expect(red).toEqual([
      expect.objectContaining({ text: 'OFFICIAL PAYMENT DETAILS' }),
    ]);

    // The four things the applicant is asked to check.
    const list = blocks.find((block) => block.type === 'list');
    expect(list).toBeDefined();
    expect(list?.type === 'list' && list.items).toHaveLength(4);

    // The confidentiality line is the centred one.
    expect(
      blocks.filter((block) => block.type === 'paragraph' && block.centred),
    ).toHaveLength(1);

    // The approved title is emphasised — bold, italic and underlined.
    const emphasised = blocks.some(
      (block) =>
        block.type === 'paragraph' &&
        block.runs.some(
          (run) =>
            run.text.includes('Longest continuous recitation') &&
            run.bold &&
            run.italic &&
            run.underline,
        ),
    );
    expect(emphasised).toBe(true);
  });

  it('does not leak an attribute-carrying tag into the text', () => {
    // The deadline is wrapped in `<b style="color:…">`, which an inline matcher
    // that only accepted bare tags left sitting in the prose.
    const blocks = letterBlocksFromHtml(renderSelectionLetter(letter(), ORGANISATION));
    const text = letterBlocksToText(blocks);

    expect(text).not.toMatch(/style|color|#c0392b|<|>/);
    expect(text).toContain('within 2 days from the date of this email');
  });
});
