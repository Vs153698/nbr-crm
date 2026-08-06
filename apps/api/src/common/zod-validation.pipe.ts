import { Injectable, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import { ZodError, type ZodSchema } from 'zod';
import { ValidationError } from './errors';

/**
 * Validates a request payload against a Zod schema — the *same* schema the
 * browser used, imported from @nbr/shared. That is the whole point of the
 * shared package: the form and the endpoint cannot disagree about what is
 * valid, and server-side validation is never skipped because "the UI already
 * checks it".
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw new ValidationError(flattenZodError(result.error));
  }
}

/** Convenience factory so controllers read `@Body(zodBody(schema))`. */
export function zodBody<T>(schema: ZodSchema<T>): ZodValidationPipe<T> {
  return new ZodValidationPipe(schema);
}

/**
 * Turn a ZodError into `{ "applicant.mobile": ["Enter a valid…"] }` — the shape
 * react-hook-form can drop straight onto the right input.
 */
export function flattenZodError(error: ZodError): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.length > 0 ? issue.path.join('.') : '_';
    (fields[path] ??= []).push(issue.message);
  }
  return fields;
}
