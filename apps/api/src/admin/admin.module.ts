import { Body, Controller, Get, Module, Param, Post, Put } from '@nestjs/common';
import {
  ACTIONS,
  MODULES,
  createUserSchema,
  updateUserSchema,
  upsertRoleSchema,
  uuidSchema,
} from '@nbr/shared';
import { Can } from '../auth/auth.decorators';
import { zodBody } from '../common/zod-validation.pipe';
import { NotesService } from '../notes/notes.service';
import { UsersService, type RoleRow, type UserRow } from './users.service';

@Controller('users')
class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Can(MODULES.USERS, ACTIONS.VIEW)
  async list(): Promise<UserRow[]> {
    return this.users.listUsers();
  }

  @Post()
  @Can(MODULES.USERS, ACTIONS.CREATE)
  async create(
    @Body(zodBody(createUserSchema))
    body: {
      fullName: string;
      email: string;
      employeeCode?: string;
      phone?: string;
      roleId: string;
      designation?: string;
      password?: string;
    },
  ) {
    return this.users.createUser(body);
  }

  @Put(':id')
  @Can(MODULES.USERS, ACTIONS.EDIT)
  async update(
    @Param('id') id: string,
    @Body(zodBody(updateUserSchema)) body: Record<string, never>,
  ): Promise<{ ok: true }> {
    await this.users.updateUser(uuidSchema.parse(id), body);
    return { ok: true };
  }

  /** Force-logout every device for this user (§1 "device logout"). */
  @Post(':id/revoke-sessions')
  @Can(MODULES.USERS, ACTIONS.EDIT)
  async revoke(@Param('id') id: string): Promise<{ ok: true }> {
    await this.users.revokeSessions(uuidSchema.parse(id));
    return { ok: true };
  }
}

@Controller('roles')
class RolesController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Can(MODULES.ROLES, ACTIONS.VIEW)
  async list(): Promise<RoleRow[]> {
    return this.users.listRoles();
  }

  /** The module × action vocabulary the permission grid renders from. */
  @Get('permission-catalogue')
  @Can(MODULES.ROLES, ACTIONS.VIEW)
  catalogue() {
    return this.users.getPermissionCatalogue();
  }

  @Post()
  @Can(MODULES.ROLES, ACTIONS.CREATE)
  async create(
    @Body(zodBody(upsertRoleSchema))
    body: { name: string; description?: string; permissions: string[] },
  ) {
    const result = await this.users.upsertRole(null, body);
    await this.users.invalidatePermissionCache();
    return result;
  }

  @Put(':id')
  @Can(MODULES.ROLES, ACTIONS.EDIT)
  async update(
    @Param('id') id: string,
    @Body(zodBody(upsertRoleSchema))
    body: { name: string; description?: string; permissions: string[] },
  ) {
    const result = await this.users.upsertRole(uuidSchema.parse(id), body);
    // Busting the cache here is what makes a revocation take effect at once
    // rather than at the end of the 5-minute TTL.
    await this.users.invalidatePermissionCache();
    return result;
  }
}

@Module({
  controllers: [UsersController, RolesController],
  providers: [UsersService, NotesService],
  exports: [UsersService],
})
export class AdminModule {}
