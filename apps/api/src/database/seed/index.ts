import 'dotenv/config';
import * as argon2 from 'argon2';
import { eq, sql } from 'drizzle-orm';
import {
  ACTIONS,
  ALL_PERMISSIONS,
  CONSENT_NOTICE_VERSION,
  DATA_CLASS,
  DEFAULT_CATEGORIES,
  DEFAULT_COURIERS,
  DEFAULT_PACKAGES,
  DEFAULT_ROLES,
  DEFAULT_TEMPLATES,
  MODULES,
  ORDERED_STATUSES,
  PURPOSE_META,
  ROLE,
  STATUS_TRANSITIONS,
  type PermissionCode,
} from '@nbr/shared';
import { loadEnv } from '../../config/env';
import { createDatabase, createPool } from '../client';
import type { Database } from '../client';
import * as schema from '../schema';

/**
 * Idempotent seed (P1-02).
 *
 * Safe to run repeatedly: every insert is an upsert keyed on a natural unique
 * column. That matters because this runs on every deploy to pick up newly
 * added permissions and statuses, and re-running it must never duplicate a role
 * or reset an Admin's customised permission grid.
 */

const log = (message: string) => process.stdout.write(`  ${message}\n`);

async function seedPermissions(db: Database): Promise<Map<PermissionCode, string>> {
  const rows = ALL_PERMISSIONS.map((code) => {
    const [module = '', action = ''] = code.split(':');
    return { code, module, action, description: `${action} on ${module}` };
  });

  await db
    .insert(schema.permissions)
    .values(rows)
    .onConflictDoUpdate({
      target: schema.permissions.code,
      set: { module: sql`excluded.module`, action: sql`excluded.action` },
    });

  const stored = await db.select().from(schema.permissions);
  log(`permissions: ${stored.length}`);
  return new Map(stored.map((p) => [p.code as PermissionCode, p.id]));
}

async function seedRoles(
  db: Database,
  permissionIds: Map<PermissionCode, string>,
): Promise<Map<string, string>> {
  const roleIds = new Map<string, string>();

  for (const role of DEFAULT_ROLES) {
    const [inserted] = await db
      .insert(schema.roles)
      .values({
        code: role.code,
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
        isProtected: role.isProtected,
        isSuperAdmin: role.code === ROLE.SUPER_ADMIN,
      })
      .onConflictDoUpdate({
        target: schema.roles.code,
        // Only the descriptive fields are refreshed. Deliberately NOT the
        // permission grid — an Admin who tightened a role must not have their
        // change silently reverted by the next deploy.
        set: { name: role.name, description: role.description },
      })
      .returning({ id: schema.roles.id });

    const roleId = inserted!.id;
    roleIds.set(role.code, roleId);

    // Super Admin holds every permission implicitly; no rows needed.
    if (role.permissions === null) continue;

    const existing = await db
      .select({ id: schema.rolePermissions.id })
      .from(schema.rolePermissions)
      .where(eq(schema.rolePermissions.roleId, roleId))
      .limit(1);

    // First-run only. Re-seeding never overwrites a customised grid.
    if (existing.length > 0) continue;

    const grants = role.permissions
      .map((code) => permissionIds.get(code))
      .filter((id): id is string => Boolean(id))
      .map((permissionId) => ({ roleId, permissionId }));

    if (grants.length > 0) {
      await db.insert(schema.rolePermissions).values(grants).onConflictDoNothing();
    }
  }

  log(`roles: ${roleIds.size}`);
  return roleIds;
}

