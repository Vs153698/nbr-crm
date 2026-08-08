import { Global, Inject, Injectable, Logger, Module } from '@nestjs/common';
import { DB } from '../database/database.tokens';
import type { Database } from '../database/client';
import * as schema from '../database/schema';
import { getContext } from '../common/request-context';

export interface AuditEntry {
  readonly action: string;
  readonly entityType?: string;
  readonly entityId?: string;
  readonly entityLabel?: string;
  readonly changes?: Record<string, { from: unknown; to: unknown }>;
  readonly meta?: Record<string, unknown>;
}

export interface PiiAccessEntry {
  readonly applicantId: string | null;
  readonly field: string;
  readonly accessType: 'reveal' | 'download' | 'export';
  readonly reason?: string;
}

/**
 * Audit trail (§23) and PII access log (DPDP §8(4)).
 *
 * Writes go to append-only tables that the database itself refuses to update or
 * delete, so this service can only ever add to history.
 *
 * Failures are logged but never thrown: an audit write that fails must not roll
 * back the business operation the user just completed. The inverse — silently
 * losing audit rows — is caught by monitoring on this logger, and the write is
 * inside the caller's transaction wherever the caller passes one, so in the
 * normal path they succeed or fail together.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  async record(entry: AuditEntry, tx?: Database): Promise<void> {
    const context = getContext();
    const actor = context?.actor;

    try {
      await (tx ?? this.db).insert(schema.auditLogs).values({
        actorUserId: actor?.userId ?? null,
        actorName: actor?.fullName ?? 'System',
        actorRole: actor?.roleCode ?? 'system',
        action: entry.action,
        entityType: entry.entityType ?? null,
        entityId: entry.entityId ?? null,
        entityLabel: entry.entityLabel ?? null,
        changes: entry.changes ?? null,
        meta: entry.meta ?? null,
        ipAddress: context?.ipAddress ?? null,
        userAgent: context?.userAgent ?? null,
        requestId: context?.requestId ?? null,
      });
    } catch (error: unknown) {
      this.logger.error(
        `AUDIT WRITE FAILED for "${entry.action}" (${entry.entityType}:${entry.entityId}) — ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Every decryption of a government identifier and every download of a file
   * marked sensitive. Unlike the audit trail, a failure here *is* thrown — if
   * we cannot log the access, we must not perform it. That is the difference
   * between an access log and a best-effort breadcrumb.
   */
  async recordPiiAccess(entry: PiiAccessEntry, tx?: Database): Promise<void> {
    const context = getContext();
    const actor = context?.actor;

    await (tx ?? this.db).insert(schema.piiAccessLog).values({
      userId: actor?.userId ?? null,
      userName: actor?.fullName ?? 'System',
      userRole: actor?.roleCode ?? 'system',
      applicantId: entry.applicantId,
      field: entry.field,
      accessType: entry.accessType,
      reason: entry.reason ?? null,
      ipAddress: context?.ipAddress ?? null,
      userAgent: context?.userAgent ?? null,
      requestId: context?.requestId ?? null,
    });
  }
}

/**
 * Build a before → after diff, skipping unchanged fields and redacting any
 * value that must never appear in a log (§23 "Before→after diffs on sensitive
 * edits" — but a diff of an Aadhaar change would defeat encrypting it).
 */
const REDACTED_FIELDS = new Set([
  'passwordHash',
  'password',
  'aadhaarEncrypted',
  'aadhaarNumber',
  'passportEncrypted',
  'passportNumber',
  'panEncrypted',
  'panNumber',
  'refreshTokenHash',
  'tokenHash',
]);

export function buildDiff<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  for (const [key, next] of Object.entries(after)) {
    if (next === undefined) continue;
    const previous = before[key];

    if (REDACTED_FIELDS.has(key)) {
      if (!isEqual(previous, next)) changes[key] = { from: '[redacted]', to: '[redacted]' };
      continue;
    }

    if (!isEqual(previous, next)) changes[key] = { from: previous, to: next };
  }

  return changes;
}

function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a instanceof Date && typeof b === 'string') return a.toISOString() === new Date(b).toISOString();
  if (a === null && b === undefined) return true;
  if (a === undefined && b === null) return true;
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

