/** Global route prefix. `/health` is excluded from it (see `main.ts`). */
export const API_PREFIX = 'api';

/** URI versioning: every route is served under `/api/v1` unless it opts out. */
export const DEFAULT_API_VERSION = '1';

/** Where the interactive API reference is served. */
export const DOCS_PATH = 'api/docs';
