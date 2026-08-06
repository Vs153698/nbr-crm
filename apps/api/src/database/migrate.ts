import 'dotenv/config';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDatabase, createPool } from './client';

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
  console.log('▶ Running migrations…');

  try {
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
