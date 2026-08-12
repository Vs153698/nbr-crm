import PDFDocument from 'pdfkit';
import { join } from 'node:path';
import type { LetterBlock, LetterRun } from '@nbr/shared';

/**
 * The seal, drawn on every document's masthead.
 *
 * Resolved from `__dirname` so it works from `src` under tsx and from `dist`
 * after a build — nest-cli copies `documents/assets` alongside the compiled
 * output for exactly this reason. Every use is wrapped in a try/catch: a
 * missing logo must degrade to the wordmark, never fail a receipt an applicant
 * is waiting on.
 */
const LOGO_PATH = join(__dirname, 'assets', 'nbr-logo.png');

/**
 * The house style for every PDF this system produces.
 *
 * Before this, each document laid itself out inline: an invoice positioned its
 * own totals, a report drew its own table, and the applicant file set label and
 * value with `{ continued: true }` followed by `align: 'right'` — a trick that
 * puts the two on one line but gives up any column, so no two rows lined up and
 * a long value silently pushed its amount off the edge. Documents that go to an
 * applicant, an auditor or a bank cannot look like that.
 *
 * Everything here is geometry-first: a column is a number, not a guess, and a
 * value is drawn inside a known box. That is the whole difference between a
 * generated document and a typeset one.
 *
 * ## On the rupee sign
 *
 * Amounts read `INR 1,999.00`, not `₹1,999.00`. pdfkit's built-in fonts are
 * WinAnsi-encoded and have no U+20B9 glyph — asking for one yields a blank box
 * or, worse, a substituted character. `INR` is the ISO code, is what commercial
 * invoices use internationally, and is unambiguous to a bank. Switching to a
 * real rupee sign means embedding a TTF that carries the glyph; the currency
 * helper below is the single place that would change.
 */

export type Doc = InstanceType<typeof PDFDocument>;

// ── Page geometry ────────────────────────────────────────────────────────────

export const PAGE = { margin: 48 } as const;

/** Height reserved at the foot of every page, so body text never collides. */
const FOOTER_RESERVE = 64;

/**
 * Geometry is read off the document, never held in module state.
 *
 * A landscape report and a portrait invoice can be rendering at the same time —
 * this service is a singleton serving concurrent requests — so any shared
 * "current page width" would race and produce a document laid out to the other
 * one's dimensions. Asking the document is always correct and costs nothing.
 */
export const pageWidth = (doc: Doc): number => doc.page.width;
export const pageHeight = (doc: Doc): number => doc.page.height;
export const contentWidth = (doc: Doc): number => doc.page.width - PAGE.margin * 2;
export const contentRight = (doc: Doc): number => doc.page.width - PAGE.margin;
export const bodyBottom = (doc: Doc): number => doc.page.height - FOOTER_RESERVE;

// ── Palette ──────────────────────────────────────────────────────────────────

export const INK = {
  strong: '#0E1B3D',
  body: '#1F2937',
  muted: '#6B7280',
  faint: '#9CA3AF',
} as const;

export const RULE = { hair: '#E5E7EB', strong: '#0E1B3D' } as const;

export const ACCENT = {
  brand: '#0E1B3D',
  gold: '#C08A2E',
  ok: '#0F7A3D',
  okTint: '#E8F5EE',
  danger: '#B42318',
  dangerTint: '#FDECEA',
  surface: '#F7F8FB',
} as const;

// ── Primitives ───────────────────────────────────────────────────────────────

/**
 * Draw at absolute coordinates without disturbing the text cursor.
 *
 * pdfkit threads a single cursor through every call, so a header drawn at the
 * top of a page would otherwise leave the body starting wherever the header
 * finished. Saving and restoring makes fixed furniture genuinely fixed.
 */
export function atPosition(doc: Doc, draw: () => void): void {
  const { x, y } = doc;
  draw();
  doc.x = x;
  doc.y = y;
}

export function rule(doc: Doc, y: number, colour: string = RULE.hair, width = 0.75): void {
  doc.save().moveTo(PAGE.margin, y).lineTo(contentRight(doc), y).lineWidth(width).strokeColor(colour).stroke().restore();
}

