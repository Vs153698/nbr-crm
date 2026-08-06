import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { safeEqual } from './crypto';
import { runWithContext, type RequestContext } from './request-context';

const CSRF_COOKIE = 'nbr_csrf';
const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Establishes the per-request context (request id, client IP, user agent) and
 * keeps it available through the whole async call stack, so the audit trail and
 * timeline can attribute every write without threading an actor parameter
 * through fifty function signatures.
 */
export function registerRequestContext(app: FastifyInstance, trustProxy: boolean): void {
  app.addHook('onRequest', (request, reply, done) => {
    const requestId = (request.headers['x-request-id'] as string | undefined) ?? randomUUID();

    const context: RequestContext = {
      requestId,
      ipAddress: resolveClientIp(request, trustProxy),
      userAgent: (request.headers['user-agent'] as string | undefined) ?? null,
      actor: null,
    };

    // Echoed so a user can quote it from an error toast and support can find
    // the exact request in the logs.
    void reply.header('x-request-id', requestId);

    runWithContext(context, done);
  });
}

/**
 * Resolve the client IP.
 *
 * `x-forwarded-for` is attacker-controlled unless a proxy we trust rewrote it,
 * so it is only consulted when the deployment actually sits behind one. Taking
 * it on faith would let anyone spoof their IP past the login rate limiter and
 * poison the audit log.
 */
function resolveClientIp(request: FastifyRequest, trustProxy: boolean): string | null {
  if (trustProxy) {
    const forwarded = request.headers['x-forwarded-for'];
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
    if (first?.trim()) return first.trim();

    // Cloudflare's own header, which it always overwrites.
    const cfIp = request.headers['cf-connecting-ip'];
    if (typeof cfIp === 'string' && cfIp.trim()) return cfIp.trim();
  }
  return request.ip || null;
}

/**
 * CSRF protection, double-submit cookie pattern.
 *
 * Auth tokens live in HttpOnly cookies, which the browser attaches to any
 * cross-site request automatically — that is exactly what CSRF exploits. The
 * defence: a non-HttpOnly token cookie that the SPA reads and echoes in a
 * header. An attacker's page can cause the cookie to be *sent* but cannot read
 * it to set the header, because the same-origin policy stops them.
 *
 * SameSite=strict on the auth cookies already blocks most of this; the header
 * check is the second layer for the browsers and redirect flows where SameSite
 * alone is not sufficient.
 */
export function registerCsrf(
  app: FastifyInstance,
  options: { secure: boolean; domain?: string },
): void {
  app.addHook('onRequest', (request, reply, done) => {
    // Issue the token on any request that doesn't have one yet.
    const existing = (request as FastifyRequest & { cookies?: Record<string, string> }).cookies?.[
      CSRF_COOKIE
    ];

    if (!existing) {
      void reply.setCookie(CSRF_COOKIE, randomUUID(), {
        httpOnly: false, // the SPA must be able to read this one
        secure: options.secure,
        sameSite: 'strict',
        path: '/',
        // Scoped the same way as the session cookies. Without this the token is
        // bound to the API's own host, and an SPA served from a sibling host
        // cannot read it via document.cookie — so it sends no CSRF header and
        // every write is rejected, while reads keep working. Undefined for
        // localhost, where a domain attribute would stop the cookie being set.
        domain: options.domain,
      });
    }

    done();
  });

  app.addHook('preHandler', (request, reply, done) => {
    if (SAFE_METHODS.has(request.method)) return done();

    const url = request.url;

    // Login and refresh run before the SPA holds a token, and the inbound
    // webhook is a server-to-server call authenticated by HMAC signature, not
    // by a cookie — so CSRF does not apply to either.
    if (
      url.includes('/auth/login') ||
      url.includes('/auth/refresh') ||
      url.includes('/auth/forgot-password') ||
      url.includes('/auth/reset-password') ||
      url.includes('/integrations/')
    ) {
      return done();
    }

    // A bearer token cannot be attached by the browser automatically, so a
    // request authenticated that way is not forgeable cross-site.
    if (request.headers.authorization?.startsWith('Bearer ')) return done();

    const cookieToken = (request as FastifyRequest & { cookies?: Record<string, string> }).cookies?.[
      CSRF_COOKIE
    ];
    const headerToken = request.headers[CSRF_HEADER] as string | undefined;

    if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) {
      void reply.status(403).send({
        success: false,
        data: null,
        error: {
          code: 'CSRF_FAILED',
          message: 'Your session could not be verified. Refresh the page and try again.',
        },
      });
      return;
    }

    done();
  });
}

export { CSRF_COOKIE, CSRF_HEADER };

/**
 * JSON body parser.
 *
 * Replaces Nest's built-in parser for two reasons:
 *
 *  1. **An empty body is valid.** Nest's parser throws
 *     "Body cannot be empty when content-type is set to 'application/json'",
 *     which breaks every action endpoint that takes no payload — issuing an
 *     invoice, revoking sessions, generating an export. Those are legitimate
 *     POSTs and a client should not have to send `{}` to satisfy a parser.
 *
 *  2. **The raw bytes must survive.** The inbound NBR-website webhook verifies
 *     an HMAC computed over the exact body the sender signed. Re-serialising
 *     the parsed object would reorder keys and invalidate every signature, so
 *     the original string is preserved on `request.rawBody`.
 */
export function registerJsonBodyParser(app: FastifyInstance): void {
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (request: FastifyRequest & { rawBody?: string }, body: string | Buffer, done) => {
      const raw = typeof body === 'string' ? body : body.toString('utf8');
      request.rawBody = raw;

      if (raw.trim().length === 0) {
        // A bodyless POST is an action, not a malformed request.
        done(null, {});
        return;
      }

      try {
        done(null, JSON.parse(raw) as unknown);
      } catch {
        const error = new Error('Request body is not valid JSON') as Error & { statusCode: number };
        error.statusCode = 400;
        done(error, undefined);
      }
    },
  );
}

/** Fastify augmentation so `request.rawBody` type-checks. */
declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }
}
