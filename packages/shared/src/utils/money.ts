/**
 * Money maths in integer paise.
 *
 * Postgres stores amounts as NUMERIC(12,2) and the driver hands them back as
 * strings. Every calculation here converts to integer paise first so we never
 * touch a float — `0.1 + 0.2` problems in an invoice are not acceptable.
 */

export type Rupees = string;

const PAISE_PER_RUPEE = 100;

/** Parse a NUMERIC(12,2) string (or number) into integer paise. */
export function toPaise(amount: Rupees | number | null | undefined): number {
  if (amount === null || amount === undefined || amount === '') return 0;
  const text = typeof amount === 'number' ? amount.toFixed(2) : amount.trim();
  const negative = text.startsWith('-');
  const unsigned = negative ? text.slice(1) : text;
  const [wholePart = '0', fracPart = ''] = unsigned.split('.');
  const whole = Number.parseInt(wholePart || '0', 10);
  if (!Number.isFinite(whole)) {
    throw new TypeError(`Not a valid amount: ${String(amount)}`);
  }
  // Pad/truncate to exactly two decimal places, rounding half-up on the third.
  const frac2 = fracPart.padEnd(3, '0').slice(0, 3);
  const base = Number.parseInt(frac2.slice(0, 2), 10);
  const roundUp = Number.parseInt(frac2.slice(2, 3), 10) >= 5 ? 1 : 0;
  const paise = whole * PAISE_PER_RUPEE + base + roundUp;
  return negative ? -paise : paise;
}

/** Render integer paise back to a NUMERIC(12,2)-safe string. */
export function toRupees(paise: number): Rupees {
  const negative = paise < 0;
  const abs = Math.abs(Math.round(paise));
  const whole = Math.floor(abs / PAISE_PER_RUPEE);
  const frac = abs % PAISE_PER_RUPEE;
  return `${negative ? '-' : ''}${whole}.${String(frac).padStart(2, '0')}`;
}

export interface PaymentPlanInput {
  /** Package base amount, before GST and discount. */
  readonly amount: Rupees;
  /** GST percentage, e.g. "18.00". */
  readonly gstPercent: Rupees;
  /** Flat discount in rupees applied to the base amount. */
  readonly discount?: Rupees;
}

export interface PaymentPlanBreakdown {
  readonly amount: Rupees;
  readonly discount: Rupees;
  readonly taxableValue: Rupees;
  readonly gstPercent: Rupees;
  readonly gstAmount: Rupees;
  readonly finalAmount: Rupees;
}

/**
 * Canonical money rule (§9): discount applies to the base amount, GST is
 * charged on the discounted (taxable) value, final = taxable + GST.
 * The same function runs on the server and in the browser so the figure in the
 * modal is byte-identical to the figure written to the database.
 */
export function computePaymentPlan(input: PaymentPlanInput): PaymentPlanBreakdown {
  const amountPaise = toPaise(input.amount);
  const discountPaise = Math.min(toPaise(input.discount ?? '0'), amountPaise);

  if (amountPaise < 0) throw new RangeError('Package amount cannot be negative');
  if (discountPaise < 0) throw new RangeError('Discount cannot be negative');

  const taxablePaise = amountPaise - discountPaise;
  const gstPercentPaise = toPaise(input.gstPercent); // e.g. 18.00 -> 1800
  // taxable × percent / 100, rounded half-up, all in integer space.
  const gstPaise = Math.round((taxablePaise * gstPercentPaise) / (100 * PAISE_PER_RUPEE));
  const finalPaise = taxablePaise + gstPaise;

  return {
    amount: toRupees(amountPaise),
    discount: toRupees(discountPaise),
    taxableValue: toRupees(taxablePaise),
    gstPercent: toRupees(gstPercentPaise),
    gstAmount: toRupees(gstPaise),
    finalAmount: toRupees(finalPaise),
  };
}

export interface SettlementInput {
  readonly finalAmount: Rupees;
  /** Every successful transaction recorded against this payment plan. */
  readonly transactions: readonly Rupees[];
}

export interface Settlement {
  readonly finalAmount: Rupees;
  readonly amountPaid: Rupees;
  readonly balanceDue: Rupees;
  readonly isSettled: boolean;
  readonly isPartial: boolean;
  readonly isOverpaid: boolean;
}

/**
 * Payment status is *derived* from SUM(transactions) vs final amount — never
 * stored as an independently editable field, so the two can't drift apart.
 */
export function settle(input: SettlementInput): Settlement {
  const finalPaise = toPaise(input.finalAmount);
  const paidPaise = input.transactions.reduce<number>((sum, t) => sum + toPaise(t), 0);
  const balancePaise = finalPaise - paidPaise;

  return {
    finalAmount: toRupees(finalPaise),
    amountPaid: toRupees(paidPaise),
    balanceDue: toRupees(Math.max(balancePaise, 0)),
    isSettled: balancePaise <= 0 && finalPaise > 0,
    isPartial: paidPaise > 0 && balancePaise > 0,
    isOverpaid: balancePaise < 0,
  };
}

/** Indian-format currency for the UI: ₹4,50,000.00 */
export function formatINR(amount: Rupees | number, options?: { decimals?: boolean }): string {
  const paise = toPaise(amount);
  const showDecimals = options?.decimals ?? true;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  }).format(paise / PAISE_PER_RUPEE);
}

/** Compact currency for stat cards: ₹18.76L, ₹1.2Cr */
export function formatINRCompact(amount: Rupees | number): string {
  const rupees = toPaise(amount) / PAISE_PER_RUPEE;
  const abs = Math.abs(rupees);
  if (abs >= 1_00_00_000) return `₹${(rupees / 1_00_00_000).toFixed(2)}Cr`;
  if (abs >= 1_00_000) return `₹${(rupees / 1_00_000).toFixed(2)}L`;
  if (abs >= 1_000) return `₹${(rupees / 1_000).toFixed(1)}K`;
  return formatINR(amount, { decimals: false });
}
