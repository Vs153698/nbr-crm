import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { ActionName, ModuleName, PermissionCode } from '@nbr/shared';
import { getActor, type Actor } from '../common/request-context';

export const PUBLIC_KEY = 'nbr:public';
export const PERMISSIONS_KEY = 'nbr:permissions';
export const PERMISSION_MODE_KEY = 'nbr:permission_mode';
export const ALLOW_PASSWORD_CHANGE_KEY = 'nbr:allow_password_change';

/**
 * Marks a route as reachable without authentication.
 *
 * The global guard denies by default, so forgetting to annotate a route makes
 * it *private*, not public. New endpoints therefore fail closed — the opposite
 * arrangement is how unauthenticated endpoints ship by accident.
 */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/**
 * Require permissions (§1, §25). Server-side enforcement — hiding a button in
 * the UI is never the only guard.
 *
 *   @RequirePermissions('payments:create')
 *   @RequirePermissions('reports:export', 'payments:view')   // needs both
 */
export const RequirePermissions = (...permissions: PermissionCode[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/** Any one of the listed permissions is enough. */
export const RequireAnyPermission = (...permissions: PermissionCode[]) => {
  const decorators = [
    SetMetadata(PERMISSIONS_KEY, permissions),
    SetMetadata(PERMISSION_MODE_KEY, 'any'),
  ];
  return (target: object, key?: string | symbol, descriptor?: PropertyDescriptor) => {
    for (const decorate of decorators) {
      decorate(target as never, key as never, descriptor as never);
    }
  };
};

export const Can = (module: ModuleName, action: ActionName) =>
  RequirePermissions(`${module}:${action}` as PermissionCode);

/**
 * Routes a user with `mustChangePassword` may still call. Everything else is
 * blocked until they set a new password — a forced rotation that can be
 * navigated around is not a forced rotation.
 */
export const AllowDuringPasswordChange = () => SetMetadata(ALLOW_PASSWORD_CHANGE_KEY, true);

/** Injects the authenticated actor into a handler parameter. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, _ctx: ExecutionContext): Actor => {
    const actor = getActor();
    if (!actor) {
      throw new Error('CurrentUser used on a route with no authenticated actor');
    }
    return actor;
  },
);
