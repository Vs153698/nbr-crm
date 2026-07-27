import { Inject, Injectable } from '@nestjs/common';
import {
  DUPLICATE_MATCH_REASON,
  maskEmail,
  maskMobile,
  normaliseEmail,
  normaliseMobile,
  normaliseName,
  type DuplicateCheckInput,
  type DuplicateMatch,
  type DuplicateMatchReason,
} from '@nbr/shared';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import type { Database } from '../database/client';
import { DB } from '../database/database.tokens';
import * as schema from '../database/schema';
import { PiiService } from '../privacy/pii.service';

/**
 * Duplicate detection (§18).
 *
 * "One applicant = one master profile" only holds if the system actively stops
 * a second profile being created for the same person. This runs while the user
 * types on the Add Applicant form, and again server-side at save time — the
 * live check is a convenience, the save-time check is the guard.
 *
 * Two tiers of signal:
 *
 *  • **Exact identifier hits** (mobile, email, Aadhaar, passport) score 1.0.
 *    These are near-conclusive; a shared mobile number between two different
 *    people is rare enough to be worth a human glance every time.
 *  • **Fuzzy name matches** use the pg_trgm similarity index and score by
 *    similarity, boosted when the date of birth also matches. This catches
 *    "Rahul Verma" vs "Rahul Kumar Verma" vs "Rahul Vermaa", which is the
 *    common real-world case.
 *
 * The service never blocks on its own. It reports; the caller decides whether
 * to warn, require an Admin override, or hard-block (blacklist).
 */
