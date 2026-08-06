import { METHOD_METADATA, PATH_METADATA, VERSION_METADATA } from '@nestjs/common/constants';
import { RequestMethod, type INestApplication } from '@nestjs/common';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import type { OpenAPIObject } from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { PERMISSIONS_KEY, PERMISSION_MODE_KEY, PUBLIC_KEY } from '../auth/auth.decorators';
import { API_PREFIX, DEFAULT_API_VERSION } from '../common/constants';
import { ROUTE_DOCS, type RouteDoc } from './openapi.registry';
import { ERROR_RESPONSES, OPENAPI_INFO, TAG_GROUPS } from './openapi.meta';

/** Nest stores the HTTP verb as a `RequestMethod` enum member. */
const VERB_BY_METHOD: Partial<Record<RequestMethod, string>> = {
  [RequestMethod.GET]: 'get',
  [RequestMethod.POST]: 'post',
  [RequestMethod.PUT]: 'put',
  [RequestMethod.PATCH]: 'patch',
  [RequestMethod.DELETE]: 'delete',
};

/** Verbs that the CSRF double-submit guard applies to. */
const MUTATING = new Set(['post', 'put', 'patch', 'delete']);

/** Controller paths that `main.ts` excludes from the global `/api` prefix. */
const PREFIX_EXCLUDED = new Set(['health']);

interface DiscoveredRoute {
  readonly controller: string;
  readonly handler: string;
  readonly verb: string;
  readonly path: string;
  readonly pathParams: readonly string[];
  readonly permissions: readonly string[];
  readonly permissionMode: 'all' | 'any';
  readonly isPublic: boolean;
}

/**
 * Build the OpenAPI document by walking the application's own metadata.
 *
 * Deliberately *not* `SwaggerModule.createDocument`: this codebase validates
 * with Zod rather than decorated DTO classes, so the automatic scanner would
 * emit a hundred endpoints with empty request bodies. Reading Nest's route
 * metadata directly gives exact paths, verbs and versions, and reading the
 * `@Can(...)` metadata gives the required permission for each route straight
 * from the guard that enforces it — the spec cannot claim a permission the
 * server does not actually check.
 *
 * Prose and payload schemas come from `ROUTE_DOCS`, which is reconciled
 * against this walk at startup so a new endpoint cannot ship undocumented.
 */
export function buildOpenApiDocument(
  app: INestApplication,
  options: { serverUrl: string },
): OpenAPIObject {
  const routes = discoverRoutes(app);
  const paths: OpenAPIObject['paths'] = {};

  for (const route of routes) {
    const doc = ROUTE_DOCS[`${route.controller}.${route.handler}`];
    if (!doc) continue; // reconcileDocs() reports these; don't emit a stub.

    const operation = buildOperation(route, doc);
    const existing = paths[route.path] ?? {};
    paths[route.path] = { ...existing, [route.verb]: operation };
  }

  return {
    openapi: '3.0.3',
    info: OPENAPI_INFO,
    servers: [{ url: options.serverUrl, description: 'Current environment' }],
    tags: TAG_GROUPS.map((group) => ({ name: group.name, description: group.description })),
    paths,
    components: {
      securitySchemes: {
        sessionCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: 'nbr_access',
          description:
            'Short-lived access token, set as an HttpOnly SameSite=strict cookie by ' +
            '`POST /auth/login`. It is never readable from JavaScript, so there is no ' +
            'bearer token to paste here — sign in through the API and the browser will ' +
            'send it automatically. Expired tokens are renewed via `POST /auth/refresh`, ' +
            'which rotates the refresh token and detects reuse.',
        },
        csrfToken: {
          type: 'apiKey',
          in: 'header',
          name: 'x-csrf-token',
          description:
            'Double-submit CSRF token. Required on every state-changing request. Read it ' +
            'from the non-HttpOnly `nbr_csrf` cookie and echo it in this header; the two ' +
            'must match.',
        },
      },
      schemas: buildComponentSchemas(),
    },
    security: [{ sessionCookie: [] }],
  };
}

function buildOperation(route: DiscoveredRoute, doc: RouteDoc) {
  const parameters = [
    ...route.pathParams.map((name) => ({
      name,
      in: 'path' as const,
      required: true,
      description: doc.pathParams?.[name] ?? describePathParam(name),
      schema: { type: 'string' as const, ...(name === 'id' ? { format: 'uuid' } : {}) },
    })),
    ...(doc.query ?? []).map((param) => ({
      name: param.name,
      in: 'query' as const,
      required: param.required ?? false,
      description: param.description,
      schema: param.schema ?? { type: 'string' as const },
      ...(param.example === undefined ? {} : { example: param.example }),
    })),
  ];

  const security = route.isPublic
    ? []
    : MUTATING.has(route.verb)
      ? [{ sessionCookie: [], csrfToken: [] }]
      : [{ sessionCookie: [] }];

  return {
    tags: [doc.tag],
    operationId: `${route.controller.replace(/Controller$/, '')}_${route.handler}`,
    summary: doc.summary,
    description: composeDescription(route, doc),
    parameters: parameters.length > 0 ? parameters : undefined,
    requestBody: doc.body ? { required: true, content: jsonContent(doc.body) } : undefined,
    responses: buildResponses(route, doc),
    security,
  };
}