/** Stable action codes for the audit trail. */
export const AUDIT = {
  LOGIN_SUCCESS: 'auth.login',
  LOGIN_FAILED: 'auth.login_failed',
  LOGOUT: 'auth.logout',
  PASSWORD_CHANGED: 'auth.password_changed',
  PASSWORD_RESET_REQUESTED: 'auth.password_reset_requested',
  PASSWORD_RESET_COMPLETED: 'auth.password_reset_completed',
  SESSION_REVOKED: 'auth.session_revoked',

  APPLICANT_CREATED: 'applicant.created',
  APPLICANT_UPDATED: 'applicant.updated',
  RECORD_CREATED: 'record.created',
  RECORD_UPDATED: 'record.updated',
  STATUS_CHANGED: 'record.status_changed',
  STATUS_OVERRIDE: 'record.status_override',
  RECORD_ASSIGNED: 'record.assigned',

  EVIDENCE_UPLOADED: 'evidence.uploaded',
  ATTACHMENT_UPLOADED: 'attachment.uploaded',
  FILE_DOWNLOADED: 'file.downloaded',

  PAYMENT_PLAN_CREATED: 'payment.plan_created',
  PAYMENT_RECORDED: 'payment.recorded',
  PAYMENT_REVERSED: 'payment.reversed',
  INVOICE_GENERATED: 'invoice.generated',

  CERTIFICATE_UPLOADED: 'certificate.uploaded',
  PUBLICATION_ADDED: 'publication.added',
  DISPATCH_UPDATED: 'dispatch.updated',

  EMAIL_SENT: 'communication.email_sent',
  WHATSAPP_SENT: 'communication.whatsapp_sent',
  TEMPLATE_UPDATED: 'template.updated',

  // ── Sales & leads ────────────────────────────────────────────────────────
  LEAD_CREATED: 'lead.created',
  LEAD_UPDATED: 'lead.updated',
  LEAD_CALL_LOGGED: 'lead.call_logged',
  LEAD_CONVERTED: 'lead.converted',
  LEAD_DELETED: 'lead.deleted',

  // ── Employee directory ───────────────────────────────────────────────────
  EMPLOYEE_CREATED: 'employee.created',
  EMPLOYEE_UPDATED: 'employee.updated',
  EMPLOYEE_DELETED: 'employee.deleted',
  EMPLOYEE_DOCUMENT_UPLOADED: 'employee.document_uploaded',
  EMPLOYEE_DOCUMENT_OPENED: 'employee.document_opened',
  EMPLOYEE_DOCUMENT_DELETED: 'employee.document_deleted',

  BLACKLIST_ADDED: 'blacklist.added',
  BLACKLIST_LIFTED: 'blacklist.lifted',
  BLACKLIST_OVERRIDDEN: 'blacklist.overridden',
  FLAG_SET: 'flag.set',
  FLAG_REMOVED: 'flag.removed',

  USER_CREATED: 'user.created',
  USER_UPDATED: 'user.updated',
  USER_DEACTIVATED: 'user.deactivated',
  ROLE_CREATED: 'role.created',
  ROLE_UPDATED: 'role.updated',
  ROLE_PERMISSIONS_CHANGED: 'role.permissions_changed',
  SETTING_UPDATED: 'setting.updated',

  REPORT_EXPORTED: 'report.exported',

  CONSENT_RECORDED: 'privacy.consent_recorded',
  CONSENT_WITHDRAWN: 'privacy.consent_withdrawn',
  DSR_CREATED: 'privacy.dsr_created',
  DSR_UPDATED: 'privacy.dsr_updated',
  ERASURE_EXECUTED: 'privacy.erasure_executed',
  BREACH_REPORTED: 'privacy.breach_reported',
  BREACH_UPDATED: 'privacy.breach_updated',
  PII_REVEALED: 'privacy.pii_revealed',

  WEBHOOK_RECEIVED: 'integration.webhook_received',
  WEBHOOK_REJECTED: 'integration.webhook_rejected',
  IMPORT_COMPLETED: 'integration.import_completed',
} as const;

@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
