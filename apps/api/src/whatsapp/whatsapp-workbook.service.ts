import {
  WHATSAPP_PARAM_SOURCE,
  WHATSAPP_PARAM_SOURCE_LABELS,
  WHATSAPP_TEMPLATE_CODES,
  whatsappTemplateSchema,
  type WhatsAppParamSource,
  type WhatsAppTemplate,
} from '@nbr/shared';
import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { ValidationError } from '../common/errors';

/**
 * Bulk editing for the WhatsApp template registry.
 *
 * Registering thirteen approved templates one at a time, each with its own
 * parameters in the right order, is a long sitting at a form — and every one of
 * them has to match a campaign name typed exactly as AiSensy holds it. A
 * spreadsheet is the tool people already use for that kind of list.
 *
 * The workbook is generated rather than shipped as a static file so the
 * dropdowns always carry this build's vocabulary: add a parameter source and
 * the next download offers it, with no second place to update.
 *
 * Nothing here writes. Parsing returns rows for the operator to look over in
 * the editor they already know, and saving stays the one existing path.
 */

/** Sheet holding the dropdown vocabularies. Referenced by data validation. */
const LISTS_SHEET = 'Lists';
const TEMPLATES_SHEET = 'Templates';

/**
 * How many parameter pairs the sheet offers.
 *
 * The schema allows twenty. Eight is what fits on a screen without scrolling
 * sideways past the part you are editing, and no approved template in use here
 * comes close — a row of mostly empty columns makes the sheet harder to fill,
 * not more capable.
 */
const MAX_PARAMS = 8;

const SOURCE_VALUES = Object.values(WHATSAPP_PARAM_SOURCE);

/** Header row, in order. Parsing reads by position, so this is the contract. */
function headers(): string[] {
  const base = ['Friendly name', 'AiSensy campaign name', 'Answers template', 'Active'];
  for (let i = 1; i <= MAX_PARAMS; i++) {
    base.push(`{{${i}}} name`, `{{${i}}} value`);
  }
  return base;
}

export interface ParsedWorkbook {
  readonly templates: readonly WhatsAppTemplate[];
  /** One per row that could not be used, naming the row so it can be found. */
  readonly errors: readonly string[];
}

