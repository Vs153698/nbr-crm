/**
 * Full NBR CRM schema.
 *
 * Grouped by concern rather than dumped into one file, but exported flat so
 * `db.select().from(schema.records)` works everywhere and drizzle-kit sees a
 * single entry point.
 *
 *   identity      — users, roles, permissions, sessions, audit
 *   applicants    — master profile, encrypted identifiers, blacklist, flags
 *   records       — applications, achievements, timeline, transitions
 *   vault         — evidence, attachments, certificates, publications, dispatch
 *   money         — packages, payment plans, transactions, invoices
 *   collaboration — notes, tasks, templates, communications, notifications
 *   privacy       — DPDP consent ledger, DSRs, breaches, PII access, retention
 *   governance    — settings, couriers, integrations, exports, saved views
 *   sales         — leads, call logs, employee directory
 *   imported      — offline certificates mirrored from the website, kept apart
 *                   from applicants because they have no application behind them
 */

export * from './identity';
export * from './applicants';
export * from './records';
export * from './vault';
export * from './money';
export * from './collaboration';
export * from './privacy';
export * from './governance';
export * from './sales';
export * from './imported';
