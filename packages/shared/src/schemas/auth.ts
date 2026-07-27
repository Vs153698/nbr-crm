import { z } from 'zod';
import { USER_STATUS } from '../constants/catalog';
import type { PermissionCode } from '../constants/permissions';
import {
  emailSchema,
  optionalTrimmedString,
  passwordSchema,
  phoneSchema,
  trimmedString,
  uuidSchema,
} from './common';

export const loginSchema = z.object({
  /** Email or employee ID — the login screen accepts either (W-01). */
  identifier: trimmedString(255),
  password: z.string().min(1, 'Enter your password').max(128),
  rememberMe: z.boolean().default(false),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z
  .object({
    token: trimmedString(200),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .refine((v) => v.currentPassword !== v.password, {
    message: 'Choose a password you have not used before',
    path: ['password'],
  });

export const createUserSchema = z.object({
  fullName: trimmedString(150),
  email: emailSchema,
  employeeCode: optionalTrimmedString(40),
  phone: phoneSchema.optional(),
  roleId: uuidSchema,
  designation: optionalTrimmedString(120),
  /** Omitted → the API generates a temporary password and emails it. */
  password: passwordSchema.optional(),
});

export const updateUserSchema = z.object({
  fullName: optionalTrimmedString(150),
  employeeCode: optionalTrimmedString(40),
  phone: phoneSchema.optional(),
  roleId: uuidSchema.optional(),
  designation: optionalTrimmedString(120),
  status: z.nativeEnum(USER_STATUS).optional(),
});

export const upsertRoleSchema = z.object({
  name: trimmedString(80),
  description: optionalTrimmedString(300),
  /** Full permission set for the role — the Users & Roles grid PUTs the whole
   *  list rather than deltas, so the saved state is always exactly what the
   *  Admin saw on screen. */
  permissions: z.array(z.string().max(60)),
});

/** Shape returned by GET /me and cached client-side for the session. */
export interface SessionUser {
  readonly id: string;
  readonly fullName: string;
  readonly email: string;
  readonly employeeCode: string | null;
  readonly designation: string | null;
  readonly avatarUrl: string | null;
  readonly role: {
    readonly id: string;
    readonly code: string;
    readonly name: string;
    readonly isSuperAdmin: boolean;
  };
  /** Flattened effective permissions — the UI renders menus from this. */
  readonly permissions: readonly PermissionCode[];
  readonly mustChangePassword: boolean;
  readonly lastLoginAt: string | null;
  readonly sessionExpiresAt: string;
}
