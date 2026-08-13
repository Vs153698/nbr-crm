/**
 * Configurable RBAC (§1, §25 + P1-04).
 *
 * Roles and their permissions live in the database — an Admin can create new
 * roles and toggle any cell of the module × action grid from the Users & Roles
 * screen without a deploy. What is compiled in here is the *vocabulary*: the
 * list of modules and the actions each module supports. Guards resolve a user's
 * effective permission set from the DB and check it against these codes, so a
 * hidden UI button is never the only guard.
 *
 * Permission code format: `<module>:<action>` e.g. `payments:export`.
 */

export const MODULES = {
  DASHBOARD: 'dashboard',
  APPLICANTS: 'applicants',
  RECORDS: 'records',
  EVIDENCE: 'evidence',
  VERIFICATION: 'verification',
  PAYMENTS: 'payments',
  CERTIFICATES: 'certificates',
  PUBLICATIONS: 'publications',
  DISPATCH: 'dispatch',
  TASKS: 'tasks',
  NOTES: 'notes',
  COMMUNICATIONS: 'communications',
  TEMPLATES: 'templates',
  BLACKLIST: 'blacklist',
  REPORTS: 'reports',
  NOTIFICATIONS: 'notifications',
  USERS: 'users',
  ROLES: 'roles',
  SETTINGS: 'settings',
  AUDIT: 'audit',
  INTEGRATIONS: 'integrations',
  /** Outbound sales: leads, call logs, follow-ups, the sales dashboard. */
  LEADS: 'leads',
  /** Staff directory. Separate from `users`, which governs login accounts. */
  EMPLOYEES: 'employees',
  /** DPDP Act, 2023 console: consent ledger, data-principal requests, breaches. */
  PRIVACY: 'privacy',
  /** Reading unmasked Aadhaar / passport numbers is its own gated capability. */
  PII: 'pii',
} as const;

export type ModuleName = (typeof MODULES)[keyof typeof MODULES];

export const ACTIONS = {
  VIEW: 'view',
  CREATE: 'create',
  EDIT: 'edit',
  DELETE: 'delete',
  EXPORT: 'export',
  CHANGE_STATUS: 'change_status',
  SEND: 'send',
  /** Bypass a hard block (blacklist duplicate guard, workflow lock). */
  OVERRIDE: 'override',
  /**
   * Record a client-progress stage by hand.
   *
   * Its own action rather than folded into `edit`, because it is a different
   * kind of trust: everything else on the progress badge is derived from what
   * the system watched happen, and this is the one way a person can assert a
   * milestone the system never saw. Whoever holds it can put a date against a
   * claim the client will be shown, so it should be grantable — and revocable —
   * without touching their ability to edit a record at all.
   */
  MARK_PROGRESS: 'mark_progress',
  /** Administer the module itself (settings of settings). */
  MANAGE: 'manage',
  /** Read decrypted sensitive identifiers. */
  REVEAL: 'reveal',
} as const;

export type ActionName = (typeof ACTIONS)[keyof typeof ACTIONS];

