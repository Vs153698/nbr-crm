/**
 * Normalisation and masking for personal identifiers.
 *
 * Duplicate detection (§18) only works if "+91 98765 43210", "098765 43210"
 * and "9876543210" collapse to the same key, so every write path stores a
 * normalised copy alongside the display value. Masking keeps government IDs
 * out of screens, logs and exports unless the caller holds `pii:reveal`.
 */

/**
 * Reduce an Indian mobile number to its 10 significant digits.
 * Returns null when the input can't be a valid mobile — callers treat null as
 * "don't index this for duplicate matching".
 */
export function normaliseMobile(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = input.replace(/\D/g, '');
  if (digits.length < 10) return null;
  // Keep the last 10 digits: strips +91, 0091, and a leading 0 alike.
  const last10 = digits.slice(-10);
  // Indian mobile numbers start 6–9. Anything else is likely a landline or junk.
  return /^[6-9]\d{9}$/.test(last10) ? last10 : digits.slice(-12);
}

/** Full E.164 for click-to-chat links. Defaults to +91 when no country code. */
export function toE164(
  input: string | null | undefined,
  defaultCountryCode = '91',
): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 10) return null;
  if (trimmed.startsWith('+')) return `+${digits}`;
  if (digits.length === 10) return `+${defaultCountryCode}${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) {
    return `+${defaultCountryCode}${digits.slice(1)}`;
  }
  return `+${digits}`;
}

/** Lowercase + trim. Deliberately does NOT strip gmail dots — two accounts
 *  that differ only by a dot are still two accounts to the applicant. */
export function normaliseEmail(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

/** Collapse whitespace, strip punctuation and lowercase, for fuzzy name match. */
export function normaliseName(input: string | null | undefined): string | null {
  if (!input) return null;
  const cleaned = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return cleaned.length > 0 ? cleaned : null;
}

/** Aadhaar: 12 digits, Verhoeff checksum. Used only to validate, never to log. */
const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
] as const;

const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
] as const;

export function isValidAadhaar(input: string | null | undefined): boolean {
  if (!input) return false;
  const digits = input.replace(/\D/g, '');
  if (!/^[2-9]\d{11}$/.test(digits)) return false;

  let checksum = 0;
  const reversed = digits.split('').reverse();
  for (let i = 0; i < reversed.length; i += 1) {
    const digit = Number(reversed[i]);
    const permuted = VERHOEFF_P[i % 8]![digit]!;
    checksum = VERHOEFF_D[checksum]![permuted]!;
  }
  return checksum === 0;
}

/** Indian passport: one letter, 7 digits (the first char is never Q/X/Z). */
export function isValidIndianPassport(input: string | null | undefined): boolean {
  if (!input) return false;
  return /^[A-PR-WY][0-9]{7}$/.test(input.trim().toUpperCase());
}

/** Indian PIN code: 6 digits, never starting with 0. */
export function isValidPincode(input: string | null | undefined): boolean {
  if (!input) return false;
  return /^[1-9][0-9]{5}$/.test(input.trim());
}

/**
 * Mask a government identifier for display. Aadhaar renders as XXXX XXXX 1234 —
 * showing only the last four is the pattern UIDAI itself uses.
 */
export function maskIdentifier(value: string | null | undefined, visibleTail = 4): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (trimmed.length <= visibleTail) return '•'.repeat(trimmed.length);
  return '•'.repeat(trimmed.length - visibleTail) + trimmed.slice(-visibleTail);
}

export function maskAadhaar(value: string | null | undefined): string {
  if (!value) return '';
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 12) return maskIdentifier(value);
  return `XXXX XXXX ${digits.slice(-4)}`;
}

export function maskEmail(value: string | null | undefined): string {
  if (!value) return '';
  const [local = '', domain = ''] = value.split('@');
  if (!domain) return maskIdentifier(value);
  const head = local.slice(0, 2);
  return `${head}${'•'.repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

export function maskMobile(value: string | null | undefined): string {
  if (!value) return '';
  const digits = value.replace(/\D/g, '');
  if (digits.length < 4) return '•'.repeat(digits.length);
  return `${'•'.repeat(digits.length - 4)}${digits.slice(-4)}`;
}

/** Age in whole years as of `asOf`. Used for the DPDP §9 child check. */
export function ageInYears(dob: Date | string, asOf: Date = new Date()): number {
  const birth = typeof dob === 'string' ? new Date(dob) : dob;
  if (Number.isNaN(birth.getTime())) return Number.NaN;
  let age = asOf.getFullYear() - birth.getFullYear();
  const monthDelta = asOf.getMonth() - birth.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && asOf.getDate() < birth.getDate())) {
    age -= 1;
  }
  return age;
}

/** Sequential business IDs: NBRAP00001 / NBRR00001 (§P1-08). */
export function formatApplicantId(sequence: number): string {
  return `NBRAP${String(sequence).padStart(5, '0')}`;
}

export function formatRecordId(sequence: number): string {
  return `NBRR${String(sequence).padStart(5, '0')}`;
}

/** Certificate numbers are financial-year scoped: NBR/2026-27/00042 */
export function formatCertificateNumber(financialYear: string, sequence: number): string {
  return `NBR/${financialYear}/${String(sequence).padStart(5, '0')}`;
}

/** Invoice numbers share the financial-year series: NBR/INV/2026-27/00042 */
export function formatInvoiceNumber(financialYear: string, sequence: number): string {
  return `NBR/INV/${financialYear}/${String(sequence).padStart(5, '0')}`;
}

/** Indian financial year label for a date: 15 Aug 2026 -> "2026-27". */
export function financialYearOf(date: Date = new Date()): string {
  const year = date.getFullYear();
  // FY starts 1 April.
  const startYear = date.getMonth() >= 3 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}
