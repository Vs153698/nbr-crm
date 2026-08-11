import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { Sql } from 'postgres';
import { createDatabase, createPool } from './client';

/**
 * Extensions and helpers the schema is built on, created before any migration
 * runs.
 *
 * These used to live only in `infra/postgres/init/01-extensions.sql`, which
 * Docker runs once on a fresh volume. That works locally and nowhere else: a
 * managed Postgres — Coolify's, RDS, Supabase — never sees that file, so the
 * very first migration died on `operator class "gin_trgm_ops" does not exist`,
 * naming a symptom rather than the missing extension.
 *
 * Every statement is idempotent, so this is safe on each run.
 */
const BOOTSTRAP_SQL = [
  // Fuzzy global search (§17) and duplicate detection (§18).
  'CREATE EXTENSION IF NOT EXISTS pg_trgm',
  // Accent-insensitive matching for international applicant names.
  'CREATE EXTENSION IF NOT EXISTS unaccent',
  // gen_random_uuid() and digest() for integrity hashes.
  'CREATE EXTENSION IF NOT EXISTS pgcrypto',
  // Lets a GIN index mix trigram and scalar columns.
  'CREATE EXTENSION IF NOT EXISTS btree_gin',
  // unaccent() is stable, not immutable, so it cannot be used in an index
  // expression directly. Pinning the dictionary makes the wrapper immutable.
  `CREATE OR REPLACE FUNCTION nbr_immutable_unaccent(text)
     RETURNS text
     LANGUAGE sql
     IMMUTABLE
     PARALLEL SAFE
     STRICT
   AS $$ SELECT public.unaccent('public.unaccent', $1) $$`,
] as const;

/**
 * A fixed key for the advisory lock guarding a migration run.
 *
 * A literal string interpolated into the statement rather than a bound
 * parameter: the driver has no bigint binding, and this value is a compile-time
 * constant that never touches user input.
 *
 * Any 64-bit integer works so long as every caller agrees; this one is
 * arbitrary and must never change. The lock is held for the life of the
 * connection and released automatically if the process dies mid-run, so a
 * crashed deploy cannot leave it stuck.
 */
const MIGRATION_LOCK_KEY = '8147263905411';

/** Where Drizzle keeps its ledger. The schema defaults to `drizzle`. */
const LEDGER = 'drizzle.drizzle_migrations';

export interface MigrationOutcome {
  readonly durationMs: number;
  /** Ledger rows whose recorded timestamp disagreed with the journal. */
  readonly repaired: readonly string[];
}

interface JournalEntry {
  readonly tag: string;
  readonly hash: string;
  readonly when: number;
}

/** The journal and the migration files, paired by their position in the journal. */
function readJournal(migrationsFolder: string): JournalEntry[] {
  const files = readMigrationFiles({ migrationsFolder });
  const journal = JSON.parse(
    readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: Array<{ tag: string; when: number }> };

  // `readMigrationFiles` walks the journal in order and drops the tag, so the
  // two line up by index. Zipping them back together is only so failures can
  // name a migration rather than a hash.
  return files.map((file, index) => ({
    tag: journal.entries[index]?.tag ?? `#${index}`,
    hash: file.hash,
    when: file.folderMillis,
  }));
}

/**
 * Bring the ledger's timestamps back in line with the journal.
 *
 * Drizzle decides what to apply by comparing each migration's `when` against
 * the single highest `created_at` in the ledger — a high-water mark, not a
 * per-migration check. So if a migration is ever recorded with a `when` later
 * than the migrations that follow it, every one of those is silently treated as
 * already applied: no error, the API boots, and the first query touching a
 * column that was never added fails with a 500 in production.
 *
 * That is not hypothetical. `0014_pipeline_reorder` was hand-written with a
 * timestamp later than the generated migrations after it, which stranded three
 * of them. Correcting the journal fixed new databases and did nothing for the
 * ones that had already recorded the bad value.
 *
 * Rows are paired with journal entries by position, not by hash. Drizzle
 * appends one row per migration in journal order, so the nth row is the nth
 * entry — and that stays true even when a migration's file is edited after it
 * has run, which a hash match would miss. Only the timestamp is ever written;
 * this can correct when a migration is recorded as having run, never what it
 * did.
 */
