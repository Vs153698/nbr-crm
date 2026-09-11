/**
 * How quickly a record is worked through (DEV-001).
 *
 * Chosen by the applicant on the website form, or by staff filing on their
 * behalf, and carried on the record for the rest of its life. It is a promise
 * about turnaround, so it is held as its own fact rather than inferred from
 * whether a surcharge was paid: someone who chose priority and was later
 * refunded still chose priority, and conflating the two loses that.
 */
export const PROCESSING_TYPE = {
  STANDARD: 'standard',
  PRIORITY: 'priority',
} as const;

export type ProcessingType = (typeof PROCESSING_TYPE)[keyof typeof PROCESSING_TYPE];

export interface ProcessingTypeMeta {
  readonly label: string;
  readonly turnaround: string;
  /** Null when the option carries no extra charge. */
  readonly surcharge: string | null;
  /** Badge tone, so every surface renders it the same way. */
  readonly tone: 'slate' | 'orange';
}

/** Wording as it appears on the public form, so all surfaces agree. */
export const PROCESSING_TYPE_META: Readonly<Record<ProcessingType, ProcessingTypeMeta>> = {
  [PROCESSING_TYPE.STANDARD]: {
    label: 'Standard Processing',
    turnaround: '2–10 weeks',
    surcharge: null,
    tone: 'slate',
  },
  [PROCESSING_TYPE.PRIORITY]: {
    label: 'Priority Processing',
    turnaround: '1–3 working days',
    surcharge: '+₹500',
    tone: 'orange',
  },
};

export const PROCESSING_TYPES: readonly ProcessingType[] = Object.values(PROCESSING_TYPE);

/** "Priority Processing (+₹500)" — the form's own wording. */
export function processingTypeLabel(value: string | null | undefined): string {
  const meta = PROCESSING_TYPE_META[value as ProcessingType] ?? PROCESSING_TYPE_META.standard;
  return meta.surcharge ? `${meta.label} (${meta.surcharge})` : meta.label;
}

/**
 * What priority processing adds to the bill, in rupees.
 *
 * Rupees because that is the unit this system's money columns use — the
 * website stores paise and keeps its own copy of this figure. The two are the
 * same charge expressed in different units, and both are the advertised ₹500.
 */
export const PRIORITY_SURCHARGE = 500;

/**
 * The priority line to split out of an invoice total, in rupees — 0 for none.
 *
 * Guarded against the invoiced figure rather than derived from the processing
 * type alone. Invoice amounts are frozen at issue, so a record switched to
 * priority afterwards would otherwise grow a charge on a document already sent
 * — and a surcharge larger than the invoice would leave the package line at
 * zero or negative, which is worse than not splitting it at all.
 */
export function priorityInvoiceLine(
  processingType: string | null | undefined,
  invoiceAmount: number,
): number {
  if (processingType !== PROCESSING_TYPE.PRIORITY) return 0;
  return invoiceAmount > PRIORITY_SURCHARGE ? PRIORITY_SURCHARGE : 0;
}

/**
 * DEV-002. What NBR charges to send an adjudicator, in rupees.
 *
 * Rupees because that is the unit this system's money columns use; the website
 * stores paise and keeps its own copy. Same charge, different unit.
 */
export const ADJUDICATOR_FEE = 100_000;

export interface InvoiceFeeLine {
  readonly label: string;
  readonly note: string;
  readonly amount: number;
}

/**
 * The optional charges to split out of an invoice total, in rupees.
 *
 * Guarded against the invoiced figure rather than derived from the record
 * alone. Invoice amounts are frozen at issue, so a record that opts into
 * something afterwards must not retroactively grow a charge on a document
 * already sent — and a fee larger than the invoice would leave the package line
 * at zero or negative, which is worse than not splitting it at all.
 *
 * All or nothing, deliberately. Allocating fees one at a time while headroom
 * lasts misattributes: a record carrying both charges, invoiced for the
 * ₹1,00,000 adjudicator but not the ₹500 surcharge, has enough headroom for the
 * cheaper line and would print "Priority Processing" — the wrong charge, and
 * ₹99,500 understated. A partial figure cannot be attributed without guessing,
 * so it is not attributed at all.
 */
export function invoiceFeeLines(
  record: {
    processingType?: string | null
    adjudicatorRequested?: boolean | null
    adjudicatorFeeDue?: boolean | null
  },
  invoiceAmount: number,
): InvoiceFeeLine[] {
  const candidates: InvoiceFeeLine[] = [];

  if (record.processingType === PROCESSING_TYPE.PRIORITY) {
    candidates.push({
      label: 'Priority Processing',
      note: 'issued within 1-3 working days',
      amount: PRIORITY_SURCHARGE,
    });
  }

  /**
   * Charged only when it was requested *and* NBR is collecting for it. A waived
   * or separately-settled fee is not part of this invoice, and splitting a line
   * out for it would make the figures disagree with what was paid.
   */
  if (record.adjudicatorRequested === true && record.adjudicatorFeeDue !== false) {
    candidates.push({
      label: 'Adjudicator Fee',
      note: 'official adjudicator present to verify the attempt',
      amount: ADJUDICATOR_FEE,
    });
  }

  const total = candidates.reduce((sum, line) => sum + line.amount, 0);

  // Strictly less than, so the package line never falls to zero or negative.
  return total > 0 && total < invoiceAmount ? candidates : [];
}
