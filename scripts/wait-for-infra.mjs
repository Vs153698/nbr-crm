#!/usr/bin/env node
/**
 * Block until the local dependencies are actually accepting connections, and
 * create the storage bucket if it is missing.
 *
 * `docker compose up -d` returns as soon as the containers *start*, not when
 * Postgres is ready to answer — so running migrations straight afterwards
 * fails with ECONNREFUSED for a few seconds. Waiting here turns a confusing
 * intermittent error into a predictable one.
 */
import { execSync } from 'node:child_process';
import { connect } from 'node:net';

const TARGETS = [
  { name: 'Postgres', port: Number(process.env.POSTGRES_PORT ?? 5434) },
  { name: 'Redis', port: Number(process.env.REDIS_PORT ?? 6380) },
  { name: 'MinIO', port: Number(process.env.MINIO_PORT ?? 9000) },
];

const TIMEOUT_MS = 60_000;

function probe(port) {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.setTimeout(1000);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
  });
}

async function waitFor({ name, port }) {
  const deadline = Date.now() + TIMEOUT_MS;
  process.stdout.write(`  waiting for ${name} on :${port} `);

  while (Date.now() < deadline) {
    if (await probe(port)) {
      process.stdout.write(' ready\n');
      return true;
    }
    process.stdout.write('.');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  process.stdout.write(` TIMED OUT\n`);
  return false;
}

/** The vault bucket must exist before any evidence upload can succeed. */
function ensureBucket() {
  const bucket = process.env.S3_BUCKET ?? 'nbr-vault';
  const key = process.env.S3_ACCESS_KEY_ID ?? 'nbr_minio';
  const secret = process.env.S3_SECRET_ACCESS_KEY ?? 'nbr_minio_password';

  try {
    execSync(
      `docker run --rm --network nbr-crm_default --entrypoint sh minio/mc:latest -c ` +
        `"mc alias set local http://nbr-minio:9000 ${key} ${secret} >/dev/null && ` +
        `mc mb --ignore-existing local/${bucket} >/dev/null && ` +
        `mc anonymous set none local/${bucket} >/dev/null"`,
      { stdio: 'pipe' },
    );
    console.log(`  storage bucket "${bucket}" ready (private)`);
  } catch {
    console.log(`  ⚠ could not verify the "${bucket}" bucket — evidence uploads may fail.`);
    console.log('    Create it from the MinIO console at http://localhost:9001');
  }
}

console.log('\nLocal infrastructure');
const results = await Promise.all(TARGETS.map(waitFor));

if (results.some((ready) => !ready)) {
  console.error('\n✗ Some services did not come up. Check `docker compose logs`.\n');
  process.exit(1);
}

ensureBucket();
console.log('\n✓ Infrastructure ready — run `pnpm db:migrate && pnpm db:seed`\n');