/** `1234.5` → `INR 1,234.50`. Two decimals always — money is never ragged. */
export function money(amount: number | string): string {
  const value = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(value)) return 'INR 0.00';
  return `INR ${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Cut a string to fit a column, measuring rather than guessing.
 *
 * pdfkit's own `lineBreak: false` and `ellipsis` did not reliably hold a cell
 * to one line — a long achievement title wrapped and bled into the row beneath
 * it, which in a table of figures reads as corruption. Measuring the rendered
 * width and cutting is deterministic, and the caller must have already set the
 * font and size that the measurement depends on.
 */
/** Draw one line, shrinking the size until it genuinely fits `maxWidth`. */
export function fitText(
  doc: Doc,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  startSize: number,
  font: 'Helvetica' | 'Helvetica-Bold',
  colour: string,
  characterSpacing = 0,
): void {
  let size = startSize;
  doc.font(font).fontSize(size);
  while (size > 6 && doc.widthOfString(text, { characterSpacing }) > maxWidth) {
    size -= 0.5;
    doc.fontSize(size);
  }
  doc.fillColor(colour).text(text, x, y, { characterSpacing, lineBreak: false });
}

export function truncateToWidth(doc: Doc, text: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  if (doc.widthOfString(text) <= maxWidth) return text;

  const ellipsis = '…';
  const room = maxWidth - doc.widthOfString(ellipsis);
  if (room <= 0) return '';

  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (doc.widthOfString(text.slice(0, mid)) <= room) low = mid;
    else high = mid - 1;
  }

  return `${text.slice(0, low).trimEnd()}${ellipsis}`;
}

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Document furniture ───────────────────────────────────────────────────────

export interface DocumentMeta {
  /** The issuing organisation, from configuration rather than hard-coded. */
  readonly organisation: string;
  /** "Tax Invoice", "Applicant File", "Revenue Report". */
  readonly title: string;
  /** The document's own identifier, shown large beside the title. */
  readonly reference?: string;
  /** A short status word — PAID, CANCELLED — rendered as a chip. */
  readonly status?: { label: string; tone: 'ok' | 'danger' | 'neutral' };
  readonly issuedOn?: Date;
}

/**
 * The masthead: a navy band carrying the organisation and the document type.
 *
 * Returns the y coordinate the body may start at, so callers never guess.
 */
export function drawMasthead(doc: Doc, meta: DocumentMeta): number {
  const bandHeight = 76;

  atPosition(doc, () => {
    doc.save();
    doc.rect(0, 0, pageWidth(doc), bandHeight).fill(ACCENT.brand);
    doc.rect(0, bandHeight, pageWidth(doc), 3).fill(ACCENT.gold);

    let logoDrawn = false;
    try {
      doc.image(LOGO_PATH, PAGE.margin, 16, { height: 44, fit: [44, 44] });
      logoDrawn = true;
    } catch {
      // Optional by design — the wordmark alone still carries the document.
    }

    // Measured rather than trusted to `lineBreak: false`, which does not
    // reliably hold one line — the organisation name wrapped over its own
    // subtitle and into the document title on the right.
    const markX = logoDrawn ? PAGE.margin + 56 : PAGE.margin;
    const titleWidth = 200;
    const markWidth = contentWidth(doc) - titleWidth - (markX - PAGE.margin) - 16;

    fitText(doc, meta.organisation.toUpperCase(), markX, 28, markWidth, 13, 'Helvetica-Bold', '#FFFFFF', 0.8);
    fitText(doc, 'Official document', markX, 47, markWidth, 8.5, 'Helvetica', '#C7D2E8');

    // Document type, right-aligned against the same band.
    doc
      .font('Helvetica-Bold')
      .fontSize(15)
      .fillColor('#FFFFFF')
      .text(meta.title.toUpperCase(), contentRight(doc) - titleWidth, 28, {
        width: titleWidth,
        align: 'right',
        characterSpacing: 0.5,
        lineBreak: false,
      });

    doc.restore();
  });

  let y = bandHeight + 22;

  // Reference and date sit under the band, with the status chip on the right.
  if (meta.reference || meta.issuedOn || meta.status) {
    atPosition(doc, () => {
      const parts: string[] = [];
      if (meta.reference) parts.push(meta.reference);
      if (meta.issuedOn) parts.push(`Issued ${formatDate(meta.issuedOn)}`);

      if (parts.length > 0) {
        doc
          .font('Helvetica-Bold')
          .fontSize(10)
          .fillColor(INK.strong)
          .text(parts.join('   ·   '), PAGE.margin, y, { lineBreak: false });
      }

      if (meta.status) {
        drawChip(doc, meta.status.label, meta.status.tone, contentRight(doc), y - 3, 'right');
      }
    });

    y += 20;
  }

  rule(doc, y);
  return y + 18;
}

/** A small filled pill. `anchor` decides whether x is its left or right edge. */
export function drawChip(
  doc: Doc,
  label: string,
  tone: 'ok' | 'danger' | 'neutral',
  x: number,
  y: number,
  anchor: 'left' | 'right' = 'left',
): void {
  const palette =
    tone === 'ok'
      ? { bg: ACCENT.okTint, fg: ACCENT.ok }
      : tone === 'danger'
        ? { bg: ACCENT.dangerTint, fg: ACCENT.danger }
        : { bg: ACCENT.surface, fg: INK.muted };

  doc.save().font('Helvetica-Bold').fontSize(8.5);
  const width = doc.widthOfString(label) + 18;
  const left = anchor === 'right' ? x - width : x;

  doc.roundedRect(left, y, width, 17, 3).fill(palette.bg);
  doc
    .fillColor(palette.fg)
    .text(label.toUpperCase(), left, y + 4.5, { width, align: 'center', characterSpacing: 0.6, lineBreak: false });
  doc.restore();
}

/**
 * Footers, written after the body so they can say "Page 1 of 4".
 *
 * Requires the document to be created with `bufferPages: true` — page count is
 * not knowable until the content has been laid out.
 */
export function drawFooters(doc: Doc, label: string): void {
  const range = doc.bufferedPageRange();

  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(range.start + index);

    /**
     * Footers sit below the bottom margin, and pdfkit treats writing there as
     * running out of room — so each footer silently appended a fresh page,
     * which then got its own footer. A one-page invoice came out four pages
     * long. Clearing the bottom margin for the duration is the documented way
     * to draw furniture in the margin without triggering the auto-break.
     */
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    const y = pageHeight(doc) - 44;
    rule(doc, y - 10);

    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(INK.faint)
      .text(label, PAGE.margin, y, { width: contentWidth(doc) * 0.7, lineBreak: false });

    doc.text(`Page ${index + 1} of ${range.count}`, PAGE.margin, y, {
      width: contentWidth(doc),
      align: 'right',
      lineBreak: false,
    });

    doc.text('Computer-generated document. No signature is required.', PAGE.margin, y + 11, {
      width: contentWidth(doc),
      align: 'left',
      lineBreak: false,
    });

    doc.page.margins.bottom = bottomMargin;
  }
}

// ── Content blocks ───────────────────────────────────────────────────────────

/**
 * Lay a parsed letter onto the page.
 *
 * Takes the blocks produced from the letter's own HTML, so the PDF an operator
 * previews and downloads carries the same words in the same order as the email
 * the applicant receives. Nothing here decides what the letter says.
 *
 * pdfkit has no rich-text run support, so a paragraph is drawn run by run with
 * `continued`, which is what lets a bold or underlined phrase sit mid-sentence
 * rather than forcing one style per paragraph.
 */
export function drawLetter(doc: Doc, blocks: readonly LetterBlock[]): void {
  const width = contentWidth(doc);

  for (const block of blocks) {
    // The confidential stamp is an inline email image; in print the line above
    // the sign-off carries the same point, so it is skipped rather than left as
    // a broken box.
    if (block.type === 'stamp') continue;

    // Start a page rather than orphan a heading or the first line of a
    // paragraph at the very bottom.
    if (doc.y > bodyBottom(doc) - 60) doc.addPage();

    if (block.type === 'heading') {
      doc.moveDown(0.9);
      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor(block.red ? ACCENT.danger : INK.strong)
        .text(block.text, PAGE.margin, doc.y, { width });
      doc.moveDown(0.35);
      continue;
    }

    if (block.type === 'list') {
      doc.font('Helvetica').fontSize(10).fillColor(INK.body);
      block.items.forEach((item, index) => {
        if (doc.y > bodyBottom(doc) - 24) doc.addPage();
        doc.text(`${index + 1}. ${item}`, PAGE.margin + 12, doc.y, {
          width: width - 12,
          lineGap: 2.5,
        });
        doc.moveDown(0.2);
      });
      // pdfkit remembers the x it was last told to draw at, so without this the
      // list's indent leaks into every paragraph that follows it.
      doc.x = PAGE.margin;
      doc.moveDown(0.45);
      continue;
    }

    const colour = block.red ? ACCENT.danger : INK.body;
    const align = block.centred ? 'center' : 'left';

    /**
     * A paragraph is drawn one line at a time.
     *
     * pdfkit tracks its own cursor while `continued` is set, and a newline
     * inside a continued run corrupts it — the letter's payment block came out
     * as one run-on line, and the dispatch paragraph printed on top of itself.
     * Splitting on the breaks first means every `continued` chain is a single
     * line, which is the only shape pdfkit handles correctly.
     */
    for (const line of splitIntoLines(block.runs)) {
      if (line.length === 0) {
        doc.moveDown(0.5);
        continue;
      }

      if (doc.y > bodyBottom(doc) - 24) doc.addPage();
      // Only before the first run of a line: a `continued` run must carry on
      // from where the previous one ended, not restart at the margin.
      doc.x = PAGE.margin;

      line.forEach((run, index) => {
        doc
          .font(fontFor(run))
          .fontSize(10)
          .fillColor(colour)
          .text(run.text, {
            width,
            align,
            lineGap: 2.5,
            underline: run.underline,
            continued: index < line.length - 1,
          });
      });
    }

    doc.moveDown(0.55);
  }
}

/** Break a paragraph's runs at their newlines, keeping each run's styling. */
function splitIntoLines(runs: readonly LetterRun[]): LetterRun[][] {
  const lines: LetterRun[][] = [[]];

  for (const run of runs) {
    const parts = run.text.split('\n');
    parts.forEach((part, index) => {
      if (index > 0) lines.push([]);
      if (part.length > 0) lines[lines.length - 1]!.push({ ...run, text: part });
    });
  }

  return lines;
}

/** Helvetica has four faces, and a run needs whichever matches its markup. */
function fontFor(run: LetterRun): string {
  if (run.bold && run.italic) return 'Helvetica-BoldOblique';
  if (run.bold) return 'Helvetica-Bold';
  if (run.italic) return 'Helvetica-Oblique';
  return 'Helvetica';
}

export function sectionTitle(doc: Doc, text: string): void {
  doc.moveDown(0.9);
  doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor(INK.muted)
    .text(text.toUpperCase(), PAGE.margin, doc.y, { characterSpacing: 1 });
  doc.moveDown(0.45);
}

/**
 * A block of label/value pairs in fixed columns.
 *
 * The label column is a constant width and the value starts where it ends, so
 * every row aligns down the page. The previous approach — label, then the value
 * right-aligned on the same line — meant each row's value landed somewhere
 * different depending on how long its label happened to be.
 */
export function keyValues(
  doc: Doc,
  entries: ReadonlyArray<readonly [string, string]>,
  options: { labelWidth?: number; columns?: 1 | 2 } = {},
): void {
  const labelWidth = options.labelWidth ?? 120;
  const columns = options.columns ?? 1;
  const columnWidth = columns === 2 ? contentWidth(doc) / 2 - 12 : contentWidth(doc);
  const lineHeight = 15;

  let index = 0;
  for (const [label, value] of entries) {
    const column = columns === 2 ? index % 2 : 0;
    const x = PAGE.margin + column * (columnWidth + 24);

    if (column === 0 && doc.y > bodyBottom(doc) - lineHeight) doc.addPage();
    const y = doc.y;

    doc.font('Helvetica').fontSize(9).fillColor(INK.muted).text(label, x, y, {
      width: labelWidth,
      lineBreak: false,
      ellipsis: true,
    });

    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK.body).text(value || '—', x + labelWidth, y, {
      width: columnWidth - labelWidth,
    });

    // With two columns the cursor only advances after the right-hand cell.
    if (columns === 1 || column === 1) {
      doc.x = PAGE.margin;
      doc.y = Math.max(y + lineHeight, doc.y);
    } else {
      doc.y = y;
    }

    index += 1;
  }

  doc.x = PAGE.margin;
  if (columns === 2 && index % 2 === 1) doc.y += lineHeight;
}

export interface TableColumn {
  readonly key: string;
  readonly label: string;
  /** Share of the available width. Normalised across all columns. */
  readonly weight?: number;
  readonly align?: 'left' | 'right' | 'center';
  /** Money columns get tabular treatment and a right edge. */
  readonly money?: boolean;
}

/**
 * A real table: fixed columns, a repeating header, and page breaks.
 *
 * Column widths come from weights rather than dividing the page evenly — a
 * report with a date, a long title and three amounts is unreadable when all
 * five get the same width, which is what the previous renderer did.
 */
export function drawTable(
  doc: Doc,
  columns: readonly TableColumn[],
  rows: ReadonlyArray<Record<string, unknown>>,
  options: { startY?: number; zebra?: boolean } = {},
): number {
  const totalWeight = columns.reduce((sum, column) => sum + (column.weight ?? 1), 0);
  const widths = columns.map((column) => ((column.weight ?? 1) / totalWeight) * contentWidth(doc));
  const offsets = widths.reduce<number[]>((acc, width, index) => {
    acc.push(index === 0 ? PAGE.margin : acc[index - 1]! + widths[index - 1]!);
    return acc;
  }, []);

  const headerHeight = 20;
  const rowHeight = 16;
  let y = options.startY ?? doc.y;

  const drawHead = () => {
    doc.save();
    doc.rect(PAGE.margin, y, contentWidth(doc), headerHeight).fill(ACCENT.brand);
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#FFFFFF');
    columns.forEach((column, index) => {
      const cellWidth = widths[index]! - 12;
      doc.text(truncateToWidth(doc, column.label.toUpperCase(), cellWidth), offsets[index]! + 6, y + 6.5, {
        width: cellWidth,
        align: column.align ?? (column.money ? 'right' : 'left'),
        characterSpacing: 0.4,
        lineBreak: false,
      });
    });
    doc.restore();
    y += headerHeight;
  };

  drawHead();

  rows.forEach((row, rowIndex) => {
    if (y > bodyBottom(doc) - rowHeight) {
      doc.addPage();
      y = PAGE.margin;
      drawHead();
    }

    if (options.zebra !== false && rowIndex % 2 === 1) {
      doc.save().rect(PAGE.margin, y, contentWidth(doc), rowHeight).fill(ACCENT.surface).restore();
    }

    doc.font('Helvetica').fontSize(8).fillColor(INK.body);
    columns.forEach((column, index) => {
      const raw = row[column.key];
      const text = column.money ? money(raw as number | string) : String(raw ?? '—');
      const cellWidth = widths[index]! - 12;

      doc.text(truncateToWidth(doc, text, cellWidth), offsets[index]! + 6, y + 4.5, {
        width: cellWidth,
        align: column.align ?? (column.money ? 'right' : 'left'),
        lineBreak: false,
      });
    });

    y += rowHeight;
  });

  rule(doc, y);
  doc.y = y + 12;
  doc.x = PAGE.margin;
  return y;
}

export interface TotalLine {
  readonly label: string;
  readonly amount: number | string;
  /** The headline figure — larger, ruled off, in full colour. */
  readonly emphasis?: boolean;
  /** Shown as a deduction, with a leading minus. */
  readonly negative?: boolean;
}

/**
 * The totals stack, right-aligned under a table.
 *
 * Two fixed columns rather than free text, so every figure's last digit lands
 * on the same vertical line. Unaligned money is the single clearest tell of a
 * generated document.
 */
export function drawTotals(doc: Doc, lines: readonly TotalLine[]): void {
  const blockWidth = 250;
  const left = contentRight(doc) - blockWidth;
  const labelWidth = 130;
  let y = doc.y + 4;

  for (const line of lines) {
    if (y > bodyBottom(doc) - 30) {
      doc.addPage();
      y = PAGE.margin;
    }

    if (line.emphasis) {
      rule(doc, y, RULE.strong, 1);
      y += 8;
    }

    const size = line.emphasis ? 11.5 : 9.5;
    const font = line.emphasis ? 'Helvetica-Bold' : 'Helvetica';

    doc
      .font(font)
      .fontSize(size)
      .fillColor(line.emphasis ? INK.strong : INK.muted)
      .text(line.label, left, y, { width: labelWidth, lineBreak: false });

    // A plain hyphen, never U+2212: pdfkit's built-in fonts are WinAnsi and
    // have no minus sign, so the typographically correct character renders as
    // a stray quote mark on the one line where clarity matters most.
    const rendered = `${line.negative ? '- ' : ''}${money(line.amount)}`;
    doc
      .font('Helvetica-Bold')
      .fontSize(size)
      .fillColor(line.emphasis ? INK.strong : INK.body)
      .text(rendered, left + labelWidth, y, {
        width: blockWidth - labelWidth,
        align: 'right',
        lineBreak: false,
      });

    y += line.emphasis ? 22 : 16;
  }

  doc.x = PAGE.margin;
  doc.y = y + 4;
}

/** A tinted callout for a caveat the reader must not miss. */
export function drawNotice(doc: Doc, text: string, tone: 'neutral' | 'danger' = 'neutral'): void {
  const padding = 10;
  doc.font('Helvetica').fontSize(8);
  const textWidth = contentWidth(doc) - padding * 2;
  const height = doc.heightOfString(text, { width: textWidth }) + padding * 2;

  if (doc.y > bodyBottom(doc) - height) doc.addPage();
  const y = doc.y;

  doc
    .save()
    .roundedRect(PAGE.margin, y, contentWidth(doc), height, 4)
    .fill(tone === 'danger' ? ACCENT.dangerTint : ACCENT.surface)
    .restore();

  doc
    .fillColor(tone === 'danger' ? ACCENT.danger : INK.muted)
    .text(text, PAGE.margin + padding, y + padding, { width: textWidth });

  doc.x = PAGE.margin;
  doc.y = y + height + 10;
}

/** Two side-by-side party blocks — issuer on the left, recipient on the right. */
export function drawParties(
  doc: Doc,
  left: { heading: string; lines: readonly string[] },
  right: { heading: string; lines: readonly string[] },
): void {
  const columnWidth = contentWidth(doc) / 2 - 12;
  const top = doc.y;

  const block = (x: number, block: { heading: string; lines: readonly string[] }) => {
    let y = top;
    doc
      .font('Helvetica-Bold')
      .fontSize(7.5)
      .fillColor(INK.faint)
      .text(block.heading.toUpperCase(), x, y, { width: columnWidth, characterSpacing: 1 });
    y += 14;

    block.lines.filter(Boolean).forEach((line, index) => {
      doc
        .font(index === 0 ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(index === 0 ? 10.5 : 9)
        .fillColor(index === 0 ? INK.strong : INK.muted)
        .text(line, x, y, { width: columnWidth });
      y = doc.y + 2;
    });

    return y;
  };

  const leftEnd = block(PAGE.margin, left);
  const rightEnd = block(PAGE.margin + columnWidth + 24, right);

  doc.x = PAGE.margin;
  doc.y = Math.max(leftEnd, rightEnd) + 8;
}

/**
 * Create a document with footers wired up.
 *
 * `bufferPages` is what makes "Page 1 of 4" possible: the total is unknown
 * until the body is laid out, so footers are written in a second pass.
 */
export function renderDocument(
  meta: DocumentMeta,
  footerLabel: string,
  body: (doc: Doc, startY: number) => void,
  layout: 'portrait' | 'landscape' = 'portrait',
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout,
      margin: PAGE.margin,
      bufferPages: true,
      compress: true,
      info: { Title: `${meta.title}${meta.reference ? ` ${meta.reference}` : ''}`, Author: meta.organisation },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      const startY = drawMasthead(doc, meta);
      doc.x = PAGE.margin;
      doc.y = startY;

      body(doc, startY);
      drawFooters(doc, footerLabel);
    } catch (error: unknown) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    doc.end();
  });
}

/** Reports are wide; portrait truncates them. Same furniture, turned sideways. */
export function renderLandscapeDocument(
  meta: DocumentMeta,
  footerLabel: string,
  body: (doc: Doc, startY: number) => void,
): Promise<Buffer> {
  return renderDocument(meta, footerLabel, body, 'landscape');
}
