import 'dotenv/config';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
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

export interface MigrationOutcome {
  readonly durationMs: number;
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

  try {
    await sql.unsafe(`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`);

    try {
      for (const statement of BOOTSTRAP_SQL) {
        await sql.unsafe(statement);
      }

      await migrate(db, {
        migrationsFolder: join(__dirname, 'migrations'),
        migrationsTable: 'drizzle_migrations',
      });

      const durationMs = Date.now() - started;
      log(`Schema up to date (${durationMs}ms)`);
      return { durationMs };
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