async function seedSuperAdmin(db: Database, roleIds: Map<string, string>): Promise<void> {
  const env = loadEnv();
  const superAdminRoleId = roleIds.get(ROLE.SUPER_ADMIN);
  if (!superAdminRoleId) throw new Error('Super Admin role missing — seed roles first');

  const existing = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, env.SUPER_ADMIN_EMAIL))
    .limit(1);

  if (existing.length > 0) {
    log('super admin: already provisioned (password left untouched)');
    return;
  }

  // OWASP-recommended argon2id parameters: 19 MiB memory, 2 iterations.
  const passwordHash = await argon2.hash(env.SUPER_ADMIN_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  await db.insert(schema.users).values({
    fullName: env.SUPER_ADMIN_NAME,
    email: env.SUPER_ADMIN_EMAIL,
    employeeCode: 'NBR-ADMIN',
    passwordHash,
    roleId: superAdminRoleId,
    status: 'active',
    // The env password is a bootstrap credential and is assumed compromised
    // the moment it is typed into a terminal.
    mustChangePassword: true,
  });

  log(`super admin: created (${env.SUPER_ADMIN_EMAIL}) — password change forced on first login`);
}

async function seedStatuses(db: Database): Promise<void> {
  await db
    .insert(schema.statuses)
    .values(
      ORDERED_STATUSES.map((s) => ({
        code: s.code,
        label: s.label,
        tone: s.tone,
        stage: s.stage,
        sortOrder: s.order,
        isTerminal: s.terminal,
      })),
    )
    .onConflictDoUpdate({
      target: schema.statuses.code,
      set: {
        tone: sql`excluded.tone`,
        stage: sql`excluded.stage`,
        sortOrder: sql`excluded.sort_order`,
        isTerminal: sql`excluded.is_terminal`,
      },
    });

  const transitions = Object.entries(STATUS_TRANSITIONS).flatMap(([from, list]) =>
    list.map((t) => ({
      fromStatus: from,
      toStatus: t.to,
      label: t.label,
      requiredPermission: t.permission,
      guards: [...(t.guards ?? [])],
      requiresRemark: t.requiresRemark ?? false,
      requiresOverride: t.requiresOverride ?? false,
    })),
  );

  await db
    .insert(schema.statusTransitions)
    .values(transitions)
    .onConflictDoUpdate({
      target: [schema.statusTransitions.fromStatus, schema.statusTransitions.toStatus],
      set: {
        label: sql`excluded.label`,
        requiredPermission: sql`excluded.required_permission`,
        guards: sql`excluded.guards`,
        requiresRemark: sql`excluded.requires_remark`,
        requiresOverride: sql`excluded.requires_override`,
      },
    });

  log(`statuses: ${ORDERED_STATUSES.length}, transitions: ${transitions.length}`);
}

async function seedCatalog(db: Database): Promise<void> {
  const slugify = (name: string) =>
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

  await db
    .insert(schema.categories)
    .values(
      DEFAULT_CATEGORIES.map((name, index) => ({
        name,
        slug: slugify(name),
        sortOrder: index * 10,
      })),
    )
    .onConflictDoNothing({ target: schema.categories.slug });

  await db
    .insert(schema.packages)
    .values(
      DEFAULT_PACKAGES.map((p, index) => ({
        name: p.name,
        description: p.description,
        amount: p.amount,
        gstPercent: p.gstPercent,
        sortOrder: index * 10,
      })),
    )
    .onConflictDoNothing({ target: schema.packages.name });

  const trackingTemplates: Record<string, string> = {
    Delhivery: 'https://www.delhivery.com/tracking?waybill={tracking_no}',
    'Blue Dart': 'https://www.bluedart.com/tracking?awb={tracking_no}',
    DTDC: 'https://www.dtdc.in/tracking?awb={tracking_no}',
    'India Post (Speed Post)': 'https://www.indiapost.gov.in/track?article={tracking_no}',
  };

  await db
    .insert(schema.couriers)
    .values(
      DEFAULT_COURIERS.map((name, index) => ({
        name,
        trackingUrlTemplate: trackingTemplates[name] ?? null,
        sortOrder: index * 10,
      })),
    )
    .onConflictDoNothing({ target: schema.couriers.name });

  await db
    .insert(schema.templates)
    .values(
      DEFAULT_TEMPLATES.map((t) => ({
        code: t.code,
        channel: t.channel,
        name: t.name,
        subject: t.subject,
        body: t.body,
      })),
    )
    // Templates are Admin-editable content; never overwrite a reworded one.
    .onConflictDoNothing({ target: [schema.templates.code, schema.templates.channel] });

  log(
    `catalog: ${DEFAULT_CATEGORIES.length} categories, ${DEFAULT_PACKAGES.length} packages, ` +
      `${DEFAULT_COURIERS.length} couriers, ${DEFAULT_TEMPLATES.length} templates`,
  );
}

