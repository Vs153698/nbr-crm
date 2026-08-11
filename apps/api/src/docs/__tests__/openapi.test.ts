import { VersioningType, type INestApplication } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module';
import { API_PREFIX, DEFAULT_API_VERSION } from '../../common/constants';
import { buildOpenApiDocument, reconcileDocs } from '../openapi.builder';

/**
 * The API reference is generated from the running application, so these tests
 * are what stop it becoming confidently wrong: an endpoint added without a
 * registry entry, or a permission line that no longer matches the guard.
 */
describe('OpenAPI document', () => {
  let app: INestApplication;
  let document: ReturnType<typeof buildOpenApiDocument>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    // Fastify, matching production: the adapter decides how routes are
    // registered, and this document is built from those routes.
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());

    // Mirror bootstrap, or the generated paths will not match what is served.
    app.setGlobalPrefix(API_PREFIX, { exclude: ['health', 'health/live'] });
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: DEFAULT_API_VERSION });
    await app.init();

    document = buildOpenApiDocument(app, { serverUrl: 'http://localhost:4000' });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('documents every route the router serves, and no routes it does not', () => {
    const { undocumented, orphaned } = reconcileDocs(app);

    expect(undocumented).toEqual([]);
    expect(orphaned).toEqual([]);
  });

  it('gives every operation a summary, description and tag', () => {
    const missing = operations(document)
      .filter(({ operation }) => !operation.summary || !operation.description || !operation.tags?.length)
      .map(({ id }) => id);

    expect(missing).toEqual([]);
  });

  it('requires the CSRF header on every non-public mutating route', () => {
    // The double-submit token is the only thing standing between a cookie
    // session and a cross-site write, so a mutating route documented without it
    // is either a doc bug or a real hole.
    const mutating = new Set(['post', 'put', 'patch', 'delete']);

    const wrong = operations(document)
      .filter(({ verb, operation }) => {
        if (!mutating.has(verb)) return false;
        const security = operation.security ?? [];
        if (security.length === 0) return false; // public by design; asserted below
        return !security.some((scheme) => 'csrfToken' in scheme);
      })
      .map(({ id }) => id);

    expect(wrong).toEqual([]);
  });

  it('marks exactly the intended endpoints as reachable without a session', () => {
    const publicOps = operations(document)
      .filter(({ operation }) => (operation.security ?? []).length === 0)
      .map(({ id }) => id)
      .sort();

    // Anything new appearing here is an endpoint that ships unauthenticated.
    // The integration routes carry no session because they are server-to-server
    // calls from the website; each verifies an HMAC signature over the raw body
    // before touching it, which is their authentication.
    //
    // `reset` is the one to think hardest about, because it is the only
    // unauthenticated route that *removes* anything. It is acceptable here for
    // two reasons: the signature gate is the same shared secret that already
    // authorises pushing applications, so it grants no capability an attacker
    // could not otherwise reach; and what it clears is bounded to
    // website-sourced rows, soft-deleted, with append-only history preserved.
    expect(publicOps).toEqual([
      // The website reads this to work out what it still owes us. It is signed
      // with the same shared secret as the pushes and discloses only opaque
      // ids the caller already generated.
      'get /api/v1/integrations/nbr-website/known-ids',
      'get /health',
      'get /health/live',
      'post /api/v1/auth/forgot-password',
      'post /api/v1/auth/login',
      'post /api/v1/auth/refresh',
      'post /api/v1/auth/reset-password',
      'post /api/v1/integrations/nbr-website/applications',
      'post /api/v1/integrations/nbr-website/imported-certificates',
      // Triggers a re-read of the website's own catalogue. Signed, and it
      // writes nothing that did not come from the website in the first place.
      'post /api/v1/integrations/nbr-website/packages-changed',
      'post /api/v1/integrations/nbr-website/reset',
      // The website telling us it blocked or unblocked an account, which opens
      // or lifts a blacklist entry here. Signed like the rest. Worth noting
      // that it is the one public route whose effect is a *restriction*: the
      // worst an attacker with the shared secret could do is block an applicant
      // who was never blocked, which is visible on the register, reversible by
      // any operator, and destroys nothing.
      'post /api/v1/integrations/nbr-website/user-block',
    ]);
  });

  it('resolves every documented request body to a real schema', () => {
    const empty = operations(document)
      .filter(({ operation }) => {
        const schema = operation.requestBody?.content?.['application/json']?.schema as
          | { properties?: Record<string, unknown> }
          | undefined;
        return operation.requestBody !== undefined && !schema?.properties;
      })
      .map(({ id }) => id);

    // A body documented as `{}` is worse than none — it tells an integrator the
    // endpoint takes nothing.
    expect(empty).toEqual([]);
  });

  it('describes the permission each route actually enforces', () => {
    const reveal = document.paths['/api/v1/applicants/{id}/reveal-identifier']?.post;

    expect(reveal?.description).toContain('`pii:reveal`');
    expect(reveal?.description).toContain('pii.revealed');
  });
});

interface FlatOperation {
  id: string;
  verb: string;
  operation: {
    summary?: string;
    description?: string;
    tags?: string[];
    security?: Array<Record<string, unknown>>;
    requestBody?: { content?: Record<string, { schema?: unknown }> };
  };
}

function operations(document: ReturnType<typeof buildOpenApiDocument>): FlatOperation[] {
  return Object.entries(document.paths).flatMap(([path, item]) =>
    Object.entries(item as Record<string, FlatOperation['operation']>).map(([verb, operation]) => ({
      id: `${verb} ${path}`,
      verb,
      operation,
    })),
  );
}
