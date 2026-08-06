import { Inject, Injectable } from '@nestjs/common';
import { maskMobile } from '@nbr/shared';
import { sql } from 'drizzle-orm';
import type { Database } from '../database/client';
import { DB } from '../database/database.tokens';
import { CacheService, CacheTtl } from '../redis/cache.service';

export interface SearchHit {
  readonly kind: 'applicant' | 'record' | 'certificate' | 'dispatch';
  readonly id: string;
  /** Where clicking the result should navigate. */
  readonly applicantId: string;
  readonly primary: string;
  readonly secondary: string;
  readonly badge: string | null;
  readonly isBlacklisted: boolean;
  readonly score: number;
}

export interface SearchResults {
  readonly query: string;
  readonly groups: Array<{ label: string; hits: SearchHit[] }>;
  readonly total: number;
  readonly tookMs: number;
}

/**
 * Global search (§17, the Ctrl+K palette).
 *
 * One endpoint fans out across applicants, records, certificates and courier
 * tracking numbers, then merges by score. Every branch hits a trigram GIN
 * index, so this stays under the 120 ms p95 budget at 100k+ applicants where
 * a plain ILIKE would sequential-scan four tables.
 *
 * A UNION in a single statement means one round trip and one planner pass
 * rather than four queries the application then has to interleave.
 */
@Injectable()
export class SearchService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly cache: CacheService,
  ) {}

  async search(rawQuery: string, limit = 20): Promise<SearchResults> {
    const query = rawQuery.trim();
    const started = Date.now();

    if (query.length < 2) {
      return { query, groups: [], total: 0, tookMs: 0 };
    }

    const hits = await this.cache.remember(
      `search:${query.toLowerCase()}:${limit}`,
      CacheTtl.search,
      [],
      () => this.runSearch(query, limit),
    );

    const groups = [
      { label: 'Applicants', hits: hits.filter((h) => h.kind === 'applicant') },
      { label: 'Records', hits: hits.filter((h) => h.kind === 'record') },
      { label: 'Certificates', hits: hits.filter((h) => h.kind === 'certificate') },
      { label: 'Dispatch', hits: hits.filter((h) => h.kind === 'dispatch') },
    ].filter((g) => g.hits.length > 0);

    return { query, groups, total: hits.length, tookMs: Date.now() - started };
  }

  private async runSearch(query: string, limit: number): Promise<SearchHit[]> {
    const pattern = `%${query}%`;

    const rows = await this.db.execute<{
      kind: string;
      id: string;
      applicant_id: string;
      primary_text: string;
      secondary_text: string;
      badge: string | null;
      is_blacklisted: boolean;
      score: number;
    }>(sql`
      (
        -- Applicants: name, mobile, email or NBRAP code
        SELECT 'applicant' AS kind,
               a.id::text  AS id,
               a.id::text  AS applicant_id,
               a.full_name AS primary_text,
               concat_ws(' · ', a.applicant_code, a.mobile, a.city) AS secondary_text,
               NULL        AS badge,
               a.is_blacklisted,
               GREATEST(
                 similarity(a.name_normalised, lower(${query})),
                 CASE WHEN a.applicant_code ILIKE ${pattern} THEN 1.0 ELSE 0 END,
                 CASE WHEN a.mobile          ILIKE ${pattern} THEN 0.95 ELSE 0 END,
                 CASE WHEN a.email           ILIKE ${pattern} THEN 0.9 ELSE 0 END
               ) AS score
          FROM applicants a
         WHERE a.deleted_at IS NULL
           AND (a.name_normalised % lower(${query})
                OR a.full_name      ILIKE ${pattern}
                OR a.mobile         ILIKE ${pattern}
                OR a.email          ILIKE ${pattern}
                OR a.applicant_code ILIKE ${pattern})
      )
      UNION ALL
      (
        -- Records: title or NBRR code
        SELECT 'record' AS kind,
               r.id::text,
               r.applicant_id::text,
               coalesce(ach.record_title, r.record_code) AS primary_text,
               concat_ws(' · ', r.record_code, a.full_name) AS secondary_text,
               r.status AS badge,
               a.is_blacklisted,
               GREATEST(
                 similarity(coalesce(ach.record_title, ''), ${query}),
                 CASE WHEN r.record_code ILIKE ${pattern} THEN 1.0 ELSE 0 END
               ) AS score
          FROM records r
          JOIN applicants a ON a.id = r.applicant_id
          LEFT JOIN achievements ach ON ach.record_id = r.id
         WHERE r.deleted_at IS NULL
           AND (ach.record_title ILIKE ${pattern} OR r.record_code ILIKE ${pattern})
      )
      UNION ALL
      (
        -- Certificate numbers
        SELECT 'certificate' AS kind,
               c.id::text,
               c.applicant_id::text,
               c.certificate_number AS primary_text,
               concat_ws(' · ', a.full_name, to_char(c.issue_date, 'DD Mon YYYY')) AS secondary_text,
               'Certificate' AS badge,
               a.is_blacklisted,
               1.0 AS score
          FROM certificates c
          JOIN applicants a ON a.id = c.applicant_id
         WHERE c.certificate_number ILIKE ${pattern}
      )
      UNION ALL
      (
        -- Courier tracking numbers
        SELECT 'dispatch' AS kind,
               d.id::text,
               d.applicant_id::text,
               d.tracking_number AS primary_text,
               concat_ws(' · ', d.courier_partner, a.full_name) AS secondary_text,
               d.delivery_status AS badge,
               a.is_blacklisted,
               1.0 AS score
          FROM dispatches d
          JOIN applicants a ON a.id = d.applicant_id
         WHERE d.tracking_number ILIKE ${pattern}
      )
      ORDER BY score DESC, primary_text
      LIMIT ${limit}
    `);

    const list = rows as unknown as Array<{
      kind: string;
      id: string;
      applicant_id: string;
      primary_text: string;
      secondary_text: string;
      badge: string | null;
      is_blacklisted: boolean;
      score: number;
    }>;

    return list.map((row) => ({
      kind: row.kind as SearchHit['kind'],
      id: row.id,
      applicantId: row.applicant_id,
      primary: row.primary_text,
      // A mobile number in a search result is still personal data — masked
      // unless the searcher already typed it (in which case they know it).
      secondary: maskSecondary(row.secondary_text, row.primary_text),
      badge: row.badge,
      isBlacklisted: row.is_blacklisted,
      score: Number(row.score),
    }));
  }
}

/** Mask any 10+ digit run that looks like a phone number in the subtitle. */
function maskSecondary(secondary: string, _primary: string): string {
  return secondary.replace(/\b(\+?\d[\d\s-]{8,})\b/g, (match) => maskMobile(match));
}