async function seedSettings(db: Database): Promise<void> {
  const env = loadEnv();

  const defaults: Array<{
    key: string;
    value: unknown;
    category: string;
    label: string;
    description?: string;
    isEditable?: boolean;
  }> = [
    {
      key: 'session.idle_timeout_minutes',
      value: env.SESSION_IDLE_TIMEOUT_MINUTES,
      category: 'security',
      label: 'Session idle timeout (minutes)',
      description: 'Users are signed out after this much inactivity (§1).',
    },
    {
      key: 'security.login_max_attempts',
      value: env.LOGIN_MAX_ATTEMPTS,
      category: 'security',
      label: 'Failed login attempts before lockout',
    },
    {
      key: 'security.lockout_minutes',
      value: env.LOGIN_LOCKOUT_MINUTES,
      category: 'security',
      label: 'Lockout duration (minutes)',
    },
    {
      key: 'notifications.payment_reminder_days',
      value: [7, 3, 1],
      category: 'notifications',
      label: 'Payment reminder schedule',
      description: 'Days before the due date on which a reminder is raised.',
    },
    {
      key: 'notifications.review_sla_hours',
      value: 48,
      category: 'notifications',
      label: 'Review SLA (hours)',
      description: 'Applications under review longer than this are flagged overdue.',
    },
    {
      key: 'notifications.certificate_sla_days',
      value: 7,
      category: 'notifications',
      label: 'Certificate preparation SLA (days)',
    },
    {
      key: 'notifications.dispatch_sla_days',
      value: 5,
      category: 'notifications',
      label: 'Dispatch SLA (days)',
    },
    {
      key: 'payments.default_due_days',
      value: 15,
      category: 'payments',
      label: 'Default payment due window (days)',
    },
    {
      key: 'payments.default_gst_percent',
      value: '18.00',
      category: 'payments',
      label: 'Default GST percentage',
    },
    {
      key: 'organisation.name',
      value: env.DPDP_DATA_FIDUCIARY_NAME,
      category: 'general',
      label: 'Organisation name',
    },
    {
      key: 'organisation.support_email',
      value: env.MAIL_FROM_ADDRESS,
      category: 'general',
      label: 'Support email',
    },
    {
      key: 'organisation.support_phone',
      value: env.DPDP_GRIEVANCE_OFFICER_PHONE ?? '',
      category: 'general',
      label: 'Support phone',
    },
    // ── DPDP ────────────────────────────────────────────────────────────────
    {
      key: 'dpdp.grievance_officer_name',
      value: env.DPDP_GRIEVANCE_OFFICER_NAME,
      category: 'privacy',
      label: 'Grievance Officer name',
      description: 'Published on the consent notice (DPDP §13).',
    },
    {
      key: 'dpdp.grievance_officer_email',
      value: env.DPDP_GRIEVANCE_OFFICER_EMAIL,
      category: 'privacy',
      label: 'Grievance Officer email',
    },
    {
      key: 'dpdp.dsr_response_days',
      value: env.DPDP_DSR_RESPONSE_DAYS,
      category: 'privacy',
      label: 'Data-principal request response window (days)',
    },
    {
      key: 'dpdp.breach_notify_hours',
      value: env.DPDP_BREACH_NOTIFY_HOURS,
      category: 'privacy',
      label: 'Breach notification window (hours)',
      description: 'Time from detection to notifying the Board (DPDP §8(5)).',
      isEditable: false,
    },
    {
      key: 'dpdp.consent_notice_version',
      value: CONSENT_NOTICE_VERSION,
      category: 'privacy',
      label: 'Active consent notice version',
      isEditable: false,
    },
    // ── Legacy website connector ────────────────────────────────────────────
    // The return leg of the mirror. Inbound webhooks need no configuration
    // here (the sender holds the URL); these three describe how to push a
    // CRM-side change back to the public site's admin system.
    {
      key: 'integrations.legacy.enabled',
      value: false,
      category: 'integrations',
      label: 'Push changes back to the NBR website',
      description:
        'When on, payments, certificates and dispatch updates recorded here are sent to the public site so both systems agree. Records created only in the CRM are never pushed.',
    },
    {
      key: 'integrations.legacy.base_url',
      value: '',
      category: 'integrations',
      label: 'NBR website API base URL',
      description: 'For example https://api.nationalbookofrecords.org — no trailing slash.',
    },
    {
      key: 'integrations.legacy.secret',
      value: '',
      category: 'integrations',
      label: 'Shared secret',
      description:
        'The same secret configured on the website. Signs every request in both directions.',
    },
    // ── SMTP ────────────────────────────────────────────────────────────────
    // Empty means "use the values the process booted with". Filling these in
    // overrides the environment without a redeploy, which is what an operator
    // needs when a mail provider changes on a Friday afternoon.
    {
      key: 'mail.smtp_host',
      value: '',
      category: 'mail',
      label: 'SMTP host',
      description: 'Leave blank to keep using the host from the server environment.',
    },
    { key: 'mail.smtp_port', value: '', category: 'mail', label: 'SMTP port' },
    { key: 'mail.smtp_secure', value: '', category: 'mail', label: 'Use TLS on connect (465)' },
    { key: 'mail.smtp_user', value: '', category: 'mail', label: 'SMTP username' },
    { key: 'mail.smtp_password', value: '', category: 'mail', label: 'SMTP password' },
    { key: 'mail.from_name', value: '', category: 'mail', label: 'From name' },
    { key: 'mail.from_address', value: '', category: 'mail', label: 'From address' },
  ];

  await db
    .insert(schema.settings)
    .values(
      defaults.map((s) => ({
        key: s.key,
        value: s.value as never,
        category: s.category,
        label: s.label,
        description: s.description ?? null,
        isEditable: s.isEditable ?? true,
      })),
    )
    // Settings are operator-owned once set — only newly introduced keys land.
    .onConflictDoNothing({ target: schema.settings.key });

  log(`settings: ${defaults.length} keys`);
}

