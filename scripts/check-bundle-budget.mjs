#!/usr/bin/env node
/**
 * Enforce the plan's bundle budget (§7 "FRONTEND < 1 s TTI", §performance
 * "App page < 300kb JS gzipped").
 *
 * Measures the *initial* payload — the entry chunk plus its static imports —
 * rather than the sum of every file in dist, because route-split chunks and
 * the charts bundle only load when that route does.
 *
 * A budget nothing enforces is a note in a document, so this exits non-zero.
 */
import { gzipSync } from 'node:zlib';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'apps/web/dist/assets';

/** Chunks loaded on first paint, before any route resolves. */
const INITIAL_CHUNK_PREFIXES = ['index-', 'react-'];

const BUDGETS = {
  initialJsGzipKb: 300,
  cssGzipKb: 50,
  /** Any single lazily-loaded chunk. Catches an accidental import of a heavy
   *  library into a route that shouldn't have it. */
  maxLazyChunkGzipKb: 150,
};

function gzipKb(path) {
  return gzipSync(readFileSync(path)).length / 1024;
}

let files;
try {
  files = readdirSync(DIST).filter((name) => statSync(join(DIST, name)).isFile());
} catch {
  console.error(`✗ ${DIST} not found — run \`pnpm build\` first.`);
  process.exit(1);
}

const js = files.filter((name) => name.endsWith('.js'));
const css = files.filter((name) => name.endsWith('.css'));

let initialJs = 0;
const lazyChunks = [];

for (const name of js) {
  const size = gzipKb(join(DIST, name));
  if (INITIAL_CHUNK_PREFIXES.some((prefix) => name.startsWith(prefix))) {
    initialJs += size;
  } else {
    lazyChunks.push({ name, size });
  }
}

const cssTotal = css.reduce((sum, name) => sum + gzipKb(join(DIST, name)), 0);
const heaviestLazy = lazyChunks.sort((a, b) => b.size - a.size)[0];

const results = [
  {
    label: 'Initial JS (entry + vendor)',
    actual: initialJs,
    budget: BUDGETS.initialJsGzipKb,
  },
  { label: 'CSS', actual: cssTotal, budget: BUDGETS.cssGzipKb },
  {
    label: `Heaviest lazy chunk (${heaviestLazy?.name ?? 'none'})`,
    actual: heaviestLazy?.size ?? 0,
    budget: BUDGETS.maxLazyChunkGzipKb,
  },
];

let failed = false;

console.log('\nBundle budget (gzipped)\n' + '─'.repeat(58));
for (const { label, actual, budget } of results) {
  const ok = actual <= budget;
  if (!ok) failed = true;
  console.log(
    `${ok ? '✓' : '✗'} ${label.padEnd(38)} ${actual.toFixed(1).padStart(7)} / ${budget} KB`,
  );
}
console.log('─'.repeat(58));
console.log(`  ${lazyChunks.length} lazy chunks, ${js.length} JS files total\n`);

if (failed) {
  console.error('Bundle budget exceeded. Split a route, or lazy-load the offending dependency.');
  process.exit(1);
}
