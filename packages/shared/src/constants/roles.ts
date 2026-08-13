import { ACTIONS, ALL_PERMISSIONS, MODULES, permission, type PermissionCode } from './permissions';

/**
 * The 7 default roles (§25). These are *seed data*, not hard-coded law —
 * an Admin can edit any of their permission grids or create new roles entirely.
 * Only SUPER_ADMIN is protected from edit/delete so the system can never be
 * locked out of itself.
 */
export const ROLE = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  SALES: 'sales',
  VERIFICATION: 'verification',
  ACCOUNTS: 'accounts',
  OPERATIONS: 'operations',
  VIEWER: 'viewer',
} as const;

export type RoleCode = (typeof ROLE)[keyof typeof ROLE];

const p = permission;

/** Read-only across every module a Viewer is allowed to see (§25 "Read Only"). */
const VIEWER_PERMISSIONS: PermissionCode[] = [
  p(MODULES.DASHBOARD, ACTIONS.VIEW),
  p(MODULES.APPLICANTS, ACTIONS.VIEW),
  p(MODULES.RECORDS, ACTIONS.VIEW),
  p(MODULES.EVIDENCE, ACTIONS.VIEW),
  p(MODULES.CERTIFICATES, ACTIONS.VIEW),
  p(MODULES.PUBLICATIONS, ACTIONS.VIEW),
  p(MODULES.DISPATCH, ACTIONS.VIEW),
  p(MODULES.NOTES, ACTIONS.VIEW),
  p(MODULES.TASKS, ACTIONS.VIEW),
  p(MODULES.COMMUNICATIONS, ACTIONS.VIEW),
  p(MODULES.BLACKLIST, ACTIONS.VIEW),
  p(MODULES.NOTIFICATIONS, ACTIONS.VIEW),
];

/** Sales: applicant intake and follow-up (§25 "Applicant & Follow-up"). */
const SALES_PERMISSIONS: PermissionCode[] = [
  ...VIEWER_PERMISSIONS,
  p(MODULES.APPLICANTS, ACTIONS.CREATE),
  p(MODULES.APPLICANTS, ACTIONS.EDIT),
  p(MODULES.RECORDS, ACTIONS.CREATE),
  p(MODULES.RECORDS, ACTIONS.EDIT),
  p(MODULES.RECORDS, ACTIONS.CHANGE_STATUS),
  p(MODULES.EVIDENCE, ACTIONS.CREATE),
  p(MODULES.NOTES, ACTIONS.CREATE),
  p(MODULES.TASKS, ACTIONS.CREATE),
  p(MODULES.TASKS, ACTIONS.EDIT),
  p(MODULES.COMMUNICATIONS, ACTIONS.SEND),
  p(MODULES.TEMPLATES, ACTIONS.VIEW),
];

/** Verification team: review & selection (§25). */
const VERIFICATION_PERMISSIONS: PermissionCode[] = [
  ...VIEWER_PERMISSIONS,
  p(MODULES.VERIFICATION, ACTIONS.VIEW),
  p(MODULES.VERIFICATION, ACTIONS.EDIT),
  p(MODULES.VERIFICATION, ACTIONS.CHANGE_STATUS),
  p(MODULES.RECORDS, ACTIONS.EDIT),
  p(MODULES.RECORDS, ACTIONS.CHANGE_STATUS),
  p(MODULES.EVIDENCE, ACTIONS.CREATE),
  p(MODULES.EVIDENCE, ACTIONS.EDIT),
  p(MODULES.NOTES, ACTIONS.CREATE),
  p(MODULES.TASKS, ACTIONS.CREATE),
  p(MODULES.TASKS, ACTIONS.EDIT),
  p(MODULES.BLACKLIST, ACTIONS.CREATE),
  p(MODULES.COMMUNICATIONS, ACTIONS.SEND),
  p(MODULES.TEMPLATES, ACTIONS.VIEW),
  // ID proofs are needed to verify identity — hence reveal rights (§27 PII).
  p(MODULES.PII, ACTIONS.REVEAL),
];

/** Accounts: payments (§25). */
const ACCOUNTS_PERMISSIONS: PermissionCode[] = [
  ...VIEWER_PERMISSIONS,
  p(MODULES.PAYMENTS, ACTIONS.VIEW),
  p(MODULES.PAYMENTS, ACTIONS.CREATE),
  p(MODULES.PAYMENTS, ACTIONS.EDIT),
  p(MODULES.PAYMENTS, ACTIONS.EXPORT),
  p(MODULES.RECORDS, ACTIONS.CHANGE_STATUS),
  p(MODULES.NOTES, ACTIONS.CREATE),
  p(MODULES.TASKS, ACTIONS.CREATE),
  p(MODULES.TASKS, ACTIONS.EDIT),
  p(MODULES.COMMUNICATIONS, ACTIONS.SEND),
  p(MODULES.TEMPLATES, ACTIONS.VIEW),
  p(MODULES.REPORTS, ACTIONS.VIEW),
  p(MODULES.REPORTS, ACTIONS.EXPORT),
];

