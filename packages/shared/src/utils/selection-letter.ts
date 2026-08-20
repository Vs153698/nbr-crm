/**
 * The selection letter, reproduced exactly.
 *
 * This is the one message the organisation sends that an applicant keeps,
 * forwards and occasionally quotes back. Its wording has been settled in
 * practice — the selectivity figure, the refusal to amend category or title,
 * the two-working-day correction window, the payment details — and none of it
 * is an operator's decision to make on the day.
 *
 * So the structure here is **fixed** and only the fields below are variable.
 * That is deliberate and is the opposite of the block-based templates used for
 * other mail: those let an operator restructure the message, which for this
 * letter would mean the terms differing between two applicants who received it a
 * week apart. An operator edits facts, never clauses.
 *
 * The one structural switch is `kind`. A record and an appreciation are
 * different awards with different wording in exactly three places — the titled
 * designation, the section heading, and the verb describing the holder — which
 * is why the operator is asked which they are sending before the letter opens
 * rather than being left to remember to change three separate spots.
 */

import { z } from 'zod';
import { emailSchema, optionalTrimmedString, trimmedString } from '../schemas/common';

export const SELECTION_KIND = {
  RECORD: 'record',
  APPRECIATION: 'appreciation',
} as const;

export type SelectionKind = (typeof SELECTION_KIND)[keyof typeof SELECTION_KIND];

export const SELECTION_KIND_META: Readonly<
  Record<
    SelectionKind,
    {
      /** The word inside the quotation marks in "approved as a titled …". */
      designation: string;
      /** The "… TITLE & DESCRIPTION" heading. */
      heading: string;
      /** How the holder is described: "is recognised for", "is appreciated for". */
      verb: string;
      label: string;
      description: string;
    }
  >
> = {
  [SELECTION_KIND.RECORD]: {
    designation: 'RECORD',
    heading: 'RECORD TITLE & DESCRIPTION',
    verb: 'is recognised for',
    label: 'Record',
    description: 'A verified record entry — the achievement is measured against the Book Records Database.',
  },
  [SELECTION_KIND.APPRECIATION]: {
    designation: 'APPRECIATION',
    heading: 'APPRECIATION TITLE & DESCRIPTION',
    verb: 'is appreciated for',
    label: 'Appreciation',
    description: 'A titled appreciation — merit recognised without a comparative record claim.',
  },
};

/**
 * Everything an operator may change.
 *
 * Each is prefilled from the record where the CRM holds it; the ones it cannot
 * know — the confirmation date, the signatory — default to something sensible
 * rather than being left blank for someone to forget.
 */
export const selectionLetterSchema = z.object({
  kind: z.nativeEnum(SELECTION_KIND),

  /** The recipient, and the name printed on the certificate. */
  holderName: trimmedString(150),
  toEmail: emailSchema,
  /** Copied in — the account holder, when they differ from the applicant. */
  ccEmail: emailSchema.optional(),
  applicationId: trimmedString(60),

  /** The approved title. Underlined in the letter and printed as-is. */
  title: trimmedString(400),
  /**
   * The approved description, verbatim.
   *
   * Long-form, and the operator composes it — but it is the one field the
   * letter then refuses to amend, which is why it is edited here rather than
   * assembled from parts.
   */
  description: trimmedString(4000),

  dateOfBirth: optionalTrimmedString(40),
  city: optionalTrimmedString(120),
  state: optionalTrimmedString(120),
  /** "as confirmed on …" — the date the verification concluded. */
  confirmedOn: trimmedString(40),

  signatoryName: trimmedString(120),
  signatoryTitle: trimmedString(160),
});

export type SelectionLetterInput = z.infer<typeof selectionLetterSchema>;

/** Contact and banking details, held in settings rather than typed per letter. */
export interface SelectionLetterOrganisation {
  readonly name: string;
  readonly supportEmail: string;
  readonly supportPhone: string;
  readonly dispatchPhone: string;
  readonly website: string;
  readonly bankAccountName: string;
  readonly bankAccountNumber: string;
  readonly bankIfsc: string;
  readonly bankName: string;
  readonly upiNumber: string;
  readonly achieverPackDocumentName: string;
}

