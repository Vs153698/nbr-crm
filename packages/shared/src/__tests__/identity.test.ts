import { describe, expect, it } from 'vitest';
import {
  ageInYears,
  financialYearOf,
  formatApplicantId,
  formatCertificateNumber,
  isValidAadhaar,
  maskAadhaar,
  maskEmail,
  maskMobile,
  normaliseEmail,
  normaliseMobile,
  normaliseName,
  renderTemplate,
  validateTemplate,
} from '../index';

/**
 * Normalisation is what makes duplicate detection work at all — if
 * "+91 98765 43210" and "9876543210" don't collapse to the same key, the
 * one-profile-per-person rule silently stops holding.
 */
describe('identifier normalisation', () => {
  it('collapses every common way of writing an Indian mobile', () => {
    const expected = '9876543210';
    for (const input of [
      '9876543210',
      '+91 98765 43210',
      '+919876543210',
      '098765 43210',
      '0091-9876543210',
      '98765-43210',
      ' 9876543210 ',
    ]) {
      expect(normaliseMobile(input), `failed for "${input}"`).toBe(expected);
    }
  });

  it('returns null for something that cannot be a mobile', () => {
    expect(normaliseMobile('12345')).toBeNull();
    expect(normaliseMobile('')).toBeNull();
    expect(normaliseMobile(null)).toBeNull();
  });

  it('lowercases email but keeps dots — two addresses, two people', () => {
    expect(normaliseEmail('  Rahul.Verma@Example.COM ')).toBe('rahul.verma@example.com');
    expect(normaliseEmail('rahulverma@example.com')).not.toBe(
      normaliseEmail('rahul.verma@example.com'),
    );
  });

  it('strips punctuation and case from names for fuzzy matching', () => {
    expect(normaliseName('  Rahul   Kumar  Verma ')).toBe('rahul kumar verma');
    expect(normaliseName("O'Brien-Smith")).toBe('o brien smith');
    expect(normaliseName('राहुल')).toBe('राहुल');
  });

  it('validates Aadhaar with the Verhoeff checksum', () => {
    // Structurally valid but a bad checksum must be rejected.
    expect(isValidAadhaar('234567890123')).toBe(false);
    // Aadhaar never starts 0 or 1.
    expect(isValidAadhaar('012345678901')).toBe(false);
    expect(isValidAadhaar('12345')).toBe(false);
    expect(isValidAadhaar(null)).toBe(false);
  });
});

describe('masking', () => {
  it('shows only the last four digits of an Aadhaar', () => {
    expect(maskAadhaar('234567890123')).toBe('XXXX XXXX 0123');
    expect(maskAadhaar('2345 6789 0123')).toBe('XXXX XXXX 0123');
  });

  it('never leaks a full mobile or email', () => {
    const masked = maskMobile('9876543210');
    expect(masked).toContain('3210');
    expect(masked).not.toContain('98765');

    const maskedEmail = maskEmail('rahul.verma@example.com');
    expect(maskedEmail).toContain('@example.com');
    expect(maskedEmail).not.toContain('rahul.verma');
  });
});

describe('business identifiers', () => {
  it('formats zero-padded applicant and certificate IDs', () => {
    expect(formatApplicantId(1)).toBe('NBRAP00001');
    expect(formatApplicantId(12_548)).toBe('NBRAP12548');
    expect(formatCertificateNumber('2026-27', 42)).toBe('NBR/2026-27/00042');
  });

  it('starts the financial year on 1 April', () => {
    expect(financialYearOf(new Date('2026-03-31'))).toBe('2025-26');
    expect(financialYearOf(new Date('2026-04-01'))).toBe('2026-27');
    expect(financialYearOf(new Date('2026-12-31'))).toBe('2026-27');
  });

  it('computes age without rounding a birthday early', () => {
    const asOf = new Date('2026-07-27');
    expect(ageInYears('1998-01-12', asOf)).toBe(28);
    // Birthday tomorrow — still the younger age today.
    expect(ageInYears('2008-07-28', asOf)).toBe(17);
    expect(ageInYears('2008-07-27', asOf)).toBe(18);
  });
});

describe('template rendering', () => {
  it('substitutes known placeholders and reports missing ones', () => {
    const result = renderTemplate('Dear {{applicant_name}}, your record {{record_title}} is ready.', {
      applicant_name: 'Rahul Verma',
    });

    expect(result.output).toBe('Dear Rahul Verma, your record  is ready.');
    expect(result.missing).toContain('record_title');
  });

  it('refuses to resolve anything outside the supported vocabulary', () => {
    // A template is Admin-editable data; the renderer must not be able to reach
    // into arbitrary properties.
    const result = renderTemplate('{{constructor}} {{__proto__}} {{password}}', {});
    expect(result.unknown).toHaveLength(3);
    expect(result.output).toContain('{{constructor}}');
  });

  it('validates templates at save time, not send time', () => {
    expect(validateTemplate('Hello {{applicant_name}}').valid).toBe(true);

    const invalid = validateTemplate('Hello {{applicnat_name}}');
    expect(invalid.valid).toBe(false);
    expect(invalid.unknown).toContain('applicnat_name');
  });
});