async function reconcileLedger(sql: Sql, entries: readonly JournalEntry[]): Promise<string[]> {
  const [existing] = await sql.unsafe<[{ present: string | null }]>(
    `SELECT to_regclass('${LEDGER}')::text AS present`,
  );
  if (!existing?.present) return []; // Fresh database — nothing recorded yet.

  const rows = await sql.unsafe<Array<{ id: number; hash: string; created_at: string }>>(
    `SELECT id, hash, created_at FROM ${LEDGER} ORDER BY id ASC`,
  );

  // More rows than the journal describes means this database has run
  // migrations this build does not carry — a rollback to an older image, most
  // likely. Rewriting timestamps there would be guesswork, so leave it alone
  // and let the assertion below decide whether the schema is usable.
  if (rows.length > entries.length) return [];

  const repaired: string[] = [];

  for (const [index, row] of rows.entries()) {
    const entry = entries[index]!;
    if (String(row.created_at) === String(entry.when)) continue;

    await sql.unsafe(`UPDATE ${LEDGER} SET created_at = $1 WHERE id = $2`, [entry.when, row.id]);
    repaired.push(entry.tag);
  }

  return repaired;
}

/**
 * Every migration in the journal must have a ledger row once the run is done.
 *
 * The check that would have turned the stranded-migration bug into a failed
 * deploy instead of a production 500. A short ledger means Drizzle skipped a
 * migration, so the schema is not what this build expects and the process must
 * not come up serving requests against it.
 *
 * A hash that no longer matches its file is reported but not fatal: it means
 * the `.sql` was edited after it ran, which is worth knowing about and worth
 * not doing, but says nothing about whether the schema is correct.
 */
async function assertFullyApplied(
  sql: Sql,
  entries: readonly JournalEntry[],
  log: (message: string) => void,
): Promise<void> {
  const rows = await sql.unsafe<Array<{ hash: string }>>(`SELECT hash FROM ${LEDGER} ORDER BY id ASC`);

  if (rows.length < entries.length) {
    const missing = entries.slice(rows.length).map((entry) => entry.tag);
    throw new Error(
      `Migrations were skipped without being applied: ${missing.join(', ')}. ` +
        `The schema does not match this build. Check ${LEDGER} — the highest created_at must not ` +
        `exceed the "when" of any later migration in meta/_journal.json.`,
    );
  }

  const drifted = entries
    .filter((entry, index) => rows[index] && rows[index]!.hash !== entry.hash)
    .map((entry) => entry.tag);

  if (drifted.length > 0) {
    log(`Warning: migration files edited after they ran: ${drifted.join(', ')}`);
  }
}

/**
 * Apply any outstanding migrations, safely, from anywhere.
 *
 * This was a standalone script only, on the reasoning that PM2 runs one process
 * per core so boot-time migrations would race. That reasoning was right, so it
 * is addressed rather than ignored: the run holds a Postgres advisory lock, so
 * the first worker to arrive migrates and the rest block until it finishes and
 * then find nothing left to do — Drizzle's `drizzle_migrations` table makes the
 * second pass a no-op.
 *
 * The lock is taken on its own single connection rather than from the shared
 * pool, because an advisory lock's lifetime is its connection's and a pooled
 * one could be handed to another query underneath it.
 */
export async function runMigrations(
  log: (message: string) => void = console.log,
): Promise<MigrationOutcome> {
  // No statement timeout: the request-shaped 15s default would abort an index
  // build or a backfill part-way, which is the worst outcome for a schema change.
  const sql = createPool(undefined, { max: 1, statementTimeoutMs: 0 });
  const db = createDatabase(sql);
  const started = Date.now();
  const migrationsFolder = join(__dirname, 'migrations');

  try {
    await sql.unsafe(`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`);

    try {
      for (const statement of BOOTSTRAP_SQL) {
        await sql.unsafe(statement);
      }

      const journal = readJournal(migrationsFolder);

      // Inside the lock and before the run: correcting the high-water mark is
      // what lets the migrations it stranded apply on this same pass.
      const repaired = await reconcileLedger(sql, journal);
      if (repaired.length > 0) {
        log(`Corrected migration timestamps: ${repaired.join(', ')}`);
      }

      await migrate(db, {
        migrationsFolder,
        migrationsTable: 'drizzle_migrations',
      });

      await assertFullyApplied(sql, journal, log);

      const durationMs = Date.now() - started;
      log(`Schema up to date (${durationMs}ms)`);
      return { durationMs, repaired };
    } finally {
      await sql.unsafe(`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** The `db:migrate` entry point, so the command still works by hand. */
async function main(): Promise<void> {
  console.log('▶ Running migrations…');
  const { durationMs } = await runMigrations();
  console.log(`✓ Migrations applied in ${durationMs}ms`);
}

/**
 * Only self-execute as a script.
 *
 * Imported by the API bootstrap, this module must not run anything on load —
 * otherwise every boot would migrate twice, once on import and once when asked.
 */
if (process.argv[1]?.includes('migrate')) {
  main().catch((error: unknown) => {
    console.error('✗ Migration failed');
    console.error(error);
    process.exit(1);
  });
}