export function selectionLetterSubject(
  input: Pick<SelectionLetterInput, 'holderName'>,
  organisation: Pick<SelectionLetterOrganisation, 'name'>,
): string {
  return `${organisation.name} Selection Mail_${input.holderName}`;
}

const escape = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Preserve the operator's paragraph breaks without letting markup through. */
const paragraphs = (value: string): string =>
  escape(value)
    .split(/\n{2,}/)
    .map((part) => part.replace(/\n/g, '<br />'))
    .join('</p><p style="margin:0 0 12px">');

/**
 * Render the letter.
 *
 * Table-free, inline-styled HTML in the same order as the approved document.
 * Deliberately plain: this arrives in Gmail, Outlook and a dozen mobile clients,
 * and the version an applicant may print has to look like a registrar's letter
 * rather than a marketing email.
 */
/**
 * Content id the confidential stamp is attached under.
 *
 * Embedded by reference rather than as a data URI, which Gmail strips, or a
 * hosted link, which most clients block until the reader opts into images — for
 * a stamp that marks the document confidential, not rendering is the one
 * outcome worth engineering against.
 */
export const CONFIDENTIAL_STAMP_CID = 'nbr-confidential-stamp';

/**
 * The description prints as its own paragraph, byte-for-byte what the
 * operator typed under the title. Nothing is prepended or appended to the
 * string — no holder name, no date, no verb.
 */