/**
 * The permission line is generated, not written by hand, so it always matches
 * the guard. A route with no `@Can(...)` is called out explicitly rather than
 * silently omitted — "any signed-in user can call this" is information.
 */
function composeDescription(route: DiscoveredRoute, doc: RouteDoc): string {
  const parts = [doc.description];

  if (route.isPublic) {
    parts.push('**Authentication:** none — this endpoint is reachable signed out.');
  } else if (route.permissions.length === 0) {
    parts.push('**Permissions:** none beyond a valid session.');
  } else {
    const joined = route.permissions.map((code) => `\`${code}\``).join(
      route.permissionMode === 'any' ? ' or ' : ' and ',
    );
    parts.push(`**Permissions:** requires ${joined}.`);
  }

  if (!route.isPublic && MUTATING.has(route.verb)) {
    parts.push('**CSRF:** send the `nbr_csrf` cookie value in the `x-csrf-token` header.');
  }

  if (doc.audited) {
    parts.push(
      `**Audit:** writes \`${doc.audited}\` to the audit log with the actor, IP and request ID. ` +
        'Audit rows cannot be edited or deleted.',
    );
  }

  if (doc.idempotency) {
    parts.push(`**Idempotency:** ${doc.idempotency}`);
  }

  if (doc.notes) parts.push(doc.notes);

  return parts.filter(Boolean).join('\n\n');
}

function buildResponses(route: DiscoveredRoute, doc: RouteDoc) {
  const okStatus = route.verb === 'post' ? '201' : '200';

  const responses: Record<string, unknown> = {
    [okStatus]: {
      description: doc.responseDescription ?? 'Success.',
      content: jsonContent(envelope(doc.response)),
    },
  };

  // Every route sits behind the global guard, the CSRF plugin and the rate
  // limiter, so these are real possibilities on all of them rather than
  // boilerplate.
  if (!route.isPublic) {
    responses['401'] = ERROR_RESPONSES.unauthorised;
    if (route.permissions.length > 0) responses['403'] = ERROR_RESPONSES.forbidden;
    if (MUTATING.has(route.verb)) responses['403'] = ERROR_RESPONSES.forbiddenOrCsrf;
  }

  if (doc.body || (doc.query ?? []).length > 0) responses['422'] = ERROR_RESPONSES.validation;
  if (route.pathParams.length > 0) responses['404'] = ERROR_RESPONSES.notFound;

  for (const [status, error] of Object.entries(doc.errors ?? {})) {
    responses[status] = error;
  }

  responses['429'] = ERROR_RESPONSES.rateLimited;

  return responses;
}

/** Wrap a payload schema in the envelope every handler returns. */
function envelope(data: unknown) {
  return {
    type: 'object',
    required: ['success', 'data', 'error'],
    properties: {
      success: { type: 'boolean', enum: [true] },
      data: data ?? { nullable: true },
      error: { type: 'object', nullable: true, enum: [null] },
      meta: {
        type: 'object',
        description: 'Request id, and pagination cursors where the endpoint pages.',
        additionalProperties: true,
      },
    },
  };
}

function jsonContent(schema: unknown) {
  return { 'application/json': { schema } };
}

function describePathParam(name: string): string {
  if (name === 'id') return 'Resource UUID.';
  if (name === 'type') return 'Entity or report type.';
  if (name === 'key') return 'Setting key.';
  return `\`${name}\` path parameter.`;
}

