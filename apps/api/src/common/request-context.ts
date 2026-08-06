import { AsyncLocalStorage } from 'node:async_hooks';
import type { PermissionCode } from '@nbr/shared';

/**
 * Per-request context.
 *
 * Carried in AsyncLocalStorage so services deep in the call stack (the audit
 * writer, the timeline writer, the PII access logger) can record *who* did
 * something without every function signature growing an `actor` parameter.
 */
export interface Actor {
  readonly userId: string;
  readonly fullName: string;
  readonly email: string;
  readonly roleId: string;
  readonly roleCode: string;
  readonly isSuperAdmin: boolean;
  readonly permissions: ReadonlySet<PermissionCode>;
  readonly sessionId: string;
}

export interface RequestContext {
  readonly requestId: string;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  actor: Actor | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getContext(): RequestContext | undefined {
  return storage.getStore();
}

export function getActor(): Actor | null {
  return storage.getStore()?.actor ?? null;
}

/**
 * The actor, or a throw. Used by write paths where an anonymous mutation would
 * be a bug — a timeline entry with no author is worthless.
 */
export function requireActor(): Actor {
  const actor = getActor();
  if (!actor) {
    throw new Error('No authenticated actor in context — this path requires authentication');
  }
  return actor;
}

export function setActor(actor: Actor): void {
  const context = storage.getStore();
  if (context) context.actor = actor;
}

/** System-initiated changes (scheduled jobs, webhook imports) have no user. */
export const SYSTEM_ACTOR_NAME = 'System';
export const INTEGRATION_ACTOR_NAME = 'NBR Website';