export function renderSelectionLetter(
  input: SelectionLetterInput,
  organisation: SelectionLetterOrganisation,
): string {
  const meta = SELECTION_KIND_META[input.kind];

  const P = 'margin:0 0 12px;color:#1f2937;font-size:14px;line-height:1.6';
  const H = 'margin:24px 0 10px;color:#111827;font-size:14px;font-weight:700';
  const RED = 'margin:24px 0 8px;color:#c0392b;font-size:14px;font-weight:700';

  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:680px;margin:0 auto;padding:8px 16px;background:#ffffff">

  <div style="text-align:center;margin:8px 0 20px">
    <img src="cid:${CONFIDENTIAL_STAMP_CID}" alt="Confidential — National Book of Records Verification Unit" width="210" style="width:210px;max-width:60%;height:auto;border:0" />
  </div>

  <p style="${P}">Dear ${escape(input.holderName)},</p>

  <p style="${P}"><b>Application ID: ${escape(input.applicationId)}</b></p>

  <p style="${P}">Greetings from the <b>${escape(organisation.name)}!</b></p>

  <p style="${P}">Congratulations!</p>

  <p style="${P}">Your claim has been finalized and approved as a titled <b>&ldquo; ${meta.designation} &rdquo;</b> under the ${escape(organisation.name)}.</p>

  <p style="${P}">We appreciate the effort, dedication, and patience demonstrated by you throughout the evaluation process. Your achievement has been carefully assessed by the <b>Editorial Board of the ${escape(organisation.name)}</b>, and following verification of the submitted information and supporting evidence, your claim has been selected and approved for recognition.</p>

  <p style="${P}">The ${escape(organisation.name)} follows a selective evaluation process, and only approximately <b>5&ndash;7% of the total applications received are selected for recognition</b>.</p>

  <p style="${P}">The record title and description have been prepared in accordance with our established record-writing protocols after a detailed review and verification of the evidence submitted with your application and cross-verification with the applicable Book Records Database.</p>

  <p style="${P}">Accordingly, changes relating to the <b>record category, title, or substance of the approved description</b> will not be considered.</p>

  <p style="${P}">As every individual record is exclusive to the record holder, names of parents, friends, supporters, or other individuals cannot be included in an individual record unless they are an integral part of the verified achievement.</p>

  <h3 style="${H}">${meta.heading}</h3>

  <p style="${P}"><b><i><u>${escape(input.title)}</u></i></b></p>

  <p style="${P}"><i><u>${paragraphs(input.description)}</u></i></p>

  <p style="${P}"><b>The final content will be printed on the certificate only after approval from the applicant.</b></p>

  <p style="${P}">We request you to carefully check and verify the following:</p>

  <ol style="margin:0 0 12px 20px;padding:0;color:#1f2937;font-size:14px;line-height:1.7">
    <li>Name</li>
    <li>City / State / Country</li>
    <li>Date of Birth, if applicable</li>
    <li>Attempt-specific dates, quantities, measurements, spellings, or numerical details, if any</li>
  </ol>

  <p style="${P}">If any correction is required in the above factual details, kindly inform us within <b>2 working days</b> of receiving this email.</p>

  <p style="${P}">Any amendment beyond the above details, including changes to the approved category, title, nature of achievement, or record description, will not be considered.</p>

  <h3 style="${H}">HOW TO AVAIL YOUR NBR ACHIEVER PACK</h3>

  <p style="${P}">As an approved record holder, you may select your preferred <b>NBR Achiever Pack</b> from the attached PDF:</p>

  <p style="margin:0 0 12px;color:#c0392b;font-size:14px;font-weight:700"><i>&ldquo;${escape(organisation.achieverPackDocumentName)}&rdquo;</i></p>

  <p style="${P}">The document contains the available Achiever Pack options along with their respective <b>inclusions, benefits, and applicable pricing</b>.</p>

  <p style="${P}">Please review the attached document carefully and select the option that best suits your preference.</p>

  <p style="${P}">The selected Achiever Pack must be booked by completing the applicable payment <b style="color:#c0392b">within 2 days from the date of this email</b>.</p>

  <p style="${P}">All package names, inclusions, benefits, and pricing shall be applicable strictly as mentioned in the attached PDF.</p>

  <h3 style="${RED}">OFFICIAL PAYMENT DETAILS</h3>

  <p style="${P}">
    <b>Account Holder Name:</b> ${escape(organisation.bankAccountName)}<br />
    <b>Account Number:</b> ${escape(organisation.bankAccountNumber)}<br />
    <b>IFSC Code:</b> ${escape(organisation.bankIfsc)}<br />
    <b>Bank:</b> ${escape(organisation.bankName)}
  </p>

  <p style="${P}"><b>UPI / PhonePe / Google Pay:</b><br />${escape(organisation.upiNumber)}</p>

  <p style="${P}">Alternatively, payment can be completed directly through your applicant dashboard.<br />After payment, please share the transaction details along with your selected Achiever Pack for processing.</p>

  <h3 style="${H}">PHOTOGRAPH &amp; DELIVERY DETAILS</h3>

  <p style="${P}">Where applicable to the selected Achiever Pack, kindly provide a recent <b>high-resolution passport-size photograph</b> along with complete and accurate delivery details.</p>

  <p style="${P}">The photograph should be clear, preferably taken against a plain background, and submitted in high-resolution JPEG/JPG format.<br />The photograph may be used for applicable record-holder materials and recognition features included in the selected package.</p>

  <h3 style="${H}">DISPATCH &amp; DELIVERY</h3>

  <p style="${P}">Once your Achiever Pack has been processed and dispatched, the tracking number will be shared with you via <b>email and/or SMS</b> on your registered contact details.<br />If you do not receive your package within <b>15 working days from the date of dispatch</b>, please contact us at:</p>

  <p style="${P}"><b>Phone:</b> ${escape(organisation.dispatchPhone)}<br /><b>Email:</b> ${escape(organisation.supportEmail)}</p>

  <p style="${P}">The ${escape(organisation.name)} shall not be responsible for dispatching the Achiever Pack if complete communication and delivery details are not provided by the record holder within <b>one month from the date of payment</b>.</p>

  <p style="${P}">Please ensure that all submitted details are accurate to avoid delays in processing or delivery.</p>

  <h3 style="${H}">IMPORTANT NOTE</h3>

  <p style="${P}">The approved record title and description have been prepared on the basis of the evidence and information submitted and verified during the evaluation process.<br />Once the applicant approves the final content and the certificate enters the printing process, further corrections or modifications may not be accepted.</p>

  <p style="${P}">The Achiever Pack selected by the applicant will be processed strictly according to the inclusions and benefits mentioned for that package in <b>&ldquo;${escape(organisation.achieverPackDocumentName)}&rdquo;</b>.</p>

  <p style="${P}">Physical items included in the selected package are dispatched as applicable. In case any item is lost or damaged after successful delivery, replacement, where available, may be subject to applicable charges.</p>

  <p style="${P}">We once again congratulate you on your achievement and welcome you among the<br /><b>Record Holders of the ${escape(organisation.name)}</b>.</p>

  <p style="margin:28px 0 16px;text-align:center;color:#c0392b;font-size:13px">This communication is confidential and intended for the recipient only.</p>

  <p style="margin:0;color:#1f2937;font-size:13px;line-height:1.6">
    Warm regards,<br />
    ${escape(input.signatoryName)}<br />
    ${escape(organisation.name)}<br />
    ${escape(input.signatoryTitle)}<br />
    ${escape(organisation.website)}<br />
    ${escape(organisation.supportEmail)}<br />
    ${escape(organisation.supportPhone)}
  </p>
</div>`;
}

/** The plain-text alternative, for clients that refuse HTML. */
export function renderSelectionLetterText(
  input: SelectionLetterInput,
  organisation: SelectionLetterOrganisation,
): string {
  const meta = SELECTION_KIND_META[input.kind];

  return [
    `Dear ${input.holderName},`,
    ``,
    `Application ID: ${input.applicationId}`,
    ``,
    `Greetings from the ${organisation.name}!`,
    ``,
    `Congratulations! Your claim has been finalized and approved as a titled "${meta.designation}" under the ${organisation.name}.`,
    ``,
    meta.heading,
    input.title,
    ``,
    input.description,
    ``,
    `Please check your name, city/state/country, date of birth and any attempt-specific details, and tell us within 2 working days if a correction is needed.`,
    ``,
    `Select your NBR Achiever Pack from the attached "${organisation.achieverPackDocumentName}" and complete payment within 2 days of this email.`,
    ``,
    `Payment: ${organisation.bankAccountName}, A/C ${organisation.bankAccountNumber}, IFSC ${organisation.bankIfsc}, ${organisation.bankName}. UPI ${organisation.upiNumber}.`,
    ``,
    `This communication is confidential and intended for the recipient only.`,
    ``,
    `Warm regards,`,
    input.signatoryName,
    organisation.name,
    input.signatoryTitle,
    organisation.supportEmail,
    organisation.supportPhone,
  ].join('\n');
}

/**
 * ── The letter as structured blocks ─────────────────────────────────────────
 *
 * The PDF an operator previews and downloads must be the letter the applicant
 * receives. It was not: the two were written separately, and the PDF had drifted
 * into three generic paragraphs that shared nothing with the email beyond the
 * applicant's name.
 *
 * Rather than maintain the wording twice — which is what produced the drift —
 * the PDF is derived from the HTML the email itself sends. The parser below is
 * narrow on purpose: it reads only the tags `renderSelectionLetter` emits, so
 * it is a reader for one known document rather than an HTML parser. If the
 * letter gains a construct, this has to learn it, and `letterBlocksToText`
 * exists so a test can prove the two still say the same thing.
 */
export interface LetterRun {
  readonly text: string;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
}

export type LetterBlock =
  | { readonly type: 'stamp' }
  | { readonly type: 'heading'; readonly text: string; readonly red: boolean }
  | {
      readonly type: 'paragraph';
      readonly runs: readonly LetterRun[];
      readonly red: boolean;
      readonly centred: boolean;
    }
  | { readonly type: 'list'; readonly items: readonly string[] };

const ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&ldquo;': '“',
  '&rdquo;': '”',
  '&ndash;': '–',
  '&nbsp;': ' ',
};

function decodeEntities(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|#39|ldquo|rdquo|ndash|nbsp);/g, (match) => ENTITIES[match] ?? match);
}

/**
 * A stand-in for `<br />` while whitespace is being collapsed.
 *
 * The letter's HTML is written across indented source lines, so it is full of
 * newlines and runs of spaces that a browser collapses to nothing. Collapsing
 * them here as well is what keeps the PDF from inheriting the source's
 * indentation — but a real line break has to survive that, hence a character
 * that cannot appear in the letter itself.
 */
const BREAK = '\u0000';

/** Inline markup → runs. Handles only `b`, `i`, `u` and `br`, which is all the letter uses. */
function parseRuns(html: string): LetterRun[] {
  const runs: LetterRun[] = [];
  const open = { b: 0, i: 0, u: 0 };
  let buffer = '';

  const flush = () => {
    if (buffer.length === 0) return;
    const text = decodeEntities(buffer)
      // Insignificant whitespace, exactly as a browser would treat it.
      .replace(/[^\S\u0000]+/g, ' ')
      // A line break swallows the spaces either side of it — but a space
      // between two runs must survive, or "from the" and a bold name that
      // follows it would be printed as one word.
      .replace(/ *\u0000 */g, '\n');

    if (text.length > 0) {
      runs.push({ text, bold: open.b > 0, italic: open.i > 0, underline: open.u > 0 });
    }
    buffer = '';
  };

  // Attributes are allowed: the letter carries `<b style="color:…">` for the
  // red deadline, and a matcher that only accepted bare tags left the whole
  // opening tag sitting in the text as if it were prose.
  const tag = /<(\/?)(b|i|u|br)\b[^>]*>/gi;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = tag.exec(html)) !== null) {
    buffer += html.slice(cursor, match.index);
    cursor = match.index + match[0].length;

    const name = match[2]!.toLowerCase() as 'b' | 'i' | 'u' | 'br';
    if (name === 'br') {
      buffer += BREAK;
      continue;
    }

    // A style change starts a new run, so the text before it keeps the old one.
    flush();
    if (match[1] === '/') open[name] = Math.max(0, open[name] - 1);
    else open[name] += 1;
  }

  buffer += html.slice(cursor);
  flush();

  return runs.filter((run) => run.text.length > 0);
}

const RED = '#c0392b';

/**
 * Read the rendered letter back into blocks.
 *
 * Scans for the block-level tags in document order. The wrapper `div`s carry no
 * content of their own, so they are simply not looked for — the `p` inside the
 * citation block is found like any other paragraph.
 */
export function letterBlocksFromHtml(html: string): LetterBlock[] {
  const blocks: LetterBlock[] = [];
  const block = /<img\b[^>]*>|<(p|h3|ol)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;

  while ((match = block.exec(html)) !== null) {
    if (match[1] === undefined) {
      blocks.push({ type: 'stamp' });
      continue;
    }

    const tag = match[1].toLowerCase();
    const attributes = match[2] ?? '';
    const inner = match[3] ?? '';
    const red = attributes.includes(RED);

    if (tag === 'h3') {
      blocks.push({ type: 'heading', text: decodeEntities(stripTags(inner)).trim(), red });
      continue;
    }

    if (tag === 'ol') {
      const items = [...inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((item) =>
        decodeEntities(stripTags(item[1] ?? '')).trim(),
      );
      blocks.push({ type: 'list', items });
      continue;
    }

    const runs = trimEdges(parseRuns(inner));
    if (runs.length === 0) continue;
    blocks.push({ type: 'paragraph', runs, red, centred: attributes.includes('text-align:center') });
  }

  return blocks;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

/** Drop the leading and trailing space a paragraph's source indentation leaves. */
function trimEdges(runs: readonly LetterRun[]): LetterRun[] {
  const trimmed = runs.map((run, index) => {
    let text = run.text;
    if (index === 0) text = text.replace(/^[ \n]+/, '');
    if (index === runs.length - 1) text = text.replace(/[ \n]+$/, '');
    return { ...run, text };
  });

  return trimmed.filter((run) => run.text.length > 0);
}

/**
 * The blocks as plain text.
 *
 * Exists so a test can assert the parsed letter still carries every word the
 * HTML does — the check that would have caught the PDF drifting away from the
 * email in the first place.
 */
export function letterBlocksToText(blocks: readonly LetterBlock[]): string {
  return blocks
    .map((item) => {
      if (item.type === 'stamp') return '';
      if (item.type === 'heading') return item.text;
      if (item.type === 'list') return item.items.map((entry) => `- ${entry}`).join('\n');
      return item.runs.map((run) => run.text).join('');
    })
    .filter((line) => line.length > 0)
    .join('\n\n');
}