function buildComponentSchemas(): Record<string, SchemaObject> {
  return {
    ErrorEnvelope: {
      type: 'object',
      required: ['success', 'data', 'error'],
      properties: {
        success: { type: 'boolean', enum: [false] },
        data: { nullable: true, enum: [null] },
        error: {
          type: 'object',
          required: ['code', 'message'],
          properties: {
            code: {
              type: 'string',
              description: 'Stable machine-readable code. Branch on this, never on the message.',
              example: 'GUARD_NOT_SATISFIED',
            },
            message: {
              type: 'string',
              description: 'Human-readable and safe to show an end user.',
            },
            fields: {
              type: 'object',
              nullable: true,
              description: 'Per-field messages on a validation failure.',
              additionalProperties: { type: 'array', items: { type: 'string' } },
            },
            meta: { type: 'object', nullable: true, additionalProperties: true },
            requestId: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    Money: {
      type: 'object',
      description:
        'Money is carried in integer paise, never as a float. `display` is the pre-formatted ' +
        'Indian-notation string so the client never re-derives it.',
      properties: {
        paise: { type: 'integer', example: 918_040 },
        display: { type: 'string', example: '₹9,180.40' },
      },
    },
  };
}

// ── Route discovery ─────────────────────────────────────────────────────────

function discoverRoutes(app: INestApplication): DiscoveredRoute[] {
  const discovery = app.get(DiscoveryService);
  const scanner = new MetadataScanner();
  const routes: DiscoveredRoute[] = [];

  for (const wrapper of discovery.getControllers()) {
    const { instance, metatype } = wrapper;
    if (!instance || !metatype) continue;

    const prototype = Object.getPrototypeOf(instance) as object;
    const controllerPath = normalise(
      (Reflect.getMetadata(PATH_METADATA, metatype) as string | undefined) ?? '',
    );
    const classPermissions = readPermissions(metatype);

    for (const handler of scanner.getAllMethodNames(prototype)) {
      const method = (prototype as Record<string, unknown>)[handler];
      if (typeof method !== 'function') continue;

      const verbCode = Reflect.getMetadata(METHOD_METADATA, method) as RequestMethod | undefined;
      if (verbCode === undefined) continue;

      const verb = VERB_BY_METHOD[verbCode];
      if (!verb) continue; // ALL / OPTIONS / HEAD are not part of this API.

      const methodPath = normalise(
        (Reflect.getMetadata(PATH_METADATA, method) as string | undefined) ?? '',
      );
      // Version-neutral routes report a symbol rather than a version string.
      const declaredVersion = Reflect.getMetadata(VERSION_METADATA, method) as unknown;
      const classVersion = Reflect.getMetadata(VERSION_METADATA, metatype) as unknown;
      const version = resolveVersion(declaredVersion ?? classVersion);
      const handlerPermissions = readPermissions(method);

      const fullPath = buildPath(controllerPath, methodPath, version);

      routes.push({
        controller: metatype.name,
        handler,
        verb,
        path: fullPath,
        pathParams: [...fullPath.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]!),
        permissions: handlerPermissions.permissions ?? classPermissions.permissions ?? [],
        permissionMode:
          handlerPermissions.mode ?? classPermissions.mode ?? 'all',
        isPublic:
          (Reflect.getMetadata(PUBLIC_KEY, method) as boolean | undefined) ??
          (Reflect.getMetadata(PUBLIC_KEY, metatype) as boolean | undefined) ??
          false,
      });
    }
  }

  return routes.sort((a, b) => a.path.localeCompare(b.path) || a.verb.localeCompare(b.verb));
}

/**
 * `VERSION_NEUTRAL` is a symbol, not a version string. Returning `undefined`
 * for it drops the `/vN` segment, which is what those routes actually serve.
 */
function resolveVersion(raw: unknown): string | undefined {
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'symbol') return undefined;
  return DEFAULT_API_VERSION;
}

function readPermissions(target: object): {
  permissions?: string[];
  mode?: 'all' | 'any';
} {
  return {
    permissions: Reflect.getMetadata(PERMISSIONS_KEY, target) as string[] | undefined,
    mode: Reflect.getMetadata(PERMISSION_MODE_KEY, target) as 'all' | 'any' | undefined,
  };
}

/**
 * Compose the served path.
 *
 * `main.ts` excludes the health routes from the global prefix so uptime
 * monitors need not track an API version; `PREFIX_EXCLUDED` mirrors that, and
 * a version-neutral route drops the `/vN` segment. `:id` is Nest's parameter
 * syntax, OpenAPI wants `{id}`.
 */
function buildPath(
  controllerPath: string,
  methodPath: string,
  version: string | undefined,
): string {
  const prefixed = !PREFIX_EXCLUDED.has(controllerPath);
  const segments = [
    ...(prefixed ? [API_PREFIX] : []),
    ...(prefixed && version ? [`v${version}`] : []),
    controllerPath,
    methodPath,
  ].filter((segment) => segment.length > 0);

  return `/${segments.join('/')}`.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function normalise(path: string): string {
  return path.replace(/^\/+|\/+$/g, '');
}

/**
 * Fail loudly when the registry and the router disagree.
 *
 * Without this the spec would rot the first time someone adds an endpoint —
 * and a stale API document is worse than none, because it is believed.
 */
export function reconcileDocs(app: INestApplication): {
  undocumented: string[];
  orphaned: string[];
  total: number;
} {
  const routes = discoverRoutes(app);
  const keys = new Set(routes.map((route) => `${route.controller}.${route.handler}`));

  return {
    undocumented: [...keys].filter((key) => !ROUTE_DOCS[key]).sort(),
    orphaned: Object.keys(ROUTE_DOCS).filter((key) => !keys.has(key)).sort(),
    total: routes.length,
  };
}
