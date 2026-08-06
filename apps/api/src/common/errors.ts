import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Domain errors with stable machine-readable codes.
 *
 * The web app branches on `code`, never on the message — messages are for
 * humans and get reworded; codes are a contract. Every message here is written
 * to be safe to show an end user: no stack traces, no SQL, no internal ids.
 */
export class DomainError extends HttpException {
  constructor(
    readonly code: string,
    message: string,
    status: HttpStatus,
    readonly fields?: Record<string, string[]>,
    readonly meta?: Record<string, unknown>,
  ) {
    super({ code, message, fields, meta }, status);
  }
}

export class ValidationError extends DomainError {
  constructor(fields: Record<string, string[]>, message = 'Please correct the highlighted fields') {
    super('VALIDATION_FAILED', message, HttpStatus.UNPROCESSABLE_ENTITY, fields);
  }
}

export class NotFoundError extends DomainError {
  constructor(entity: string) {
    super('NOT_FOUND', `${entity} not found`, HttpStatus.NOT_FOUND);
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'You do not have permission to do this', meta?: Record<string, unknown>) {
    super('FORBIDDEN', message, HttpStatus.FORBIDDEN, undefined, meta);
  }
}

export class UnauthorisedError extends DomainError {
  constructor(code = 'UNAUTHORISED', message = 'Please sign in to continue') {
    super(code, message, HttpStatus.UNAUTHORIZED);
  }
}

export class ConflictError extends DomainError {
  constructor(code: string, message: string, meta?: Record<string, unknown>) {
    super(code, message, HttpStatus.CONFLICT, undefined, meta);
  }
}

/**
 * Optimistic-lock failure (§6 concurrency). Two staff opened the same record
 * and the second save would silently overwrite the first.
 */
export class StaleWriteError extends ConflictError {
  constructor(entity: string) {
    super(
      'STALE_WRITE',
      `This ${entity} was changed by someone else while you were editing. Reload to see the latest version before saving.`,
    );
  }
}

/** An illegal status transition (§6 state machine). */
export class InvalidTransitionError extends DomainError {
  constructor(from: string, to: string, reason?: string) {
    super(
      'INVALID_TRANSITION',
      reason ?? `A record cannot move from ${from} to ${to}`,
      HttpStatus.UNPROCESSABLE_ENTITY,
      undefined,
      { from, to },
    );
  }
}

/** A transition guard that is not satisfied yet (e.g. balance outstanding). */
export class GuardNotSatisfiedError extends DomainError {
  constructor(guard: string, message: string) {
    super('GUARD_NOT_SATISFIED', message, HttpStatus.UNPROCESSABLE_ENTITY, undefined, { guard });
  }
}

/** §19 — a blacklisted applicant may not open a new record without override. */
export class BlacklistBlockedError extends DomainError {
  constructor(meta: Record<string, unknown>) {
    super(
      'BLACKLIST_BLOCKED',
      'This applicant is blacklisted and cannot start a new application. An Admin can override this.',
      HttpStatus.FORBIDDEN,
      undefined,
      meta,
    );
  }
}

/** §18 — possible existing applicant found. Not fatal; the UI offers choices. */
export class DuplicateApplicantError extends DomainError {
  constructor(matches: unknown[]) {
    super(
      'DUPLICATE_APPLICANT',
      'Possible existing applicant found. Review the matches before continuing.',
      HttpStatus.CONFLICT,
      undefined,
      { matches },
    );
  }
}

/** The record is completed and its workflow is locked (§11 stage 9). */
export class WorkflowLockedError extends DomainError {
  constructor() {
    super(
      'WORKFLOW_LOCKED',
      'This record is completed and locked. An Admin can reopen it if a correction is needed.',
      HttpStatus.CONFLICT,
    );
  }
}

export class RateLimitedError extends DomainError {
  constructor(retryAfterSeconds: number, message = 'Too many attempts. Please try again shortly.') {
    super('RATE_LIMITED', message, HttpStatus.TOO_MANY_REQUESTS, undefined, {
      retryAfterSeconds,
    });
  }
}

/** DPDP — the requested processing is not covered by a live consent. */
export class ConsentMissingError extends DomainError {
  constructor(purpose: string) {
    super(
      'CONSENT_MISSING',
      'The applicant has not consented to this use of their personal data, or has withdrawn that consent.',
      HttpStatus.FORBIDDEN,
      undefined,
      { purpose },
    );
  }
}