/** Operations: certificates, publications, dispatch (§25). */
const OPERATIONS_PERMISSIONS: PermissionCode[] = [
  ...VIEWER_PERMISSIONS,
  p(MODULES.CERTIFICATES, ACTIONS.CREATE),
  p(MODULES.CERTIFICATES, ACTIONS.EDIT),
  p(MODULES.CERTIFICATES, ACTIONS.EXPORT),
  p(MODULES.PUBLICATIONS, ACTIONS.CREATE),
  p(MODULES.PUBLICATIONS, ACTIONS.EDIT),
  p(MODULES.DISPATCH, ACTIONS.CREATE),
  p(MODULES.DISPATCH, ACTIONS.EDIT),
  p(MODULES.DISPATCH, ACTIONS.EXPORT),
  p(MODULES.RECORDS, ACTIONS.CHANGE_STATUS),
  // Operations handle the kit, the courier and the photographs, so they are the
  // team who learn that a parcel arrived or a photo came in by WhatsApp — the
  // events the system cannot see for itself.
  p(MODULES.RECORDS, ACTIONS.MARK_PROGRESS),
  p(MODULES.EVIDENCE, ACTIONS.CREATE),
  p(MODULES.NOTES, ACTIONS.CREATE),
  p(MODULES.TASKS, ACTIONS.CREATE),
  p(MODULES.TASKS, ACTIONS.EDIT),
  p(MODULES.COMMUNICATIONS, ACTIONS.SEND),
  p(MODULES.TEMPLATES, ACTIONS.VIEW),
];

/**
 * Admin: full operational access. Everything except the platform-level
 * capabilities reserved for Super Admin (role editing, integrations, and
 * deleting users) — matching §25 "Operational Access".
 */
const ADMIN_EXCLUDED: PermissionCode[] = [
  p(MODULES.ROLES, ACTIONS.CREATE),
  p(MODULES.ROLES, ACTIONS.EDIT),
  p(MODULES.ROLES, ACTIONS.DELETE),
  p(MODULES.USERS, ACTIONS.DELETE),
  p(MODULES.INTEGRATIONS, ACTIONS.MANAGE),
];

const ADMIN_PERMISSIONS: PermissionCode[] = ALL_PERMISSIONS.filter(
  (code) => !ADMIN_EXCLUDED.includes(code),
);

export interface RoleSeed {
  readonly code: RoleCode;
  readonly name: string;
  readonly description: string;
  /** `null` means "all permissions, always" — reserved for Super Admin. */
  readonly permissions: readonly PermissionCode[] | null;
  /** System roles cannot be deleted; Super Admin also cannot be edited. */
  readonly isSystem: boolean;
  readonly isProtected: boolean;
}

export const DEFAULT_ROLES: readonly RoleSeed[] = [
  {
    code: ROLE.SUPER_ADMIN,
    name: 'Super Admin',
    description: 'Full access to every module, including roles, integrations and privacy console.',
    permissions: null,
    isSystem: true,
    isProtected: true,
  },
  {
    code: ROLE.ADMIN,
    name: 'Admin',
    description: 'Operational access across all modules; cannot edit roles or integrations.',
    permissions: ADMIN_PERMISSIONS,
    isSystem: true,
    isProtected: false,
  },
  {
    code: ROLE.SALES,
    name: 'Sales',
    description: 'Applicant intake, follow-ups and communication.',
    permissions: SALES_PERMISSIONS,
    isSystem: true,
    isProtected: false,
  },
  {
    code: ROLE.VERIFICATION,
    name: 'Verification',
    description: 'Document review, verification remarks and selection decisions.',
    permissions: VERIFICATION_PERMISSIONS,
    isSystem: true,
    isProtected: false,
  },
  {
    code: ROLE.ACCOUNTS,
    name: 'Accounts',
    description: 'Payments, invoices, receipts and revenue reporting.',
    permissions: ACCOUNTS_PERMISSIONS,
    isSystem: true,
    isProtected: false,
  },
  {
    code: ROLE.OPERATIONS,
    name: 'Operations',
    description: 'Certificates, publications and dispatch.',
    permissions: OPERATIONS_PERMISSIONS,
    isSystem: true,
    isProtected: false,
  },
  {
    code: ROLE.VIEWER,
    name: 'Viewer',
    description: 'Read-only access. Cannot see payments, revenue or audit logs.',
    permissions: VIEWER_PERMISSIONS,
    isSystem: true,
    isProtected: false,
  },
];
