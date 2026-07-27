import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { FieldCipher } from '../common/crypto';
import { ForbiddenError, NotFoundError } from '../common/errors';
import { requireActor } from '../common/request-context';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import type { Database } from '../database/client';
import { DB } from '../database/database.tokens';
import * as schema from '../database/schema';

export type IdentifierField = 'aadhaarNumber' | 'passportNumber' | 'panNumber';

export interface IdentifierInput {
  readonly aadhaarNumber?: string | undefined;
  readonly passportNumber?: string | undefined;
  readonly panNumber?: string | undefined;
}

export interface MaskedIdentifiers {
  readonly aadhaar: string | null;
  readonly passport: string | null;
  readonly pan: string | null;
  readonly hasAadhaar: boolean;
  readonly hasPassport: boolean;
  readonly hasPan: boolean;
}

/**
 * Government identifiers (DPDP §8(4)).
 *
 * The contract this service enforces:
 *
 *  • Values are AES-256-GCM encrypted before they touch Postgres.
 *  • Nothing outside this service ever sees plaintext, and the only way to get
 *    it is `reveal()`, which demands the `pii:reveal` permission and a typed
 *    justification.
 *  • The access log write happens *before* the value is returned. If the log
 *    write fails, the reveal fails — an unlogged decryption must not happen.
 *  • Duplicate detection uses keyed HMAC fingerprints, so "is this Aadhaar
 *    already on file?" is answerable without decrypting anything.
 */
@Injectable()
export class PiiService {
  private readonly cipher: FieldCipher;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) env: Env,
    private readonly audit: AuditService,
  ) {
    this.cipher = new FieldCipher({
      current: env.PII_ENCRYPTION_KEY,
      previous: env.PII_ENCRYPTION_KEY_PREVIOUS || undefined,
    });
  }

  /** Encrypt an identifier set into the column shape `applicant_identifiers` wants. */
  buildEncryptedRow(input: IdentifierInput): Record<string, unknown> | null {
    const row: Record<string, unknown> = { keyVersion: this.cipher.keyVersion };
    let any = false;

    if (input.aadhaarNumber) {
      const value = input.aadhaarNumber.replace(/\s/g, '');
      row.aadhaarEncrypted = this.cipher.encrypt(value);
      row.aadhaarFingerprint = this.cipher.fingerprint(value);
      row.aadhaarLast4 = FieldCipher.tail(value);
      any = true;
    }

    if (input.passportNumber) {
      const value = input.passportNumber.trim().toUpperCase();
      row.passportEncrypted = this.cipher.encrypt(value);
      row.passportFingerprint = this.cipher.fingerprint(value);
      row.passportLast4 = FieldCipher.tail(value);
      any = true;
    }

    if (input.panNumber) {
      const value = input.panNumber.trim().toUpperCase();
      row.panEncrypted = this.cipher.encrypt(value);
      row.panFingerprint = this.cipher.fingerprint(value);
      row.panLast4 = FieldCipher.tail(value);
      any = true;
    }

    return any ? row : null;
  }

  /** Keyed fingerprint, for the duplicate-detection probe. */
  fingerprint(value: string): string {
    return this.cipher.fingerprint(value);
  }

  /**
   * Safe-to-render view. This is what every profile, list and export gets —
   * `XXXX XXXX 1234`, never the full number.
   */
  async getMasked(applicantId: string): Promise<MaskedIdentifiers> {
    const [row] = await this.db
      .select({
        aadhaarLast4: schema.applicantIdentifiers.aadhaarLast4,
        passportLast4: schema.applicantIdentifiers.passportLast4,
        panLast4: schema.applicantIdentifiers.panLast4,
        aadhaarEncrypted: schema.applicantIdentifiers.aadhaarEncrypted,
        passportEncrypted: schema.applicantIdentifiers.passportEncrypted,
        panEncrypted: schema.applicantIdentifiers.panEncrypted,
      })
      .from(schema.applicantIdentifiers)
      .where(eq(schema.applicantIdentifiers.applicantId, applicantId))
      .limit(1);

    if (!row) {
      return {
        aadhaar: null,
        passport: null,
        pan: null,
        hasAadhaar: false,
        hasPassport: false,
        hasPan: false,
      };
    }

    return {
      aadhaar: row.aadhaarLast4 ? `XXXX XXXX ${row.aadhaarLast4}` : null,
      passport: row.passportLast4 ? `••••${row.passportLast4}` : null,
      pan: row.panLast4 ? `••••••${row.panLast4}` : null,
      hasAadhaar: Boolean(row.aadhaarEncrypted),
      hasPassport: Boolean(row.passportEncrypted),
      hasPan: Boolean(row.panEncrypted),
    };
  }

  /**
   * Decrypt one identifier. Requires `pii:reveal` and a written reason, and
   * writes the access log before returning — deliberately in that order.
   */
  async reveal(
    applicantId: string,
    field: IdentifierField,
    reason: string,
  ): Promise<{ value: string; field: IdentifierField }> {
    const actor = requireActor();

    if (!actor.isSuperAdmin && !actor.permissions.has('pii:reveal')) {
      throw new ForbiddenError(
        'You do not have permission to view government identifiers.',
      );
    }

    const [row] = await this.db
      .select()
      .from(schema.applicantIdentifiers)
      .where(eq(schema.applicantIdentifiers.applicantId, applicantId))
      .limit(1);

    if (!row) throw new NotFoundError('Identifier');

    const columnByField: Record<IdentifierField, string | null> = {
      aadhaarNumber: row.aadhaarEncrypted,
      passportNumber: row.passportEncrypted,
      panNumber: row.panEncrypted,
    };

    const envelope = columnByField[field];
    if (!envelope) throw new NotFoundError('Identifier');

    // Log first. A reveal we cannot account for must not happen at all —
    // recordPiiAccess throws on failure, unlike the general audit writer.
    await this.audit.recordPiiAccess({
      applicantId,
      field: field.replace('Number', ''),
      accessType: 'reveal',
      reason,
    });

    return { value: this.cipher.decrypt(envelope), field };
  }

  /**
   * Destroy the identifiers for an applicant (DPDP §12 erasure, and the
   * shortest-retention category in the §8(7) schedule).
   *
   * Overwrites rather than deletes the row so the fact that identifiers once
   * existed — and were erased — remains visible.
   */
  async erase(applicantId: string, tx?: Database): Promise<void> {
    await (tx ?? this.db)
      .update(schema.applicantIdentifiers)
      .set({
        aadhaarEncrypted: null,
        aadhaarFingerprint: null,
        aadhaarLast4: null,
        passportEncrypted: null,
        passportFingerprint: null,
        passportLast4: null,
        panEncrypted: null,
        panFingerprint: null,
        panLast4: null,
      })
      .where(eq(schema.applicantIdentifiers.applicantId, applicantId));
  }
}
