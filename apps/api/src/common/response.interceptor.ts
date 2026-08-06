import {
  CallHandler,
  ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { ApiResponse } from '@nbr/shared';
import { map, type Observable } from 'rxjs';
import { getContext } from './request-context';

/** Handlers can return this to control envelope metadata. */
export class Enveloped<T> {
  constructor(
    readonly data: T,
    readonly meta?: Record<string, unknown>,
  ) {}
}

/**
 * Wraps every successful response in the standard envelope
 * `{ success, data, error, meta }` so the web client has exactly one shape to
 * unwrap, and so adding pagination metadata to an endpoint never changes the
 * client's parsing code.
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiResponse<T>> {
    const requestId = getContext()?.requestId;

    return next.handle().pipe(
      map((payload): ApiResponse<T> => {
        // A handler that already returned an envelope (a proxied download URL,
        // say) passes through untouched.
        if (isEnvelope(payload)) return payload as ApiResponse<T>;

        if (payload instanceof Enveloped) {
          return {
            success: true,
            data: payload.data as T,
            error: null,
            meta: { ...payload.meta, requestId },
          };
        }

        return {
          success: true,
          data: payload ?? null,
          error: null,
          meta: requestId ? { requestId } : undefined,
        };
      }),
    );
  }
}

function isEnvelope(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'success' in value &&
    'data' in value &&
    'error' in value
  );
}
