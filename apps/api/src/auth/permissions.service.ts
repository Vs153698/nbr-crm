import { Inject, Injectable } from '@nestjs/common';
import type { PermissionCode } from '@nbr/shared';
import { eq } from 'drizzle-orm';
import type { Database } from '../database/client';
import { DB } from '../database/database.tokens';
import * as schema from '../database/schema';
import { CacheService, CacheTag, CacheTtl } from '../redis/cache.service';

export interface ResolvedRole {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly isSuperAdmin: boolean;
  readonly permissions: PermissionCode[];
}

/**
 * Resolves a role's effective permission set from the database (P1-04:
 * "roles/permissions are database-driven and fully configurable").
 *
 * Cached per role because it is read on literally every authenticated request.
 * The cache is busted the moment a role's grid is saved, and users whose role
 * changes get their tokens invalidated, so a permission revocation takes effect
 * immediately rather than at the end of a TTL.
 */
@Injectable()
export class PermissionsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly cache: CacheService,
  ) {}

  async resolveRole(roleId: string): Promise<ResolvedRole | null> {
    return this.cache.remember(
      `role-permissions:${roleId}`,
      CacheTtl.permissions,
      [CacheTag.permissions()],
      async () => {
        const [role] = await this.db
          .select({
            id: schema.roles.id,
            code: schema.roles.code,
            name: schema.roles.name,
            isSuperAdmin: schema.roles.isSuperAdmin,
          })
          .from(schema.roles)
          .where(eq(schema.roles.id, roleId))
          .limit(1);

        if (!role) return null;

        // Super Admin holds everything implicitly — no grant rows, and no way
        // to accidentally lock the organisation out of its own system.
        if (role.isSuperAdmin) {
          return { ...role, permissions: [] as PermissionCode[] };
        }

        const grants = await this.db
          .select({ code: schema.permissions.code })
          .from(schema.rolePermissions)
          .innerJoin(
            schema.permissions,
            eq(schema.rolePermissions.permissionId, schema.permissions.id),
          )
          .where(eq(schema.rolePermissions.roleId, roleId));

        return {
          ...role,
          permissions: grants.map((g) => g.code as PermissionCode),
        };
      },
    );
  }

  /** Called after any change to a role's grid. */
  async invalidate(): Promise<void> {
    await this.cache.invalidateTags(CacheTag.permissions());
  }
}
