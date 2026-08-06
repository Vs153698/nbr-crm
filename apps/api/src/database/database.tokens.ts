/**
 * Injection tokens in their own file so services can import them without
 * pulling in `database.module.ts` — which would create an import cycle,
 * since the module imports those same services.
 */
export const DB = Symbol('DB');
export const PG = Symbol('PG');
