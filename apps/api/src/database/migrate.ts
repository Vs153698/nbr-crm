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
 * Migration runner.
 *
 * Deliberately a standalone script rather than something the API does on boot:
 * with PM2 running one process per CPU core, boot-time migrations would race,
 * and a failed migration would take the whole cluster down instead of failing
 * one deploy step.
 */
async function main(): Promise<void> {
  const sql = createPool();
  const db = createDatabase(sql);

  const started = Date.now();

  try {
    console.log('▶ Ensuring extensions…');
    for (const statement of BOOTSTRAP_SQL) {
      await sql.unsafe(statement);
    }

    console.log('▶ Running migrations…');
    await migrate(db, {
      migrationsFolder: join(__dirname, 'migrations'),
      migrationsTable: 'drizzle_migrations',
    });
    console.log(`✓ Migrations applied in ${Date.now() - started}ms`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error('✗ Migration failed');
  console.error(error);
  process.exit(1);
});
