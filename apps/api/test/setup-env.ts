import { resolve } from 'node:path';
import { config } from 'dotenv';

/**
 * `main.ts` loads `.env` via `import 'dotenv/config'`; tests never run that
 * file, so they need the same environment loaded explicitly. The path is
 * repo-root-relative because the env file is shared by every workspace package
 * and Vitest runs with `apps/api` as its working directory.
 */
config({ path: resolve(__dirname, '../../../.env') });
