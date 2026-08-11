import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const dir = join(process.cwd(), 'dist/database/migrations');
const journal = JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8')).entries;
const rows = await sql`select id, hash, created_at from drizzle.drizzle_migrations order by id asc`;

console.log('journal entries:', journal.length, '| ledger rows:', rows.length);
journal.forEach((entry, index) => {
  const fileHash = createHash('sha256').update(readFileSync(join(dir, `${entry.tag}.sql`))).digest('hex');
  const row = rows[index];
  const hashOk = row && row.hash === fileHash;
  const whenOk = row && String(row.created_at) === String(entry.when);
  if (!hashOk || !whenOk) {
    console.log(`  ${entry.tag}: hash=${hashOk ? 'ok' : 'DRIFTED'} when=${whenOk ? 'ok' : `DB ${row?.created_at} vs journal ${entry.when}`}`);
  }
});

const c15 = await sql`select column_name from information_schema.columns where table_name='achievements' and column_name in ('official_record_title','recognition_type')`;
const c16 = await sql`select column_name from information_schema.columns where table_name='attachments' and column_name in ('deleted_at','deleted_by_user_id','delete_reason')`;
const [t17] = await sql`select to_regclass('public.employee_payslips')::text as t`;
console.log(`SCHEMA NOW: 0015 ${c15.length}/2 | 0016 ${c16.length}/3 | 0017 ${t17.t ?? 'MISSING'}`);
await sql.end();
process.exit(0);
