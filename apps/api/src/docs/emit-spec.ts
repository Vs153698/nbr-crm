import 'reflect-metadata';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { config } from 'dotenv';
import { Logger, VersioningType } from '@nestjs/common';

// Run from `apps/api` by its package script, so `.env` cannot be found
// relative to the working directory the way `main.ts` finds it.
config({ path: resolve(__dirname, '../../../../.env') });

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../app.module';
import { API_PREFIX, DEFAULT_API_VERSION } from '../common/constants';
import { loadEnv } from '../config/env';
import { buildOpenApiDocument, reconcileDocs } from './openapi.builder';

/**
 * Write `openapi.json` to disk without serving it.
 *
 * The live `/api/docs` endpoint is for humans; this is for toolchains — client
 * generators, contract tests, an API gateway, or anything that wants the spec
 * checked into a repository. It boots the real application container so the
 * output is the same document the server would serve, never a parallel
 * hand-maintained copy.
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const outputPath = resolve(process.argv[2] ?? 'openapi.json');

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    logger: ['error', 'warn'],
  });

  try {
    app.setGlobalPrefix(API_PREFIX, { exclude: ['health', 'health/live'] });
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: DEFAULT_API_VERSION });
    await app.init();

    const { undocumented, orphaned, total } = reconcileDocs(app);
    if (undocumented.length > 0 || orphaned.length > 0) {
      throw new Error(
        'Refusing to emit an incomplete spec.\n' +
          (undocumented.length > 0 ? `  Undocumented routes: ${undocumented.join(', ')}\n` : '') +
          (orphaned.length > 0 ? `  Docs with no route: ${orphaned.join(', ')}\n` : '') +
          '  Fix src/docs/openapi.registry.ts.',
      );
    }

    const document = buildOpenApiDocument(app, { serverUrl: env.API_URL });

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

    new Logger('Docs').log(`Wrote ${total} routes to ${outputPath}`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `✗ Could not emit the OpenAPI spec\n${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
