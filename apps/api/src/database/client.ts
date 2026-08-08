import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { loadEnv } from '../config/env';
import * as schema from './schema';

export type Database = PostgresJsDatabase<typeof schema>;

/**
 * Postgres connection.
 *
 * `postgres.js` is used over `pg` because it is measurably faster on the
 * prepared-statement-heavy CRUD workload this API is (§5 "fast by design"), and
 * because Drizzle's postgres-js driver skips a serialisation hop.
 *
 * In production the pool sits behind PgBouncer in transaction mode, which is
 * why prepared statements are disabled there — PgBouncer cannot route a named
 * prepared statement back to the right backend.
 */
export interface PoolOverrides {
  /** Connections to open. Migrations use one, so the advisory lock holds. */
  readonly max?: number;
  /**
   * Per-statement ceiling. Pass 0 to disable.
   *
   * The default of 15s is right for request work and wrong for a migration — a
   * backfill or an index build on a large table will exceed it and be aborted
   * part-way, which is the worst possible outcome for a schema change.
   */
  readonly statementTimeoutMs?: number;
}

export function createPool(
  connectionString?: string,
  overrides: PoolOverrides = {},
): postgres.Sql {
  const env = loadEnv();
  const isProduction = env.NODE_ENV === 'production';

  return postgres(connectionString ?? env.DATABASE_URL, {
    max: overrides.max ?? env.DATABASE_POOL_MAX,
    idle_timeout: 30,
    connect_timeout: 10,
    max_lifetime: 60 * 30,
    prepare: !isProduction,
    onnotice: isProduction ? () => undefined : undefined,
    transform: { undefined: null },
    connection: {
      application_name: 'nbr-crm-api',
      // Every timestamp in and out of the database is UTC; rendering to IST
      // happens at the edge.
      timezone: 'UTC',
      // Guard against a runaway query pinning a connection forever. Long work
      // belongs on a BullMQ worker, not in a request.
      statement_timeout: overrides.statementTimeoutMs ?? 15_000,
      idle_in_transaction_session_timeout: 30_000,
    },
  });
}

export function createDatabase(sql: postgres.Sql): Database {
  return drizzle(sql, {
    schema,
    logger: loadEnv().LOG_LEVEL === 'trace',
  });
}

export { schema };