@Injectable()
export class DuplicateService {
  /** Trigram similarity at or above this is worth showing a human. */
  private static readonly NAME_SIMILARITY_THRESHOLD = 0.45;
  /** With a matching DOB, a weaker name match is still a strong signal. */
  private static readonly NAME_WITH_DOB_THRESHOLD = 0.3;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly pii: PiiService,
  ) {}

  async check(input: DuplicateCheckInput): Promise<DuplicateMatch[]> {
    const matches = new Map<string, { reasons: Set<DuplicateMatchReason>; confidence: number }>();

    const add = (id: string, reason: DuplicateMatchReason, confidence: number) => {
      const existing = matches.get(id);
      if (existing) {
        existing.reasons.add(reason);
        // Several independent signals on the same person is stronger than the
        // strongest single one.
        existing.confidence = Math.min(1, Math.max(existing.confidence, confidence) + 0.1);
      } else {
        matches.set(id, { reasons: new Set([reason]), confidence });
      }
    };

    const exclude = input.excludeApplicantId;
    const notExcluded = exclude ? ne(schema.applicants.id, exclude) : undefined;
    const alive = isNull(schema.applicants.deletedAt);

    // ── Exact identifier probes ───────────────────────────────────────────
    const mobile = normaliseMobile(input.mobile);
    if (mobile) {
      const rows = await this.db
        .select({ id: schema.applicants.id })
        .from(schema.applicants)
        .where(and(eq(schema.applicants.mobileNormalised, mobile), alive, notExcluded))
        .limit(5);
      for (const row of rows) add(row.id, DUPLICATE_MATCH_REASON.MOBILE, 1);
    }

    const email = normaliseEmail(input.email);
    if (email) {
      const rows = await this.db
        .select({ id: schema.applicants.id })
        .from(schema.applicants)
        .where(and(eq(schema.applicants.emailNormalised, email), alive, notExcluded))
        .limit(5);
      for (const row of rows) add(row.id, DUPLICATE_MATCH_REASON.EMAIL, 1);
    }

    // Government identifiers are matched on their keyed HMAC fingerprint, so
    // this answers "same Aadhaar?" without decrypting a single stored value.
    if (input.aadhaarNumber) {
      const rows = await this.db
        .select({ applicantId: schema.applicantIdentifiers.applicantId })
        .from(schema.applicantIdentifiers)
        .where(
          eq(
            schema.applicantIdentifiers.aadhaarFingerprint,
            this.pii.fingerprint(input.aadhaarNumber),
          ),
        )
        .limit(5);
      for (const row of rows) {
        if (row.applicantId !== exclude) add(row.applicantId, DUPLICATE_MATCH_REASON.AADHAAR, 1);
      }
    }

    if (input.passportNumber) {
      const rows = await this.db
        .select({ applicantId: schema.applicantIdentifiers.applicantId })
        .from(schema.applicantIdentifiers)
        .where(
          eq(
            schema.applicantIdentifiers.passportFingerprint,
            this.pii.fingerprint(input.passportNumber),
          ),
        )
        .limit(5);
      for (const row of rows) {
        if (row.applicantId !== exclude) add(row.applicantId, DUPLICATE_MATCH_REASON.PASSPORT, 1);
      }
    }

    // ── Fuzzy name (+ DOB) ────────────────────────────────────────────────
    const name = normaliseName(input.fullName);
    if (name && name.length >= 3) {
      const dob = input.dateOfBirth ? toDateOnly(input.dateOfBirth) : null;
      const threshold = dob
        ? DuplicateService.NAME_WITH_DOB_THRESHOLD
        : DuplicateService.NAME_SIMILARITY_THRESHOLD;

      // `%` uses the GIN trigram index; `similarity()` then scores the
      // survivors. Filtering first and scoring second keeps this an index scan
      // rather than a sequential one over every applicant.
      const rows = await this.db
        .select({
          id: schema.applicants.id,
          similarity: sql<number>`similarity(${schema.applicants.nameNormalised}, ${name})`,
          dateOfBirth: schema.applicants.dateOfBirth,
        })
        .from(schema.applicants)
        .where(
          and(
            sql`${schema.applicants.nameNormalised} % ${name}`,
            sql`similarity(${schema.applicants.nameNormalised}, ${name}) >= ${threshold}`,
            alive,
            notExcluded,
          ),
        )
        .orderBy(sql`similarity(${schema.applicants.nameNormalised}, ${name}) DESC`)
        .limit(10);

      for (const row of rows) {
        const dobMatches = Boolean(dob && row.dateOfBirth === dob);
        if (dobMatches) {
          add(row.id, DUPLICATE_MATCH_REASON.NAME_DOB, Math.min(1, row.similarity + 0.35));
        } else if (row.similarity >= DuplicateService.NAME_SIMILARITY_THRESHOLD) {
          add(row.id, DUPLICATE_MATCH_REASON.FUZZY_NAME, row.similarity);
        }
      }
    }

    if (matches.size === 0) return [];

    return this.hydrate(matches);
  }

  /**
   * Turn match ids into the side-by-side comparison payload the warning banner
   * shows. Contact details come back masked — a duplicate warning must not
   * become a way to read another applicant's phone number.
   */
  private async hydrate(
    matches: Map<string, { reasons: Set<DuplicateMatchReason>; confidence: number }>,
  ): Promise<DuplicateMatch[]> {
    const ids = [...matches.keys()];

    const rows = await this.db
      .select({
        id: schema.applicants.id,
        applicantCode: schema.applicants.applicantCode,
        fullName: schema.applicants.fullName,
        mobile: schema.applicants.mobile,
        email: schema.applicants.email,
        city: schema.applicants.city,
        recordCount: schema.applicants.recordCount,
        isBlacklisted: schema.applicants.isBlacklisted,
      })
      .from(schema.applicants)
      .where(sql`${schema.applicants.id} = ANY(${sql.raw(`ARRAY['${ids.join("','")}']::uuid[]`)})`);

    return rows
      .map((row): DuplicateMatch => {
        const match = matches.get(row.id)!;
        return {
          applicantId: row.id,
          applicantCode: row.applicantCode,
          fullName: row.fullName,
          maskedMobile: maskMobile(row.mobile),
          maskedEmail: maskEmail(row.email),
          city: row.city,
          recordCount: row.recordCount,
          reasons: [...match.reasons],
          confidence: Number(match.confidence.toFixed(2)),
          isBlacklisted: row.isBlacklisted,
        };
      })
      .sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * A match strong enough that saving a *new* profile should require an
   * explicit choice from the user rather than a passive warning.
   */
  static isBlocking(matches: readonly DuplicateMatch[]): boolean {
    return matches.some(
      (m) =>
        m.confidence >= 0.99 ||
        m.reasons.includes(DUPLICATE_MATCH_REASON.MOBILE) ||
        m.reasons.includes(DUPLICATE_MATCH_REASON.AADHAAR) ||
        m.reasons.includes(DUPLICATE_MATCH_REASON.PASSPORT),
    );
  }
}

/** Postgres `date` columns round-trip as 'YYYY-MM-DD' strings. */
function toDateOnly(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return date.toISOString().slice(0, 10);
}
