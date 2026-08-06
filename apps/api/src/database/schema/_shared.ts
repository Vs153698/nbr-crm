import { sql } from 'drizzle-orm';
import { timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Column helpers shared by every table.
 *
 * All timestamps are `timestamptz`. The application runs in IST but stores UTC;
 * rendering happens at the edge. Anything else guarantees an off-by-5:30 bug
 * in a report the day the server moves.
 */

export const primaryId = () => uuid('id').primaryKey().defaultRandom();

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .default(sql`now()`);

export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .default(sql`now()`);

/**
 * Soft delete. Used only where the requirements allow removal at all —
 * timeline events, audit logs, certificate versions, consent records and
 * notes are never deletable in any form.
 */
export const deletedAt = () => timestamp('deleted_at', { withTimezone: true, mode: 'date' });

export const timestamps = () => ({
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
