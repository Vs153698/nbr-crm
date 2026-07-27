import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import type { ApiResponse } from '@nbr/shared';
import type { FastifyReply } from 'fastify';
import { getContext } from './request-context';

/**
 * Single exit point for every error.
 *
 * Two rules drive this filter:
 *
 *  1. The client always receives the same envelope shape, whatever went wrong.
 *  2. A 5xx never leaks an internal detail. Database constraint names, driver
 *     messages and stack traces go to the server log with the request id; the
 *     caller gets a generic message and that id to quote. Error messages that
 *     leak internals are called out explicitly in the security checklist.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const requestId = getContext()?.requestId;

    const { status, code, message, fields, meta } = this.normalise(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      // Full detail, server-side only.
      this.logger.error(
        `[${requestId ?? 'no-request-id'}] ${code}: ${
          exception instanceof Error ? exception.message : String(exception)
        }`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else if (status === HttpStatus.FORBIDDEN || status === HttpStatus.UNAUTHORIZED) {
      // Authorisation failures are security signal — logged at warn so they
      // show up in monitoring without drowning it in 404s.
      const actor = getContext()?.actor;
      this.logger.warn(
        `[${requestId ?? '-'}] ${code} for ${actor?.email ?? 'anonymous'} → ${message}`,
      );
    }

    const body: ApiResponse<null> = {
      success: false,
      data: null,
      error: { code, message, fields, requestId },
      meta,
    };

    void reply.status(status).send(body);
  }

  private normalise(exception: unknown): {
    status: number;
    code: string;
    message: string;
    fields?: Record<string, string[]>;
    meta?: Record<string, unknown>;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();

      if (typeof response === 'object' && response !== null && 'code' in response) {
        const payload = response as {
          code: string;
          message: string;
          fields?: Record<string, string[]>;
          meta?: Record<string, unknown>;
        };
        return {
          status,
          code: payload.code,
          message: payload.message,
          fields: payload.fields,
          meta: payload.meta,
        };
      }

      const message =
        typeof response === 'string'
          ? response
          : ((response as { message?: string | string[] }).message ?? exception.message);

      return {
        status,
        code: httpStatusToCode(status),
        message: Array.isArray(message) ? message.join('. ') : message,
      };
    }

    // Postgres driver errors carry a `code`. Translate the ones a user can
    // actually cause into something actionable; everything else is a 500.
    const pgCode = (exception as { code?: string } | null)?.code;
    if (typeof pgCode === 'string') {
      const translated = translatePostgresError(pgCode, exception);
      if (translated) return translated;
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong on our side. Please try again, or quote the request ID to support.',
    };
  }
}

function httpStatusToCode(status: number): string {
  const map: Record<number, string> = {
    400: 'BAD_REQUEST',
    401: 'UNAUTHORISED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
    413: 'PAYLOAD_TOO_LARGE',
    422: 'VALIDATION_FAILED',
    429: 'RATE_LIMITED',
  };
  return map[status] ?? 'ERROR';
}

function translatePostgresError(
  pgCode: string,
  exception: unknown,
): { status: number; code: string; message: string; meta?: Record<string, unknown> } | null {
  const constraint = (exception as { constraint_name?: string })?.constraint_name;

  switch (pgCode) {
    case '23505': // unique_violation
      return {
        status: HttpStatus.CONFLICT,
        code: 'DUPLICATE_VALUE',
        message: uniqueViolationMessage(constraint),
        meta: constraint ? { constraint } : undefined,
      };

    case '23503': // foreign_key_violation
      return {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        code: 'REFERENCE_INVALID',
        message: 'A referenced item does not exist, or is still in use elsewhere.',
      };

    case '23514': // check_violation — our money and lifecycle invariants
      return {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        code: 'INVARIANT_VIOLATED',
        message: checkViolationMessage(constraint),
        meta: constraint ? { constraint } : undefined,
      };

    case '2F004': // restrict_violation — raised by our append-only triggers
    case '38004':
      return {
        status: HttpStatus.FORBIDDEN,
        code: 'IMMUTABLE_RECORD',
        message: 'This record is permanent and cannot be changed or deleted.',
      };

    case '57014': // query_canceled — statement_timeout tripped
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        code: 'QUERY_TIMEOUT',
        message: 'That took too long to load. Try narrowing the date range or filters.',
      };

    default:
      return null;
  }
}

function uniqueViolationMessage(constraint: string | undefined): string {
  switch (constraint) {
    case 'applicants_mobile_uq':
      return 'An applicant with this mobile number already exists. Open their profile and add a new record instead.';
    case 'applicants_code_uq':
    case 'records_code_uq':
      return 'That ID is already in use. Please try again.';
    case 'certificates_number_uq':
      return 'That certificate number has already been issued.';
    case 'invoices_number_uq':
      return 'That invoice number has already been used.';
    case 'users_email_uq':
      return 'A user with this email address already exists.';
    case 'payment_transactions_ref_uq':
      return 'A payment with this transaction ID has already been recorded.';
    default:
      return 'That value is already in use.';
  }
}

function checkViolationMessage(constraint: string | undefined): string {
  switch (constraint) {
    case 'payments_final_amount_correct':
    case 'payments_taxable_value_correct':
    case 'invoices_final_amount_correct':
      return 'The payment total does not add up. Check the amount, discount and GST.';
    case 'payments_paid_within_final':
      return 'The amount received cannot exceed the total payable. Record a refund instead.';
    case 'payments_discount_within_amount':
      return 'The discount cannot be larger than the package amount.';
    case 'blacklists_temporary_has_end':
      return 'A temporary blacklist needs an end date.';
    case 'blacklists_permanent_has_no_end':
      return 'A permanent blacklist cannot have an end date.';
    case 'achievements_group_has_participants':
      return 'A group record needs more than one participant.';
    case 'consent_child_requires_guardian':
      return "A minor's consent must record the parent or guardian who gave it.";
    case 'breach_closure_requires_notification':
      return 'A breach cannot be closed without recording the Board notification, or a written reason why notification was not required.';
    default:
      return 'That change would break a data rule and was rejected.';
  }
}
