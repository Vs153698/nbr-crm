import 'dotenv/config';
import 'reflect-metadata';
import compress from '@fastify/compress';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { Logger, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { registerCsrf, registerRequestContext } from './common/security.plugins';
import { loadEnv } from './config/env';

const API_PREFIX = 'api';

async function bootstrap(): Promise<void> {
  // Validated before anything else so a misconfiguration is a clear startup
  // error rather than a 500 on the first request that touches the bad value.
  const env = loadEnv();
  const isProduction = env.NODE_ENV === 'production';

  const adapter = new FastifyAdapter({
    // Behind Cloudflare and/or nginx in production. Off in development so a
    // spoofed X-Forwarded-For cannot fake a client IP past the rate limiter.
    trustProxy: isProduction,
    bodyLimit: env.MAX_UPLOAD_MB * 1024 * 1024,
    logger: false, // Nest's logger owns output; two loggers means double lines
    genReqId: () => crypto.randomUUID(),
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    logger: isProduction
      ? ['error', 'warn', 'log']
      : ['error', 'warn', 'log', 'debug', 'verbose'],
    bufferLogs: true,
    // Keeps the exact bytes of the request body on `request.rawBody`.
    // The inbound NBR-website webhook verifies an HMAC over those bytes —
    // re-serialising the parsed JSON would reorder keys and break every
    // signature the sender produces.
    rawBody: true,
  });

  const fastify = app.getHttpAdapter().getInstance();

  // ── Security headers ─────────────────────────────────────────────────────
  await app.register(helmet, {
    // This process serves JSON only — the SPA is served separately by
    // Cloudflare. A restrictive CSP here costs nothing and blocks the
    // rendering of anything at all if an endpoint is ever tricked into
    // returning HTML.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
    hsts: isProduction
      ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
      : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    // The API never renders content in a frame.
    frameguard: { action: 'deny' },
    noSniff: true,
  });

  await app.register(cookie, {
    secret: env.JWT_ACCESS_SECRET,
    parseOptions: { httpOnly: true, sameSite: 'strict', secure: env.COOKIE_SECURE },
  });

  await app.register(compress, {
    encodings: ['br', 'gzip'],
    threshold: 1024,
  });

  // ── Global rate limit ────────────────────────────────────────────────────
  // A blunt ceiling in front of everything. The auth path has its own much
  // tighter, account-aware limits on top of this.
  await app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_GLOBAL_PER_MINUTE,
    timeWindow: '1 minute',
    // The signed-in user is the right subject when we know them; the IP is
    // only a fallback for unauthenticated traffic.
    keyGenerator: (request) => {
      const cookies = (request as { cookies?: Record<string, string> }).cookies;
      return cookies?.nbr_access ? `t:${cookies.nbr_access.slice(-32)}` : `ip:${request.ip}`;
    },
    errorResponseBuilder: (_request, context) => ({
      success: false,
      data: null,
      error: {
        code: 'RATE_LIMITED',
        message: `Too many requests. Try again in ${Math.ceil(context.ttl / 1000)}s.`,
      },
    }),
  });

  registerRequestContext(fastify, isProduction);
  registerCsrf(fastify, { secure: env.COOKIE_SECURE });

  // ── CORS ─────────────────────────────────────────────────────────────────
  // Credentials are sent with every request, so the allow-list must be exact.
  // A wildcard origin with credentials is rejected by browsers anyway, and the
  // env schema refuses to start production with one configured.
  app.enableCors({
    origin: env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : [env.WEB_URL],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'authorization', 'x-csrf-token', 'x-request-id'],
    exposedHeaders: ['x-request-id'],
    maxAge: 86_400,
  });

  app.setGlobalPrefix(API_PREFIX, { exclude: ['health', 'health/live'] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableShutdownHooks();

  await app.listen(env.API_PORT, '0.0.0.0');

  const logger = new Logger('Bootstrap');
  logger.log(`${env.APP_NAME} API listening on :${env.API_PORT} (${env.NODE_ENV})`);
  logger.log(`Base URL: ${env.API_URL}/${API_PREFIX}/v1`);
}

bootstrap().catch((error: unknown) => {
  // Nest's logger may not exist yet if bootstrap failed early.
  process.stderr.write(
    `Failed to start API:\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