async function seedPrivacy(db: Database): Promise<void> {
  const env = loadEnv();

  // ── §5 consent notice ────────────────────────────────────────────────────
  const purposeLines = Object.values(PURPOSE_META)
    .map((p) => `• ${p.label} — ${p.notice}${p.essential ? '' : ' (optional)'}`)
    .join('\n');

  const noticeBody = [
    `${env.DPDP_DATA_FIDUCIARY_NAME} ("we") collects and processes your personal data as the Data Fiduciary under the Digital Personal Data Protection Act, 2023.`,
    '',
    'WHAT WE COLLECT AND WHY',
    purposeLines,
    '',
    'YOUR RIGHTS',
    '• Access — ask for a summary of the personal data we hold about you and how we process it (§11).',
    '• Correction — have inaccurate or incomplete data corrected, completed or updated (§12).',
    '• Erasure — ask us to erase your personal data where we no longer need it for the purpose you consented to (§12).',
    '• Nomination — nominate another individual to exercise these rights if you die or become incapacitated (§14).',
    '• Grievance redressal — complain to our Grievance Officer, and to the Data Protection Board if unsatisfied (§13).',
    '• Withdraw consent — at any time, as easily as you gave it. Withdrawing consent for an optional purpose does not affect your record (§6(4)).',
    '',
    'HOW LONG WE KEEP IT',
    `We retain your record and certificate history for ${env.DPDP_RETENTION_YEARS} years after your record is completed, because a National Book of Records entry is a permanent public claim we may be asked to verify. Personal data we no longer need for any stated purpose is erased (§8(7)).`,
    '',
    'GRIEVANCE OFFICER',
    `${env.DPDP_GRIEVANCE_OFFICER_NAME} — ${env.DPDP_GRIEVANCE_OFFICER_EMAIL}`,
    `We will respond to any request or grievance within ${env.DPDP_DSR_RESPONSE_DAYS} days.`,
  ].join('\n');

  await db
    .insert(schema.consentNotices)
    .values({
      version: CONSENT_NOTICE_VERSION,
      language: 'en',
      title: `${env.DPDP_DATA_FIDUCIARY_NAME} — Notice to Data Principals (DPDP Act, 2023)`,
      body: noticeBody,
      purposes: Object.keys(PURPOSE_META),
    })
    .onConflictDoNothing({
      target: [schema.consentNotices.version, schema.consentNotices.language],
    });

  // ── §8(7) retention policies ─────────────────────────────────────────────
  const retentionYears = env.DPDP_RETENTION_YEARS;
  const policies = [
    {
      dataCategory: DATA_CLASS.IDENTIFIER,
      description:
        'Aadhaar, passport and PAN numbers. Needed only to verify identity at selection; erased once the record is completed and the verification window closes.',
      retainMonths: 24,
      triggerEvent: 'record_completed',
      legalBasis: null,
      // Identifiers are the highest-risk data we hold and have the shortest
      // useful life, so this is the one category erased without asking.
      autoErase: true,
    },
    {
      dataCategory: DATA_CLASS.CONTACT,
      description:
        'Mobile, WhatsApp, email and postal address. Kept while we may need to reach the record holder about their entry.',
      retainMonths: retentionYears * 12,
      triggerEvent: 'record_completed',
      legalBasis: null,
      autoErase: false,
    },
    {
      dataCategory: DATA_CLASS.PERSONAL,
      description:
        'Name, city, record title and achievement details. A record entry is a permanent published claim; the name and achievement remain part of the public record.',
      retainMonths: retentionYears * 12,
      triggerEvent: 'record_completed',
      legalBasis:
        'Retained to substantiate a published record claim and defend against challenges to it.',
      autoErase: false,
    },
    {
      dataCategory: DATA_CLASS.FINANCIAL,
      description: 'Invoices, payment transactions and GST records.',
      // Income-tax and GST record-keeping obligations run well past our own
      // operational need, so financial rows survive an erasure request.
      retainMonths: 96,
      triggerEvent: 'record_completed',
      legalBasis:
        'Retained to meet record-keeping obligations under Indian income-tax and GST law. Erasure requests are honoured for all other categories (DPDP §8(7) permits retention required by law).',
      autoErase: false,
    },
    {
      dataCategory: DATA_CLASS.CHILD,
      description:
        'Personal data of applicants who were under 18 at intake, plus guardian contact details (DPDP §9).',
      retainMonths: retentionYears * 12,
      triggerEvent: 'record_completed',
      legalBasis: null,
      autoErase: false,
    },
    {
      dataCategory: DATA_CLASS.INTERNAL,
      description: 'Internal notes, tasks and workflow metadata carrying no personal identifiers.',
      retainMonths: retentionYears * 12,
      triggerEvent: 'record_closed',
      legalBasis: null,
      autoErase: false,
    },
  ];

  await db
    .insert(schema.retentionPolicies)
    .values(policies)
    .onConflictDoNothing({ target: schema.retentionPolicies.dataCategory });

  log(`privacy: consent notice v${CONSENT_NOTICE_VERSION}, ${policies.length} retention policies`);
}

async function main(): Promise<void> {
  const sqlClient = createPool();
  const db = createDatabase(sqlClient);

  process.stdout.write('▶ Seeding NBR CRM…\n');
  const started = Date.now();

  try {
    const permissionIds = await seedPermissions(db);
    const roleIds = await seedRoles(db, permissionIds);
    await seedSuperAdmin(db, roleIds);
    await seedStatuses(db);
    await seedCatalog(db);
    await seedSettings(db);
    await seedPrivacy(db);

    process.stdout.write(`✓ Seed complete in ${Date.now() - started}ms\n`);
  } finally {
    await sqlClient.end({ timeout: 5 });
  }
}

// `MODULES` and `ACTIONS` are re-exported for the permission-matrix tests, which
// assert that every seeded permission maps to a known module/action pair.
export { MODULES, ACTIONS };

main().catch((error: unknown) => {
  process.stderr.write('✗ Seed failed\n');
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
