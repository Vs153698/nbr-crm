import { Controller, Get, Inject, Module, VERSION_NEUTRAL } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type postgres from 'postgres';
import { Public } from '../auth/auth.decorators';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { PG } from '../database/database.tokens';
import { REDIS } from '../redis/redis.module';

interface HealthReport {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  version: string;
  checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }>;
}

/**
 * Liveness and readiness.
 *
 * `/health` is public and deliberately thin: it reports whether dependencies
 * answer, and nothing about versions of anything an attacker could use. The
 * detailed check runs the cheapest possible query against each dependency so
 * the uptime monitor polling it every 30 seconds costs nothing.
 */
// Version-neutral and outside the /api prefix: uptime monitors and load
// balancers should not have to track an API version to ask "are you alive?".
@Controller({ path: 'health', version: VERSION_NEUTRAL })
class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    @Inject(PG) private readonly sql: postgres.Sql,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Public()
  @Get()
  async check(): Promise<HealthReport> {
    const checks: HealthReport['checks'] = {};

    checks.database = await timed(async () => {
      await this.sql`SELECT 1`;
    });

    checks.redis = await timed(async () => {
      await this.redis.ping();
    });

    const allOk = Object.values(checks).every((c) => c.ok);

    return {
      status: allOk ? 'ok' : 'degraded',
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      version: this.env.NODE_ENV,
      checks,
    };
  }

  /** Kubernetes/PM2-style liveness: is the process itself responsive? */
  @Public()
  @Get('live')
  live(): { ok: true } {
    return { ok: true };
  }
}

async function timed(fn: () => Promise<void>): Promise<{
  ok: boolean;
  latencyMs?: number;
  error?: string;
}> {
  const started = Date.now();
  try {
    await fn();
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : 'unreachable' };
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
