import { Controller, Get, Inject, Module } from '@nestjs/common';
import { ACTIONS, MODULES } from '@nbr/shared';
import { asc, eq, isNull, and } from 'drizzle-orm';
import { Can } from '../auth/auth.decorators';
import type { Database } from '../database/client';
import { DB } from '../database/database.tokens';
import * as schema from '../database/schema';
import { CacheService, CacheTag, CacheTtl } from '../redis/cache.service';

export interface Lookups {
  readonly categories: Array<{ id: string; name: string }>;
  readonly packages: Array<{ id: string; name: string; amount: string; gstPercent: string }>;
  readonly couriers: Array<{ id: string; name: string; trackingUrlTemplate: string | null }>;
  readonly staff: Array<{ id: string; fullName: string; roleName: string }>;
}

/**
 * Reference data for form dropdowns — categories, packages, couriers and the
 * assignable staff list.
 *
 * One endpoint rather than four, cached for ten minutes: this is the data every
 * form needs and almost none of it changes during a working day. Four separate
 * round trips before the Add Applicant form can render would be four times the
 * latency for no benefit.
 */
@Controller('lookups')
class LookupsController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly cache: CacheService,
  ) {}

  @Get()
  @Can(MODULES.APPLICANTS, ACTIONS.VIEW)
  async all(): Promise<Lookups> {
    return this.cache.remember('lookups:all', CacheTtl.reference, [CacheTag.settings()], async () => {
      const [categories, packages, couriers, staff] = await Promise.all([
        this.db
          .select({ id: schema.categories.id, name: schema.categories.name })
          .from(schema.categories)
          .where(eq(schema.categories.isActive, true))
          .orderBy(asc(schema.categories.sortOrder), asc(schema.categories.name)),

        this.db
          .select({
            id: schema.packages.id,
            name: schema.packages.name,
            amount: schema.packages.amount,
            gstPercent: schema.packages.gstPercent,
          })
          .from(schema.packages)
          .where(eq(schema.packages.isActive, true))
          .orderBy(asc(schema.packages.sortOrder)),

        this.db
          .select({
            id: schema.couriers.id,
            name: schema.couriers.name,
            trackingUrlTemplate: schema.couriers.trackingUrlTemplate,
          })
          .from(schema.couriers)
          .where(eq(schema.couriers.isActive, true))
          .orderBy(asc(schema.couriers.sortOrder)),

        // Only active staff are assignable — assigning a record to someone who
        // has left is a silent way to lose it.
        this.db
          .select({
            id: schema.users.id,
            fullName: schema.users.fullName,
            roleName: schema.roles.name,
          })
          .from(schema.users)
          .innerJoin(schema.roles, eq(schema.users.roleId, schema.roles.id))
          .where(and(eq(schema.users.status, 'active'), isNull(schema.users.deletedAt)))
          .orderBy(asc(schema.users.fullName)),
      ]);

      return { categories, packages, couriers, staff };
    });
  }
}

@Module({ controllers: [LookupsController] })
export class LookupsModule {}
