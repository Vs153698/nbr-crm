import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from './redis.tokens';

/**
 * Tagged application cache (§7 "The caching stack, end to end").
 *
 * Two design decisions worth stating:
 *
 *  1. **Cache misses are never fatal.** Every method swallows Redis errors and
 *     falls through to the loader. A Redis outage makes the dashboard slower;
 *     it must not make it unavailable.
 *
 *  2. **Invalidation is by tag, not by guessing key names.** A domain event
 *     ("payment recorded on record X") busts `record:X` and `dashboard`, and
 *     every key registered under those tags disappears — including ones added
 *     by a feature written months later. Hand-maintained invalidation lists are
 *     how stale dashboards happen.
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly prefix = 'nbr:';

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  private key(key: string): string {
    return `${this.prefix}${key}`;
  }

  private tagKey(tag: string): string {
    return `${this.prefix}tag:${tag}`;
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(this.key(key));
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (error: unknown) {
      this.logger.warn(`Cache read failed for "${key}": ${describe(error)}`);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number, tags: string[] = []): Promise<void> {
    try {
      const fullKey = this.key(key);
      const pipeline = this.redis.pipeline();
      pipeline.set(fullKey, JSON.stringify(value), 'EX', ttlSeconds);

      for (const tag of tags) {
        pipeline.sadd(this.tagKey(tag), fullKey);
        // Tag sets outlive their members slightly, then expire on their own —
        // otherwise a long-lived tag set grows unbounded with dead key names.
        pipeline.expire(this.tagKey(tag), ttlSeconds + 300);
      }

      await pipeline.exec();
    } catch (error: unknown) {
      this.logger.warn(`Cache write failed for "${key}": ${describe(error)}`);
    }
  }

  /** Read-through: return the cached value, or compute, store and return it. */
  async remember<T>(
    key: string,
    ttlSeconds: number,
    tags: string[],
    loader: () => Promise<T>,
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    const value = await loader();
    await this.set(key, value, ttlSeconds, tags);
    return value;
  }

  async forget(key: string): Promise<void> {
    try {
      await this.redis.del(this.key(key));
    } catch (error: unknown) {
      this.logger.warn(`Cache delete failed for "${key}": ${describe(error)}`);
    }
  }

  /** Bust every key registered under these tags. */
  async invalidateTags(...tags: string[]): Promise<void> {
    if (tags.length === 0) return;
    try {
      const pipeline = this.redis.pipeline();
      const tagKeys = tags.map((t) => this.tagKey(t));

      const members = await Promise.all(tagKeys.map((tk) => this.redis.smembers(tk)));
      const keys = [...new Set(members.flat())];

      if (keys.length > 0) pipeline.del(...keys);
      pipeline.del(...tagKeys);
      await pipeline.exec();
    } catch (error: unknown) {
      this.logger.warn(`Cache invalidation failed for [${tags.join(', ')}]: ${describe(error)}`);
    }
  }

  // ── Counters (rate limiting, login attempts, reminder counts) ─────────────

  /** Increment and return the new value, setting a TTL on first use. */
  async increment(key: string, ttlSeconds: number): Promise<number> {
    try {
      const fullKey = this.key(key);
      const results = await this.redis.multi().incr(fullKey).expire(fullKey, ttlSeconds, 'NX').exec();
      return (results?.[0]?.[1] as number | undefined) ?? 0;
    } catch (error: unknown) {
      this.logger.warn(`Counter increment failed for "${key}": ${describe(error)}`);
      // Returning 0 fails *open* on rate limiting. That is the right trade-off
      // here: the auth path has an independent database-backed lockout, so a
      // Redis outage cannot turn into an authentication bypass.
      return 0;
    }
  }

  async ttl(key: string): Promise<number> {
    try {
      return await this.redis.ttl(this.key(key));
    } catch {
      return -1;
    }
  }

  // ── Session revocation list ───────────────────────────────────────────────

  /**
   * Deny-list a session id until its token would have expired anyway.
   * Checked on every authenticated request, which is what makes "force logout"
   * from the Users screen take effect immediately rather than in 15 minutes.
   */
  async revokeSession(sessionId: string, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(this.key(`revoked:${sessionId}`), '1', 'EX', ttlSeconds);
    } catch (error: unknown) {
      this.logger.error(`Failed to revoke session ${sessionId}: ${describe(error)}`);
      // Rethrow: silently failing to revoke a session is a security hole, and
      // the caller must be able to tell the user it didn't work.
      throw error;
    }
  }

  async isSessionRevoked(sessionId: string): Promise<boolean> {
    try {
      return (await this.redis.exists(this.key(`revoked:${sessionId}`))) === 1;
    } catch (error: unknown) {
      this.logger.warn(`Revocation check failed for ${sessionId}: ${describe(error)}`);
      // Fail *closed* — treat as revoked. A user re-authenticating is a much
      // smaller problem than a revoked session staying alive.
      return true;
    }
  }
}

/** Cache tag vocabulary. Centralised so a typo can't silently skip a bust. */
export const CacheTag = {
  dashboard: () => 'dashboard',
  applicant: (id: string) => `applicant:${id}`,
  record: (id: string) => `record:${id}`,
  applicantList: () => 'applicant-list',
  templates: () => 'templates',
  settings: () => 'settings',
  permissions: () => 'permissions',
  user: (id: string) => `user:${id}`,
  reports: () => 'reports',
  notifications: (userId: string) => `notifications:${userId}`,
} as const;

export const CacheTtl = {
  /** Dashboard counters: pre-computed, event-invalidated, 60s safety net. */
  dashboard: 60,
  /** Profile payloads — short, because staff edit and expect to see it. */
  profile: 30,
  list: 15,
  /** Rarely-changing reference data. */
  reference: 600,
  /** Effective permission set per role. */
  permissions: 300,
  search: 20,
} as const;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
