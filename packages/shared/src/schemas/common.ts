import { z } from 'zod';

/**
 * Consistent API envelope across every endpoint (per the repository/API-format
 * convention): `{ success, data, error, meta }`.
 */
export interface ApiError {
  readonly code: string;
  readonly message: string;
  /** Field-level validation problems, keyed by dot-path. */
  readonly fields?: Record<string, string[]>;
  /** Correlation id — present on every response, quoted in support tickets. */
  readonly requestId?: string;
}

export interface ApiResponse<T> {
  readonly success: boolean;
  readonly data: T | null;
  readonly error: ApiError | null;
  readonly meta?: Record<string, unknown>;
}

export interface CursorPage<T> {
  readonly items: T[];
  /** Opaque cursor for the next page; null when exhausted. */
  readonly nextCursor: string | null;
  /** Total is only computed when the client asks — it costs a second query. */
  readonly total?: number;
}

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 50;

/**
 * Keyset pagination (§7). Offset pagination degrades linearly with page depth;
 * a cursor keeps page 500 as fast as page 1 on a 100k-row applicant table.
 */
export const cursorQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  /** Ask for a total count. Off by default because it costs an extra scan. */
  withTotal: z.coerce.boolean().default(false),
});

export type CursorQuery = z.infer<typeof cursorQuerySchema>;

export const sortQuerySchema = z.object({
  sortBy: z.string().max(60).optional(),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

export const dateRangeSchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: '"from" must be on or before "to"',
    path: ['from'],
  });

export const uuidSchema = z.string().uuid('Must be a valid identifier');

export const idParamSchema = z.object({ id: uuidSchema });

/** Trim, collapse internal whitespace, and treat "" as absent. */
export const trimmedString = (max: number) =>
  z
    .string()
    .transform((v) => v.replace(/\s+/g, ' ').trim())
    .pipe(z.string().max(max));

export const optionalTrimmedString = (max: number) =>
  z
    .string()
    .transform((v) => {
      const cleaned = v.replace(/\s+/g, ' ').trim();
      return cleaned.length === 0 ? undefined : cleaned;
    })
    .pipe(z.string().max(max).optional())
    .optional();

/** NUMERIC(12,2)-compatible money string. */
export const moneySchema = z
  .string()
  .regex(/^-?\d{1,10}(\.\d{1,2})?$/, 'Enter a valid amount, e.g. 4500.00');

export const indianMobileSchema = z
  .string()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .pipe(
    z
      .string()
      .regex(
        /^(\+?91)?[6-9]\d{9}$/,
        'Enter a valid 10-digit Indian mobile number',
      ),
  );

/** International numbers are allowed for overseas applicants (§20 flag). */
export const phoneSchema = z
  .string()
  .transform((v) => v.replace(/[\s-()]/g, ''))
  .pipe(z.string().regex(/^\+?\d{7,15}$/, 'Enter a valid phone number'));

export const emailSchema = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .pipe(z.string().email('Enter a valid email address').max(255));

export const pincodeSchema = z
  .string()
  .regex(/^[1-9][0-9]{5}$/, 'Enter a valid 6-digit PIN code');

/**
 * Password policy. Length does most of the work; the character-class rules are
 * there because the client's internal IT policy asks for them.
 */
export const passwordSchema = z
  .string()
  .min(12, 'Use at least 12 characters')
  .max(128, 'Password is too long')
  .regex(/[a-z]/, 'Include a lowercase letter')
  .regex(/[A-Z]/, 'Include an uppercase letter')
  .regex(/\d/, 'Include a number')
  .regex(/[^A-Za-z0-9]/, 'Include a symbol');
