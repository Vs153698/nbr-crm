/**
 * Injection token in its own file.
 *
 * If it lived in `redis.module.ts`, `cache.service.ts` would import the module
 * and the module would import the service — a cycle that Node resolves by
 * handing one of them a half-initialised binding at boot.
 */
export const REDIS = Symbol('REDIS');
