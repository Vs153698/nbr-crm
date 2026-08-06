import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Render a Zod schema as inline OpenAPI-flavoured JSON Schema.
 *
 * Inlined rather than `$ref`-ed on purpose: someone reading one endpoint should
 * see its whole payload without chasing definitions across the document. The
 * duplication costs bytes in generated output and nothing in maintenance,
 * because these are the same schema objects the server validates with — the
 * documented shape and the enforced shape cannot drift apart.
 *
 * The parameter is `unknown` rather than `ZodTypeAny` deliberately. Checking a
 * large Zod schema for assignability to `ZodTypeAny` re-instantiates its whole
 * type tree, and doing that at three dozen call sites exhausts the compiler's
 * heap. The runtime contract is unchanged — callers pass Zod schemas.
 */
export function zodSchema(schema: unknown, name = 'Payload'): Record<string, unknown> {
  const generate = zodToJsonSchema as unknown as (
    schema: unknown,
    options: Record<string, unknown>,
  ) => { definitions?: Record<string, Record<string, unknown>> };

  const generated = generate(schema, {
    name,
    $refStrategy: 'none',
    target: 'openApi3',
  });

  return generated.definitions?.[name] ?? {};
}