@Injectable()
export class WhatsAppWorkbookService {
  /**
   * The workbook, prefilled with whatever is already registered.
   *
   * Prefilling makes the same file an export as well as a starter: an operator
   * correcting one campaign name across twelve templates downloads, edits, and
   * imports, rather than retyping the eleven that were already right.
   */
  async build(existing: readonly WhatsAppTemplate[]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'National Book of Records CRM';
    workbook.created = new Date();

    const lists = workbook.addWorksheet(LISTS_SHEET);
    lists.getCell('A1').value = 'Parameter values';
    SOURCE_VALUES.forEach((source, index) => {
      // The label is what the operator picks; the value is what we store. Both
      // are written so the sheet is readable and the import is unambiguous.
      lists.getCell(`A${index + 2}`).value = WHATSAPP_PARAM_SOURCE_LABELS[source];
      lists.getCell(`B${index + 2}`).value = source;
    });

    lists.getCell('D1').value = 'Answers template';
    ['', ...WHATSAPP_TEMPLATE_CODES].forEach((code, index) => {
      lists.getCell(`D${index + 2}`).value = code;
    });

    lists.getCell('F1').value = 'Active';
    lists.getCell('F2').value = 'TRUE';
    lists.getCell('F3').value = 'FALSE';

    // Reference only. Hidden so it cannot be mistaken for something to fill in,
    // but present, because the dropdowns point at it.
    lists.state = 'veryHidden';

    const sheet = workbook.addWorksheet(TEMPLATES_SHEET);
    const headerRow = headers();
    sheet.columns = headerRow.map((header) => ({
      header,
      width: header.startsWith('{{') ? 22 : 30,
    }));

    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0E1B3D' } };
    sheet.getRow(1).height = 22;
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    for (const template of existing) {
      const row: (string | boolean)[] = [
        template.label,
        template.campaignName,
        template.templateCode ?? '',
        template.isActive ? 'TRUE' : 'FALSE',
      ];
      for (let i = 0; i < MAX_PARAMS; i++) {
        const param = template.params[i];
        row.push(param?.key ?? '', param ? WHATSAPP_PARAM_SOURCE_LABELS[param.source] : '');
      }
      sheet.addRow(row);
    }

    /**
     * Validation is applied to a generous block of rows, not just the filled
     * ones — the point of the file is to add templates that do not exist yet,
     * and a dropdown that stops at the last existing row would not be there on
     * the line the operator actually types into.
     */
    const lastRow = Math.max(existing.length, 0) + 200;
    const sourceRange = `${LISTS_SHEET}!$A$2:$A$${SOURCE_VALUES.length + 1}`;
    const codeRange = `${LISTS_SHEET}!$D$2:$D$${WHATSAPP_TEMPLATE_CODES.length + 2}`;

    for (let rowNumber = 2; rowNumber <= lastRow; rowNumber++) {
      sheet.getCell(rowNumber, 3).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [codeRange],
      };
      sheet.getCell(rowNumber, 4).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [`${LISTS_SHEET}!$F$2:$F$3`],
      };
      for (let i = 0; i < MAX_PARAMS; i++) {
        // Column 5 is the first name, 6 the first value, then in pairs.
        sheet.getCell(rowNumber, 6 + i * 2).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [sourceRange],
        };
      }
    }

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  /**
   * Read a filled-in workbook back into templates.
   *
   * A bad row is reported and skipped rather than failing the whole file: an
   * operator who mistyped one campaign name out of thirteen should get the
   * twelve and a note, not a rejection with nothing to show for the sitting.
   */
  async parse(fileBase64: string): Promise<ParsedWorkbook> {
    const workbook = new ExcelJS.Workbook();
    try {
      /**
       * `load` also accepts an ArrayBuffer, which sidesteps a typing clash:
       * exceljs declares the parameter as the pre-generic `Buffer`, and Node's
       * is now `Buffer<ArrayBuffer>`. Handing over the bytes directly is
       * accurate rather than cast around.
       */
      const bytes = Buffer.from(fileBase64, 'base64');
      await workbook.xlsx.load(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      );
    } catch {
      throw new ValidationError({
        file: ['That file could not be read as a workbook. Upload the .xlsx you downloaded here.'],
      });
    }

    const sheet = workbook.getWorksheet(TEMPLATES_SHEET) ?? workbook.worksheets[0];
    if (!sheet) {
      throw new ValidationError({ file: ['The workbook has no sheets.'] });
    }

    // Labels are what the dropdown puts in the cell; the stored value is what
    // the registry needs. Accept either, so a hand-typed `record_id` works too.
    const byLabel = new Map<string, WhatsAppParamSource>();
    for (const source of SOURCE_VALUES) {
      byLabel.set(WHATSAPP_PARAM_SOURCE_LABELS[source].toLowerCase(), source);
      byLabel.set(source.toLowerCase(), source);
    }

    const templates: WhatsAppTemplate[] = [];
    const errors: string[] = [];

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;

      const text = (column: number): string => {
        const value = row.getCell(column).value;
        if (value === null || value === undefined) return '';
        if (typeof value === 'object' && 'result' in value) return String(value.result ?? '').trim();
        if (typeof value === 'object' && 'text' in value) return String(value.text ?? '').trim();
        return String(value).trim();
      };

      const label = text(1);
      const campaignName = text(2);

      // A blank line in the middle of a sheet is ordinary, not an error.
      if (!label && !campaignName) return;

      if (!label || !campaignName) {
        errors.push(
          `Row ${rowNumber}: both a friendly name and an AiSensy campaign name are required.`,
        );
        return;
      }

      const params: { key: string; label: string; source: WhatsAppParamSource }[] = [];
      let rowFailed = false;

      for (let i = 0; i < MAX_PARAMS; i++) {
        const key = text(5 + i * 2);
        const rawSource = text(6 + i * 2);
        if (!key && !rawSource) continue;

        const source = byLabel.get(rawSource.toLowerCase());
        if (!source) {
          errors.push(
            `Row ${rowNumber}: "${rawSource || '(blank)'}" is not one of the values for {{${i + 1}}}. Pick from the dropdown.`,
          );
          rowFailed = true;
          break;
        }
        params.push({ key: key || `param${i + 1}`, label: '', source });
      }

      if (rowFailed) return;

      const code = text(3);
      const parsed = whatsappTemplateSchema.safeParse({
        // Positional and disposable — the editor reassigns ids on the way out,
        // so this only has to be unique within the file.
        id: `import-${rowNumber}`,
        label,
        campaignName,
        params,
        templateCode: code ? code : null,
        isActive: text(4).toUpperCase() !== 'FALSE',
      });

      if (!parsed.success) {
        const first = parsed.error.issues[0];
        errors.push(`Row ${rowNumber}: ${first?.message ?? 'could not be read'}.`);
        return;
      }

      templates.push(parsed.data);
    });

    const seen = new Set<string>();
    for (const template of templates) {
      const key = template.campaignName.toLowerCase();
      if (seen.has(key)) {
        errors.push(
          `"${template.campaignName}" appears more than once. AiSensy addresses a send by campaign name, so two rows sharing one would be indistinguishable.`,
        );
      }
      seen.add(key);
    }

    return { templates, errors };
  }
}
