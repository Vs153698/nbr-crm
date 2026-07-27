import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Cryptography for personal data at rest (DPDP §8(4) "reasonable security
 * safeguards to prevent personal data breach").
 *
 * Aadhaar, passport and PAN numbers are encrypted with AES-256-GCM before they
 * reach Postgres, so a database dump, a stolen backup, or a SQL-injection read
 * yields ciphertext rather than 12-digit Aadhaar numbers. GCM is authenticated,
 * so tampered ciphertext fails to decrypt instead of returning garbage.
 *
 * Ciphertext envelope: `v<keyVersion>:<iv>:<authTag>:<ciphertext>`, base64
 * components. The version prefix is what makes key rotation possible without a
 * flag day — a row encrypted under the previous key still decrypts while the
 * re-encryption job works through the table.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit nonce, the GCM-recommended size
const KEY_BYTES = 32;
const CURRENT_KEY_VERSION = 1;

export interface CryptoKeys {
  /** Base64, 32 bytes. */
  readonly current: string;
  /** Optional previous key, kept readable during a rotation. */
  readonly previous?: string | undefined;
}

function decodeKey(base64: string, label: string): Buffer {
  const key = Buffer.from(base64, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(`${label} must decode to exactly ${KEY_BYTES} bytes`);
  }
  return key;
}

export class FieldCipher {
  private readonly currentKey: Buffer;
  private readonly previousKey: Buffer | null;
  /** Separate key for fingerprints, derived so a leaked HMAC key can't decrypt. */
  private readonly fingerprintKey: Buffer;

  constructor(keys: CryptoKeys) {
    this.currentKey = decodeKey(keys.current, 'PII_ENCRYPTION_KEY');
    this.previousKey = keys.previous
      ? decodeKey(keys.previous, 'PII_ENCRYPTION_KEY_PREVIOUS')
      : null;
    // Domain-separated subkey: HMAC of a fixed label under the master key.
    // Using the encryption key directly for both jobs is a classic key-reuse
    // mistake.
    this.fingerprintKey = createHmac('sha256', this.currentKey)
      .update('nbr-crm:identifier-fingerprint:v1')
      .digest();
  }

  encrypt(plaintext: string): string {
    if (plaintext.length === 0) {
      throw new Error('Refusing to encrypt an empty value');
    }
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.currentKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return [
      `v${CURRENT_KEY_VERSION}`,
      iv.toString('base64'),
      authTag.toString('base64'),
      ciphertext.toString('base64'),
    ].join(':');
  }

  decrypt(envelope: string): string {
    const parts = envelope.split(':');
    if (parts.length !== 4) {
      throw new Error('Malformed ciphertext envelope');
    }
    const [version, ivB64, tagB64, dataB64] = parts as [string, string, string, string];

    for (const key of this.candidateKeys(version)) {
      try {
        const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'));
        decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
        return Buffer.concat([
          decipher.update(Buffer.from(dataB64, 'base64')),
          decipher.final(),
        ]).toString('utf8');
      } catch {
        // Authentication failed under this key — try the next one. Falling
        // through to the previous key is what keeps a rotation non-breaking.
      }
    }

    throw new Error('Unable to decrypt value — wrong key, or the ciphertext was tampered with');
  }

  private candidateKeys(_version: string): Buffer[] {
    return this.previousKey ? [this.currentKey, this.previousKey] : [this.currentKey];
  }

  /**
   * Deterministic, keyed fingerprint of an identifier.
   *
   * Lets duplicate detection answer "has this Aadhaar been used before?"
   * without decrypting anything or storing a plaintext copy. Keyed (HMAC)
   * rather than a plain hash because the Aadhaar keyspace is small enough that
   * an unkeyed SHA-256 of every possible number is trivially precomputable.
   */
  fingerprint(value: string): string {
    const normalised = value.replace(/\s/g, '').toUpperCase();
    return createHmac('sha256', this.fingerprintKey).update(normalised).digest('hex');
  }

  /** Last N characters, for masked display without a decrypt round-trip. */
  static tail(value: string, count = 4): string {
    const cleaned = value.replace(/\s/g, '');
    return cleaned.slice(-count);
  }

  get keyVersion(): number {
    return CURRENT_KEY_VERSION;
  }

  /** True when a value was encrypted under the previous key and should be
   *  re-encrypted by the rotation job. */
  needsRotation(envelope: string): boolean {
    if (!this.previousKey) return false;
    try {
      const parts = envelope.split(':');
      if (parts.length !== 4) return false;
      const decipher = createDecipheriv(ALGORITHM, this.currentKey, Buffer.from(parts[1]!, 'base64'));
      decipher.setAuthTag(Buffer.from(parts[2]!, 'base64'));
      decipher.update(Buffer.from(parts[3]!, 'base64'));
      decipher.final();
      return false;
    } catch {
      return true;
    }
  }
}

/** SHA-256 hex digest — used for refresh-token and reset-token storage. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** URL-safe random token, e.g. for password-reset links. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Constant-time string comparison.
 *
 * Used for webhook signatures and token lookups: `===` leaks how many leading
 * characters matched through timing, which is enough to forge a signature byte
 * by byte given enough requests.
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on length mismatch, which would itself leak length.
  // Hashing first gives both sides a fixed 32-byte length.
  return timingSafeEqual(
    createHash('sha256').update(bufA).digest(),
    createHash('sha256').update(bufB).digest(),
  );
}

/**
 * Verify an inbound webhook signature (P2-14).
 *
 * Header format: `t=<unix seconds>,v1=<hex hmac>` where the signed payload is
 * `<timestamp>.<raw body>`. Including the timestamp inside the signature is
 * what stops a captured request being replayed a week later — without it, a
 * valid signature is valid forever.
 */
export interface WebhookVerification {
  readonly valid: boolean;
  readonly reason?: string;
}

export function verifyWebhookSignature(params: {
  header: string | undefined;
  rawBody: string;
  secret: string;
  toleranceSeconds: number;
  now?: Date;
}): WebhookVerification {
  const { header, rawBody, secret, toleranceSeconds, now = new Date() } = params;

  if (!header) return { valid: false, reason: 'missing_signature' };

  const parts = Object.fromEntries(
    header.split(',').map((segment) => {
      const [k, v] = segment.split('=');
      return [k?.trim() ?? '', v?.trim() ?? ''];
    }),
  );

  const timestamp = Number(parts.t);
  const signature = parts.v1;

  if (!Number.isFinite(timestamp) || !signature) {
    return { valid: false, reason: 'malformed_signature' };
  }

  const ageSeconds = Math.abs(Math.floor(now.getTime() / 1000) - timestamp);
  if (ageSeconds > toleranceSeconds) {
    return { valid: false, reason: 'timestamp_outside_tolerance' };
  }

  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');

  return safeEqual(expected, signature)
    ? { valid: true }
    : { valid: false, reason: 'signature_mismatch' };
}

/** Build a signature header — used by tests and by the outbound direction. */
export function signWebhookPayload(rawBody: string, secret: string, now = new Date()): string {
  const timestamp = Math.floor(now.getTime() / 1000);
  const signature = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return `t=${timestamp},v1=${signature}`;
}
