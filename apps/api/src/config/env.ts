import { z } from 'zod';

/**
 * Environment validation.
 *
 * The process refuses to boot on a bad or missing value rather than failing at
 * 3am on the first request that needs it. Secrets get extra scrutiny in
 * production: a placeholder that ships to prod is a vulnerability, not a typo.
 */

const bool = (defaultValue: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .default(defaultValue)
    .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const csv = () =>
  z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );

/** Base64-encoded 32-byte key. */
const base64Key32 = z
  .string()
  .min(1)
  .refine(
    (v) => {
      try {
        return Buffer.from(v, 'base64').length === 32;
      } catch {
        return false;
      }
    },
    { message: 'Must be a base64-encoded 32-byte key (openssl rand -base64 32)' },
  );

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    APP_NAME: z.string().default('NBR Backend CRM'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    API_URL: z.string().url().default('http://localhost:4000'),
    WEB_URL: z.string().url().default('http://localhost:5173'),
    CORS_ORIGINS: csv(),

    /**
     * Serve the interactive API reference at `/api/docs`.
     *
     * Unset means "on outside production". The reference enumerates every
     * endpoint and the permission it requires, which is a map of the system
     * worth handing an attacker, so production has to opt in deliberately.
     */
    DOCS_ENABLED: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => (value === undefined ? undefined : value === 'true')),

    DATABASE_URL: z.string().url(),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(200).default(20),

    REDIS_URL: z.string().url(),

    JWT_ACCESS_SECRET: z.string().min(32, 'Use at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'Use at least 32 characters'),
    JWT_ACCESS_TTL: z.string().default('15m'),
    JWT_REFRESH_TTL: z.string().default('7d'),
    SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().min(5).max(1440).default(30),
    LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(3).max(20).default(5),
    LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
    COOKIE_DOMAIN: z.string().default('localhost'),
    COOKIE_SECURE: bool(false),

    PII_ENCRYPTION_KEY: base64Key32,
    PII_ENCRYPTION_KEY_PREVIOUS: z.string().optional(),

    SUPER_ADMIN_EMAIL: z.string().email(),
    SUPER_ADMIN_PASSWORD: z.string().min(12),
    SUPER_ADMIN_NAME: z.string().default('Platform Super Admin'),

    S3_ENDPOINT: z.string().url(),
    S3_REGION: z.string().default('auto'),
    S3_BUCKET: z.string().min(1),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_FORCE_PATH_STYLE: bool(true),
    S3_PUBLIC_BASE_URL: z.string().optional(),
    UPLOAD_PRESIGN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    DOWNLOAD_PRESIGN_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
    MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(2048).default(200),

    SMTP_HOST: z.string().default('localhost'),
    SMTP_PORT: z.coerce.number().int().default(1025),
    SMTP_SECURE: bool(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    MAIL_FROM_NAME: z.string().default('National Book of Records'),
    MAIL_FROM_ADDRESS: z.string().email(),

    NBR_WEBHOOK_SECRET: z.string().min(16),
    NBR_WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
    NBR_POLL_ENABLED: bool(false),
    NBR_POLL_URL: z.string().optional(),
    NBR_POLL_API_KEY: z.string().optional(),
    NBR_POLL_INTERVAL_CRON: z.string().default('*/5 * * * *'),

    DPDP_DATA_FIDUCIARY_NAME: z.string().default('National Book of Records'),
    DPDP_GRIEVANCE_OFFICER_NAME: z.string().default('Grievance Officer'),
    DPDP_GRIEVANCE_OFFICER_EMAIL: z.string().email(),
    DPDP_GRIEVANCE_OFFICER_PHONE: z.string().optional(),
    DPDP_DSR_RESPONSE_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    DPDP_GRIEVANCE_RESPONSE_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    DPDP_RETENTION_YEARS: z.coerce.number().int().min(1).max(50).default(8),
    DPDP_BREACH_NOTIFY_HOURS: z.coerce.number().int().min(1).max(168).default(72),
    DPDP_DATA_REGION: z.string().default('IN'),

    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    SENTRY_DSN: z.string().optional(),
    RATE_LIMIT_GLOBAL_PER_MINUTE: z.coerce.number().int().min(10).max(10000).default(300),
  })
  .superRefine((env, ctx) => {
    // Two different secrets. Reusing one means a leaked access token can be
    // replayed as a refresh token.
    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message: 'JWT_REFRESH_SECRET must differ from JWT_ACCESS_SECRET',
      });
    }

    if (env.NODE_ENV !== 'production') return;

    // ── Production-only guards ────────────────────────────────────────────
    const placeholders: Array<[string, string | undefined]> = [
      ['JWT_ACCESS_SECRET', env.JWT_ACCESS_SECRET],
      ['JWT_REFRESH_SECRET', env.JWT_REFRESH_SECRET],
      ['PII_ENCRYPTION_KEY', env.PII_ENCRYPTION_KEY],
      ['NBR_WEBHOOK_SECRET', env.NBR_WEBHOOK_SECRET],
      ['SUPER_ADMIN_PASSWORD', env.SUPER_ADMIN_PASSWORD],
    ];
    for (const [key, value] of placeholders) {
      if (value && /CHANGE_ME|changeme|password|secret123/i.test(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} still holds a placeholder value — generate a real secret before deploying`,
        });
      }
    }

    if (!env.COOKIE_SECURE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['COOKIE_SECURE'],
        message: 'COOKIE_SECURE must be true in production — session cookies would otherwise travel over plain HTTP',
      });
    }

    if (env.CORS_ORIGINS.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGINS'],
        message: 'Set CORS_ORIGINS explicitly in production',
      });
    }

    if (env.CORS_ORIGINS.some((o) => o === '*')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGINS'],
        message: 'Wildcard CORS is not permitted — the API serves personal data with credentials',
      });
    }

    if (env.NBR_POLL_ENABLED && !env.NBR_POLL_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['NBR_POLL_URL'],
        message: 'NBR_POLL_URL is required when polling fallback is enabled',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  • ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration — refusing to start.\n${details}\n\n` +
        'Copy .env.example to .env and fill in the missing values.',
    );
  }

  cached = parsed.data;
  return cached;
}

/** Test helper — lets a suite swap in a different environment. */
export function resetEnvCache(): void {
  cached = null;
}
