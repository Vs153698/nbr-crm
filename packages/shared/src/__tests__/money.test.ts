import { describe, expect, it } from 'vitest';
import { computePaymentPlan, formatINR, settle, toPaise, toRupees } from '../index';

/**
 * Money is the one place a rounding bug becomes a legal problem, so these tests
 * are deliberately paranoid about the cases floats get wrong.
 */
describe('money maths', () => {
  it('parses and renders without float drift', () => {
    expect(toPaise('4500.00')).toBe(450_000);
    expect(toPaise('0.1')).toBe(10);
    expect(toPaise('0.2')).toBe(20);
    // The canonical float failure: 0.1 + 0.2 !== 0.3
    expect(toRupees(toPaise('0.1') + toPaise('0.2'))).toBe('0.30');
    expect(toRupees(450_000)).toBe('4500.00');
  });

  it('rounds half-up on the third decimal', () => {
    expect(toPaise('1.005')).toBe(101);
    expect(toPaise('1.004')).toBe(100);
  });

  it('handles negative amounts for reversals', () => {
    expect(toPaise('-500.50')).toBe(-50_050);
    expect(toRupees(-50_050)).toBe('-500.50');
  });

  it('applies discount before GST, per the §9 rule', () => {
    const plan = computePaymentPlan({ amount: '5000.00', gstPercent: '18.00', discount: '500.00' });

    expect(plan.taxableValue).toBe('4500.00');
    // 18% of 4,500 — not of 5,000.
    expect(plan.gstAmount).toBe('810.00');
    expect(plan.finalAmount).toBe('5310.00');
  });

  it('satisfies the database CHECK constraint it mirrors', () => {
    // final_amount = taxable_value + gst_amount, and taxable = amount - discount
    for (const [amount, discount, gst] of [
      ['2500.00', '0.00', '18.00'],
      ['10000.00', '1500.00', '18.00'],
      ['15000.00', '999.99', '5.00'],
      ['1.00', '0.00', '18.00'],
    ] as const) {
      const plan = computePaymentPlan({ amount, gstPercent: gst, discount });

      expect(toPaise(plan.taxableValue)).toBe(toPaise(amount) - toPaise(discount));
      expect(toPaise(plan.finalAmount)).toBe(toPaise(plan.taxableValue) + toPaise(plan.gstAmount));
    }
  });

  it('caps the discount at the package amount', () => {
    const plan = computePaymentPlan({ amount: '1000.00', gstPercent: '18.00', discount: '5000.00' });
    expect(plan.discount).toBe('1000.00');
    expect(plan.taxableValue).toBe('0.00');
    expect(plan.finalAmount).toBe('0.00');
  });

  it('rejects a negative package amount', () => {
    expect(() => computePaymentPlan({ amount: '-100.00', gstPercent: '18.00' })).toThrow(RangeError);
  });

  it('derives payment status from the transactions, not a stored flag', () => {
    const unpaid = settle({ finalAmount: '5310.00', transactions: [] });
    expect(unpaid.isSettled).toBe(false);
    expect(unpaid.balanceDue).toBe('5310.00');

    const partial = settle({ finalAmount: '5310.00', transactions: ['2000.00', '500.00'] });
    expect(partial.isPartial).toBe(true);
    expect(partial.isSettled).toBe(false);
    expect(partial.amountPaid).toBe('2500.00');
    expect(partial.balanceDue).toBe('2810.00');

    const settled = settle({ finalAmount: '5310.00', transactions: ['2000.00', '500.00', '2810.00'] });
    expect(settled.isSettled).toBe(true);
    expect(settled.balanceDue).toBe('0.00');
  });

  it('never reports a negative balance', () => {
    const overpaid = settle({ finalAmount: '1000.00', transactions: ['1500.00'] });
    expect(overpaid.isOverpaid).toBe(true);
    expect(overpaid.balanceDue).toBe('0.00');
  });

  it('nets a reversal out of the paid total', () => {
    const corrected = settle({ finalAmount: '5000.00', transactions: ['3000.00', '-3000.00', '5000.00'] });
    expect(corrected.amountPaid).toBe('5000.00');
    expect(corrected.isSettled).toBe(true);
  });

  it('formats Indian currency with lakh grouping', () => {
    expect(formatINR('450000.00')).toContain('4,50,000');
  });
});
