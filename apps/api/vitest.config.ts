import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * NestJS relies on `emitDecoratorMetadata`, which esbuild — Vitest's default
 * transformer — does not produce. Without SWC here, every `@Inject`ed
 * dependency resolves to `undefined` and the container fails to build, which
 * looks like a dependency-injection bug rather than a transform gap.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['test/setup-env.ts'],
    // Booting the whole application container is slower than a unit test, and
    // these run against real Postgres and Redis.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // One process: several suites booting Nest concurrently would each open a
    // connection pool against the same test database.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