/** Which actions are meaningful for each module — drives the Users & Roles grid. */
export const MODULE_ACTIONS: Readonly<Record<ModuleName, readonly ActionName[]>> = {
  [MODULES.DASHBOARD]: [ACTIONS.VIEW],
  [MODULES.APPLICANTS]: [
    ACTIONS.VIEW,
    ACTIONS.CREATE,
    ACTIONS.EDIT,
    ACTIONS.EXPORT,
    ACTIONS.DELETE,
  ],
  [MODULES.RECORDS]: [
    ACTIONS.VIEW,
    ACTIONS.CREATE,
    ACTIONS.EDIT,
    ACTIONS.CHANGE_STATUS,
    ACTIONS.MARK_PROGRESS,
    ACTIONS.EXPORT,
    ACTIONS.OVERRIDE,
  ],
  /**
   * `delete` covers general attachments only.
   *
   * Evidence files are permanent by database trigger and no permission can
   * reach them — this grants the removal of a miscellaneous attachment
   * (a superseded correction letter, a file uploaded to the wrong profile),
   * which is withdrawn rather than destroyed.
   */
  [MODULES.EVIDENCE]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT, ACTIONS.DELETE],
  [MODULES.VERIFICATION]: [ACTIONS.VIEW, ACTIONS.EDIT, ACTIONS.CHANGE_STATUS],
  [MODULES.PAYMENTS]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT, ACTIONS.EXPORT],
  [MODULES.CERTIFICATES]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT, ACTIONS.EXPORT],
  [MODULES.PUBLICATIONS]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT],
  [MODULES.DISPATCH]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT, ACTIONS.EXPORT],
  [MODULES.TASKS]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT],
  [MODULES.NOTES]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT],
  [MODULES.COMMUNICATIONS]: [ACTIONS.VIEW, ACTIONS.SEND],
  [MODULES.TEMPLATES]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT, ACTIONS.DELETE],
  [MODULES.BLACKLIST]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT, ACTIONS.OVERRIDE],
  [MODULES.REPORTS]: [ACTIONS.VIEW, ACTIONS.EXPORT],
  [MODULES.NOTIFICATIONS]: [ACTIONS.VIEW, ACTIONS.MANAGE],
  [MODULES.USERS]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT, ACTIONS.DELETE],
  [MODULES.ROLES]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT, ACTIONS.DELETE],
  [MODULES.SETTINGS]: [ACTIONS.VIEW, ACTIONS.MANAGE],
  [MODULES.AUDIT]: [ACTIONS.VIEW, ACTIONS.EXPORT],
  [MODULES.INTEGRATIONS]: [ACTIONS.VIEW, ACTIONS.MANAGE],
  [MODULES.LEADS]: [
    ACTIONS.VIEW,
    ACTIONS.CREATE,
    ACTIONS.EDIT,
    ACTIONS.DELETE,
    ACTIONS.EXPORT,
    // Turning a lead into an applicant is a heavier act than editing one, and
    // some teams let anyone call but only seniors convert.
    ACTIONS.CHANGE_STATUS,
  ],
  [MODULES.EMPLOYEES]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT, ACTIONS.DELETE, ACTIONS.EXPORT],
  [MODULES.PRIVACY]: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.EDIT, ACTIONS.EXPORT],
  [MODULES.PII]: [ACTIONS.REVEAL],
};

export type PermissionCode = `${ModuleName}:${ActionName}`;

export function permission(module: ModuleName, action: ActionName): PermissionCode {
  return `${module}:${action}`;
}

/** Every permission code the system understands. Seeded into `permissions`. */
export const ALL_PERMISSIONS: readonly PermissionCode[] = Object.entries(MODULE_ACTIONS).flatMap(
  ([module, actions]) => actions.map((action) => `${module}:${action}` as PermissionCode),
);

/** Human labels for the Users & Roles permission grid. */
export const MODULE_LABELS: Readonly<Record<ModuleName, string>> = {
  [MODULES.DASHBOARD]: 'Dashboard',
  [MODULES.APPLICANTS]: 'Applicants',
  [MODULES.RECORDS]: 'Applications & Records',
  [MODULES.EVIDENCE]: 'Evidence Vault',
  [MODULES.VERIFICATION]: 'Verification',
  [MODULES.PAYMENTS]: 'Payments',
  [MODULES.CERTIFICATES]: 'Certificates',
  [MODULES.PUBLICATIONS]: 'Publications',
  [MODULES.DISPATCH]: 'Dispatch',
  [MODULES.TASKS]: 'Tasks & Follow-ups',
  [MODULES.NOTES]: 'Internal Notes',
  [MODULES.COMMUNICATIONS]: 'Communication',
  [MODULES.TEMPLATES]: 'Templates',
  [MODULES.BLACKLIST]: 'Blacklist & Restrictions',
  [MODULES.REPORTS]: 'Reports',
  [MODULES.NOTIFICATIONS]: 'Notifications',
  [MODULES.USERS]: 'Users',
  [MODULES.ROLES]: 'Roles & Permissions',
  [MODULES.SETTINGS]: 'Settings',
  [MODULES.AUDIT]: 'Audit Logs',
  [MODULES.INTEGRATIONS]: 'Integrations',
  [MODULES.LEADS]: 'Sales & Leads',
  [MODULES.EMPLOYEES]: 'Employee Directory',
  [MODULES.PRIVACY]: 'Privacy & DPDP',
  [MODULES.PII]: 'Sensitive Identifiers',
};

export const ACTION_LABELS: Readonly<Record<ActionName, string>> = {
  [ACTIONS.VIEW]: 'View',
  [ACTIONS.CREATE]: 'Create',
  [ACTIONS.EDIT]: 'Edit',
  [ACTIONS.DELETE]: 'Delete',
  [ACTIONS.EXPORT]: 'Export',
  [ACTIONS.CHANGE_STATUS]: 'Change status',
  [ACTIONS.SEND]: 'Send',
  [ACTIONS.OVERRIDE]: 'Override',
  [ACTIONS.MARK_PROGRESS]: 'Mark progress by hand',
  [ACTIONS.MANAGE]: 'Manage',
  [ACTIONS.REVEAL]: 'Reveal',
};
