/**
 * Document-level prose for the API reference.
 *
 * Kept apart from the builder because this is editorial content — the things a
 * new integrator needs to know before they read a single endpoint.
 */
export const OPENAPI_INFO = {
  title: 'NBR Backend CRM API',
  version: '1.0.0',
  description: [
    'Internal API for the National Book of Records CRM: applicant intake, verification,',
    'payments, certificates, publication, dispatch, communication and reporting.',
    '',
    '## Response envelope',
    '',
    'Every response — success or failure — uses the same envelope, so a client has exactly',
    'one shape to unwrap:',
    '',
    '```json',
    '{ "success": true,  "data": { }, "error": null, "meta": { "requestId": "…" } }',
    '{ "success": false, "data": null, "error": { "code": "NOT_FOUND", "message": "…" } }',
    '```',
    '',
    'Branch on `error.code`, never on `error.message`. Codes are a contract; messages get',
    'reworded. Every error carries a `requestId` that also appears in the server logs and',
    'the audit trail.',
    '',
    '## Authentication',
    '',
    '`POST /auth/login` sets two cookies: `nbr_access` (HttpOnly, short-lived) and',
    '`nbr_refresh` (HttpOnly, rotated on every use, with reuse detection — presenting an',
    'already-spent refresh token revokes the whole session family). There is no bearer',
    'token: an access token that JavaScript can read is an access token XSS can steal.',
    '',
    'The guard is global and fails closed. A route with no explicit `@Public()` is',
    'private, so a new endpoint cannot ship publicly by omission.',
    '',
    '## CSRF',
    '',
    'Because the session travels in a cookie, every state-changing request must also echo',
    'the double-submit token: read the non-HttpOnly `nbr_csrf` cookie and send it as the',
    '`x-csrf-token` header. Safe verbs do not need it.',
    '',
    '## Money',
    '',
    'Amounts are integer **paise**, never floats — `918040`, not `9180.40`. The same',
    'calculation module runs in the browser and on the server, so the figure an operator',
    'previews is byte-identically the figure that is stored, and database CHECK constraints',
    'make an inconsistent total unstorable.',
    '',
    '## Pagination',
    '',
    'List endpoints use **keyset** (cursor) pagination, not offsets: pass the previous',
    "response's `meta.nextCursor` as `cursor`. Offset pagination degrades on large tables",
    'and can skip or repeat rows when data changes between pages.',
    '',
    '## Personal data (DPDP Act, 2023)',
    '',
    'Aadhaar, passport and PAN numbers are encrypted at rest with AES-256-GCM and returned',
    '**masked** by default. Revealing one requires the `pii:reveal` permission,',
    'a stated reason, and is written to a dedicated access log — see',
    '`POST /applicants/{id}/reveal-identifier`. Exported files contain personal data and',
    'therefore expire 24 hours after generation.',
    '',
    '## Rate limits',
    '',
    'A global per-minute ceiling applies to every route, keyed by session where the caller',
    'is known and by IP otherwise. The sign-in path has much tighter, account-aware limits',
    'on top: five failed attempts lock the account for fifteen minutes.',
  ].join('\n'),
  contact: {
    name: 'NBR platform team',
    email: 'tech@nationalbookofrecords.in',
  },
} as const;

export const TAG_GROUPS = [
  { name: 'Health', description: 'Liveness and readiness probes. Unversioned and public.' },
  { name: 'Auth', description: 'Sign-in, session refresh, password reset and rotation.' },
  { name: 'Dashboard', description: 'Aggregate statistics, queues and global search.' },
  { name: 'Applicants', description: 'Master applicant profiles, duplicate detection, PII reveal.' },
  { name: 'Records', description: 'Applications hanging off an applicant, and the status workflow.' },
  { name: 'Queues', description: 'Operational work lists: verification, payments, publications.' },
  { name: 'Evidence & files', description: 'Presigned uploads, evidence vault and attachments.' },
  { name: 'Payments', description: 'Payment plans, transactions, reversals and invoices.' },
  { name: 'Certificates', description: 'Certificate issue, immutable version history and downloads.' },
  { name: 'Publications', description: 'Book, website and social-media publication entries.' },
  { name: 'Dispatch', description: 'Courier dispatch, tracking and proof of delivery.' },
  { name: 'Tasks', description: 'Follow-up tasks and reminders.' },
  { name: 'Communication', description: 'Templated email, WhatsApp click-to-chat and call notes.' },
  { name: 'Templates', description: 'Message templates and their placeholder vocabulary.' },
  { name: 'Blacklist', description: 'Blacklist register and behavioural restriction flags.' },
  { name: 'Notifications', description: 'In-app alerts and the unread badge.' },
  { name: 'Reports', description: 'Operational and financial reports, and background exports.' },
  { name: 'Notes', description: 'Internal notes with full revision history.' },
  {
    name: 'Sales',
    description:
      'Outbound leads, call logging, follow-ups, the sales dashboard and the end-of-day report.',
  },
  { name: 'Administration', description: 'Users, roles, permissions and system settings.' },
  { name: 'Audit', description: 'Append-only audit trail and PII access log.' },
  { name: 'Integration', description: 'Inbound webhook from the existing NBR website.' },
  { name: 'Reference data', description: 'Categories, packages, couriers, statuses.' },
] as const;

export type TagName = (typeof TAG_GROUPS)[number]['name'];

const errorRef = { $ref: '#/components/schemas/ErrorEnvelope' };

function error(description: string, code: string, message: string) {
  return {
    description,
    content: {
      'application/json': {
        schema: errorRef,
        example: {
          success: false,
          data: null,
          error: { code, message, requestId: '9f1c…' },
        },
      },
    },
  };
}

export const ERROR_RESPONSES = {
  unauthorised: error(
    'No session, or the access token has expired. Call `POST /auth/refresh`, then retry.',
    'UNAUTHORISED',
    'Please sign in to continue',
  ),
  forbidden: error(
    'Signed in, but the role lacks the required permission.',
    'FORBIDDEN',
    'You do not have permission to do this',
  ),
  forbiddenOrCsrf: error(
    'The role lacks the required permission, the CSRF token is missing or does not match, ' +
      'or the user must set a new password before continuing.',
    'FORBIDDEN',
    'You do not have permission to do this',
  ),
  notFound: error('No such resource, or it has been soft-deleted.', 'NOT_FOUND', 'Record not found'),
  validation: {
    description: 'The payload failed schema validation. `error.fields` lists the offending fields.',
    content: {
      'application/json': {
        schema: errorRef,
        example: {
          success: false,
          data: null,
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Please correct the highlighted fields',
            fields: { mobile: ['Enter a valid 10-digit Indian mobile number'] },
          },
        },
      },
    },
  },
  conflict: error(
    'The request collides with existing state — a duplicate applicant, a second open ' +
      'dispatch, or a concurrent edit.',
    'CONFLICT',
    'This conflicts with an existing record',
  ),
  staleWrite: error(
    'Someone else changed this row while you were editing it. Reload before saving.',
    'STALE_WRITE',
    'This record was changed by someone else while you were editing',
  ),
  invalidTransition: error(
    'The status change is not a legal edge in the workflow, or its data guards are not ' +
      'satisfied yet (for example, a balance is still outstanding).',
    'GUARD_NOT_SATISFIED',
    'Collect the outstanding balance before issuing a certificate',
  ),
  rateLimited: error(
    'Too many requests. The response says how long to wait.',
    'RATE_LIMITED',
    'Too many requests. Try again in 42s.',
  ),
} as const;
