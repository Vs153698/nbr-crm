import {
  addRecordSchema,
  categorySchema,
  changePasswordSchema,
  changeStatusSchema,
  confirmAttachmentSchema,
  confirmEvidenceSchema,
  createApplicantSchema,
  createBlacklistSchema,
  createNoteSchema,
  createPaymentPlanSchema,
  createPublicationSchema,
  createTaskSchema,
  courierSchema,
  createUserSchema,
  duplicateCheckSchema,
  exportRequestSchema,
  forgotPasswordSchema,
  liftBlacklistSchema,
  logCallSchema,
  loginSchema,
  markWhatsappSentSchema,
  nbrWebhookApplicationSchema,
  packageSchema,
  presignUploadSchema,
  recordTransactionSchema,
  resetPasswordSchema,
  revealIdentifierSchema,
  sendEmailSchema,
  setFlagSchema,
  updateApplicantSchema,
  updateNoteSchema,
  updateTaskSchema,
  updateUserSchema,
  uploadCertificateSchema,
  upsertDispatchSchema,
  upsertRoleSchema,
  upsertTemplateSchema,
  whatsappLinkSchema,
} from '@nbr/shared';
import { ERROR_RESPONSES, type TagName } from './openapi.meta';
import { zodSchema } from './openapi.zod';

export interface QueryParamDoc {
  readonly name: string;
  readonly description: string;
  readonly required?: boolean;
  readonly schema?: Record<string, unknown>;
  readonly example?: unknown;
}

export interface RouteDoc {
  readonly tag: TagName;
  readonly summary: string;
  readonly description: string;
  /** JSON Schema for the request body, normally derived from the Zod schema. */
  readonly body?: Record<string, unknown>;
  readonly query?: readonly QueryParamDoc[];
  readonly pathParams?: Readonly<Record<string, string>>;
  /** JSON Schema for `data` inside the success envelope. */
  readonly response?: Record<string, unknown>;
  readonly responseDescription?: string;
  /** Audit action written by this route, if any. */
  readonly audited?: string;
  readonly idempotency?: string;
  readonly notes?: string;
  readonly errors?: Readonly<Record<string, unknown>>;
}

// ── Reusable response fragments ─────────────────────────────────────────────

const OK = { type: 'object', properties: { ok: { type: 'boolean', enum: [true] } } };
const UUID = { type: 'string', format: 'uuid' };
const ISO = { type: 'string', format: 'date-time' };
const ID_ONLY = { type: 'object', properties: { id: UUID } };

const arrayOf = (properties: Record<string, unknown>) => ({
  type: 'array',
  items: { type: 'object', properties },
});

const CURSOR_QUERY: readonly QueryParamDoc[] = [
  {
    name: 'cursor',
    description:
      'Opaque keyset cursor from the previous response’s `meta.nextCursor`. Omit for page one.',
  },
  {
    name: 'limit',
    description: 'Rows per page. Server-capped.',
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
  },
];

const RECORD_ID_QUERY: QueryParamDoc = {
  name: 'recordId',
  description: 'Record UUID.',
  required: true,
  schema: UUID,
};

const QUEUE_ROW = arrayOf({
  recordId: UUID,
  recordCode: { type: 'string', example: 'NBRR00005' },
  applicantId: UUID,
  applicantName: { type: 'string' },
  recordTitle: { type: 'string', nullable: true },
  status: { type: 'string', example: 'verification_pending' },
  paymentStatus: { type: 'string', example: 'partial' },
  deliveryStatus: { type: 'string', example: 'not_dispatched' },
  city: { type: 'string', nullable: true },
  state: { type: 'string', nullable: true },
  pincode: { type: 'string', nullable: true },
  updatedAt: ISO,
});

const QUEUE_NOTE =
  'Ordered oldest-first. A queue sorted any other way quietly starves its own tail.';

/**
 * Per-endpoint documentation, keyed by `ControllerClass.handlerName`.
 *
 * Keyed by handler rather than by path so that renaming a route updates the
 * spec instead of silently orphaning its prose. Paths, verbs, versions and the
 * required permissions are *not* written here — they are read from the
 * application's own metadata at build time, so the document cannot claim a
 * permission the guard does not enforce. `reconcileDocs()` fails startup in
 * development if this map and the router disagree.
 */
export const ROUTE_DOCS: Readonly<Record<string, RouteDoc>> = {
  // ── Health ────────────────────────────────────────────────────────────────
  'HealthController.check': {
    tag: 'Health',
    summary: 'Readiness check',
    description:
      'Reports whether the database and Redis answer. Served outside the `/api` prefix and ' +
      'without a version, so an uptime monitor never has to track an API version to ask ' +
      'whether the service is alive.',
    response: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['ok', 'degraded'] },
        uptimeSeconds: { type: 'integer' },
        checks: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            properties: { ok: { type: 'boolean' }, ms: { type: 'number' } },
          },
        },
      },
    },
    notes:
      'Deliberately thin: it exposes no dependency versions or build details, because a ' +
      'public endpoint that fingerprints your stack is a gift to whoever is scanning you.',
  },
  'HealthController.live': {
    tag: 'Health',
    summary: 'Liveness check',
    description:
      'Answers only whether the process itself is responsive — it touches no dependency, so ' +
      'a database outage will not cause an orchestrator to kill an otherwise healthy process.',
    response: { type: 'object', properties: { status: { type: 'string', enum: ['ok'] } } },
  },

  // ── Auth ──────────────────────────────────────────────────────────────────
  'AuthController.login': {
    tag: 'Auth',
    summary: 'Sign in',
    description:
      'Exchanges credentials for a session. Sets `nbr_access` (HttpOnly, short-lived), ' +
      '`nbr_refresh` (HttpOnly, rotated on every use) and `nbr_csrf` (readable, for the ' +
      'double-submit header).',
    body: zodSchema(loginSchema, 'Login'),
    response: {
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: {
            id: UUID,
            fullName: { type: 'string' },
            email: { type: 'string', format: 'email' },
            employeeCode: { type: 'string', nullable: true },
            mustChangePassword: {
              type: 'boolean',
              description:
                'When true, every other endpoint returns 403 until the password is changed.',
            },
            role: { type: 'object', properties: { id: UUID, name: { type: 'string' } } },
            permissions: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
    audited: 'auth.login',
    notes:
      'Five consecutive failures lock the account for fifteen minutes. Failures return the ' +
      'same message whether or not the account exists, so the endpoint cannot be used to ' +
      'enumerate staff.',
    errors: {
      '401': ERROR_RESPONSES.unauthorised,
      '423': {
        description: 'The account is temporarily locked after repeated failures.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorEnvelope' },
            example: {
              success: false,
              data: null,
              error: { code: 'ACCOUNT_LOCKED', message: 'Too many failed attempts.' },
            },
          },
        },
      },
    },
  },
  'AuthController.refresh': {
    tag: 'Auth',
    summary: 'Refresh the session',
    description:
      'Rotates the refresh token and issues a new access token. The old refresh token is ' +
      'spent immediately.',
    response: OK,
    notes:
      'Reuse detection: presenting a refresh token that has already been rotated revokes the ' +
      'entire session family, on the assumption the token was stolen.',
  },
  'AuthController.logout': {
    tag: 'Auth',
    summary: 'Sign out',
    description: 'Revokes the current session server-side and clears all three cookies.',
    response: OK,
    audited: 'auth.logout',
  },
  'AuthController.me': {
    tag: 'Auth',
    summary: 'Current user and permissions',
    description:
      'The signed-in user with their resolved permission codes. The web app uses this to ' +
      'decide which controls to render — the server still enforces every one of them.',
    response: { type: 'object', properties: { id: UUID, permissions: { type: 'array', items: { type: 'string' } } } },
  },
  'AuthController.changePassword': {
    tag: 'Auth',
    summary: 'Change your own password',
    description:
      'Requires the current password. Callable while `mustChangePassword` is set — it is the ' +
      'one route a user in forced rotation can reach.',
    body: zodSchema(changePasswordSchema, 'ChangePassword'),
    response: OK,
    audited: 'auth.password_changed',
    notes: 'All other sessions for the account are revoked on success.',
  },
  'AuthController.forgotPassword': {
    tag: 'Auth',
    summary: 'Request a password-reset link',
    description: 'Emails a single-use, time-limited reset link.',
    body: zodSchema(forgotPasswordSchema, 'ForgotPassword'),
    response: OK,
    notes:
      'Always returns success, whether or not the address belongs to an account — a different ' +
      'response would confirm which staff emails exist.',
  },
  'AuthController.resetPassword': {
    tag: 'Auth',
    summary: 'Complete a password reset',
    description: 'Consumes the emailed token and sets a new password.',
    body: zodSchema(resetPasswordSchema, 'ResetPassword'),
    response: OK,
    audited: 'auth.password_reset',
  },

  // ── Dashboard & search ────────────────────────────────────────────────────
  'DashboardController.get': {
    tag: 'Dashboard',
    summary: 'Dashboard statistics',
    description:
      'Headline counts, status breakdown, twelve-month trend, today’s follow-ups and the ' +
      'caller’s pending tasks in one call.',
    response: {
      type: 'object',
      properties: {
        stats: { type: 'object', additionalProperties: true },
        statusBreakdown: arrayOf({ status: { type: 'string' }, count: { type: 'integer' } }),
        monthlyTrend: arrayOf({
          month: { type: 'string', example: '2026-07' },
          applications: { type: 'integer' },
          revenue: { type: 'string', example: '₹1,24,500.00' },
        }),
      },
    },
    notes:
      'Revenue figures are omitted for roles without `payments:view` rather than blanked ' +
      'client-side.',
  },
  'SearchController.query': {
    tag: 'Dashboard',
    summary: 'Global search',
    description:
      'Searches applicants and records by name, mobile, email, applicant ID, record ID and ' +
      'certificate number.',
    query: [
      { name: 'q', description: 'Search term. Minimum two characters.', required: true },
      { name: 'limit', description: 'Maximum results.', schema: { type: 'integer', default: 10 } },
    ],
    response: arrayOf({ type: { type: 'string' }, id: UUID, label: { type: 'string' } }),
    notes:
      'Backed by trigram indexes, so partial and misspelled names still match. Identifier ' +
      'columns are never searched in plaintext — Aadhaar and PAN are matched on keyed ' +
      'fingerprints instead.',
  },
  'LookupsController.all': {
    tag: 'Reference data',
    summary: 'Reference data',
    description:
      'Categories, packages, couriers, statuses and assignable users in one call, for ' +
      'populating form dropdowns.',
    response: { type: 'object', additionalProperties: true },
  },

  // ── Applicants ────────────────────────────────────────────────────────────
  'ApplicantsController.list': {
    tag: 'Applicants',
    summary: 'List applicants',
    description: 'Filterable, keyset-paginated list backing the main applicants screen.',
    query: [
      { name: 'q', description: 'Free-text search across name, mobile, email and IDs.' },
      { name: 'status', description: 'Record status code.', example: 'payment_pending' },
      { name: 'categoryId', description: 'Category UUID.', schema: UUID },
      { name: 'assignedToUserId', description: 'Assignee UUID.', schema: UUID },
      { name: 'paymentStatus', description: 'Denormalised payment state.', example: 'partial' },
      { name: 'deliveryStatus', description: 'Denormalised delivery state.' },
      { name: 'state', description: 'Indian state.' },
      { name: 'country', description: 'ISO country name.' },
      { name: 'from', description: 'Application date lower bound (ISO-8601).', schema: { type: 'string', format: 'date' } },
      { name: 'to', description: 'Application date upper bound (ISO-8601).', schema: { type: 'string', format: 'date' } },
      { name: 'sort', description: 'Sort field.', example: 'updatedAt' },
      { name: 'order', description: 'Sort direction.', schema: { type: 'string', enum: ['asc', 'desc'] } },
      ...CURSOR_QUERY,
    ],
    response: {
      type: 'object',
      properties: {
        items: arrayOf({
          applicantId: UUID,
          applicantCode: { type: 'string', example: 'NBRAP00001' },
          fullName: { type: 'string' },
          mobile: { type: 'string', description: 'Masked unless the caller holds `pii:reveal`.' },
          status: { type: 'string' },
        }),
        nextCursor: { type: 'string', nullable: true },
      },
    },
    notes: 'Served from a covering index and a tagged Redis cache invalidated on any write.',
  },
  'ApplicantsController.create': {
    tag: 'Applicants',
    summary: 'Create an applicant and their first record',
    description:
      'Creates the master applicant, their first record, the achievement, consent rows and ' +
      'the opening timeline entries as one atomic transaction.',
    body: zodSchema(createApplicantSchema, 'CreateApplicant'),
    response: {
      type: 'object',
      properties: { applicantId: UUID, recordId: UUID, applicantCode: { type: 'string' }, recordCode: { type: 'string' } },
    },
    audited: 'applicant.created',
    notes:
      'Duplicate detection runs first and rejects an exact mobile or email match. Call ' +
      '`POST /applicants/check-duplicate` beforehand to warn the operator rather than ' +
      'failing them at submit. A blacklisted applicant is blocked here unless an ' +
      'administrator overrides, and the override is audited.',
    errors: { '409': ERROR_RESPONSES.conflict },
  },
  'ApplicantsController.update': {
    tag: 'Applicants',
    summary: 'Update an applicant',
    description: 'Edits the master profile. Identifier fields are re-encrypted and re-fingerprinted.',
    body: zodSchema(updateApplicantSchema, 'UpdateApplicant'),
    response: ID_ONLY,
    audited: 'applicant.updated',
    notes: 'Optimistic locking: send the `version` you read. A stale version returns 409.',
    errors: { '409': ERROR_RESPONSES.staleWrite },
  },
  'ApplicantsController.getFull': {
    tag: 'Applicants',
    summary: 'Full applicant profile',
    description:
      'Everything the profile screen needs — applicant, all their records, achievements, ' +
      'flags, consent state and counts — in a single call, so the page does not waterfall ' +
      'a dozen requests.',
    response: { type: 'object', additionalProperties: true },
    notes: 'One applicant can hold many records; `records` is always an array.',
  },
  'ApplicantsController.createRecord': {
    tag: 'Records',
    summary: 'Add another record to an existing applicant',
    description:
      'A returning applicant keeps one master profile and one applicant ID. This opens a ' +
      'fresh record against it rather than duplicating the person.',
    body: zodSchema(addRecordSchema, 'AddRecord'),
    response: { type: 'object', properties: { recordId: UUID, recordCode: { type: 'string' } } },
    audited: 'record.created',
  },
  'ApplicantsController.checkDuplicate': {
    tag: 'Applicants',
    summary: 'Check for a duplicate before creating',
    description:
      'Non-destructive probe used by the create form. Matches on normalised mobile, email ' +
      'and name so that "Rahul  Verma" and "rahul verma" collide.',
    body: zodSchema(duplicateCheckSchema, 'DuplicateCheck'),
    response: arrayOf({ applicantId: UUID, applicantCode: { type: 'string' }, matchedOn: { type: 'string' }, confidence: { type: 'string' } }),
  },
  'ApplicantsController.reveal': {
    tag: 'Applicants',
    summary: 'Reveal a masked identifier',
    description:
      'Decrypts and returns one Aadhaar, passport or PAN number. A reason is mandatory and ' +
      'is stored verbatim.',
    body: zodSchema(revealIdentifierSchema, 'RevealIdentifier'),
    response: { type: 'object', properties: { value: { type: 'string' } } },
    audited: 'pii.revealed',
    notes:
      'DPDP Act §8(4)/§8(5). Every call is written to the PII access log with the actor, the ' +
      'field, the reason and the request ID — visible at `GET /audit-logs/pii-access`.',
  },
  'ApplicantsController.timelineFeed': {
    tag: 'Applicants',
    summary: 'Applicant timeline',
    description: 'Merged activity across all of the applicant’s records, newest first.',
    query: [{ name: 'limit', description: 'Maximum entries.', schema: { type: 'integer', default: 20 } }],
    response: arrayOf({ id: UUID, event: { type: 'string' }, actorName: { type: 'string', nullable: true }, createdAt: ISO }),
  },
  'ApplicantsController.certificateHistory': {
    tag: 'Certificates',
    summary: 'All certificates for an applicant',
    description:
      'Every certificate across every record this applicant holds, with version counts — ' +
      'the answer to "what has this person been awarded".',
    response: arrayOf({ recordId: UUID, certificateNumber: { type: 'string' }, versions: { type: 'integer' } }),
  },

  // ── Records & workflow ────────────────────────────────────────────────────
  'RecordsController.actions': {
    tag: 'Records',
    summary: 'Smart Workflow action panel',
    description:
      'The next steps available for this record right now: computed server-side from the ' +
      'state machine, filtered by the caller’s permissions and by whether each transition’s ' +
      'data guards are satisfied.',
    response: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        locked: { type: 'boolean' },
        transitions: arrayOf({
          to: { type: 'string' },
          label: { type: 'string' },
          available: { type: 'boolean' },
          reason: { type: 'string', nullable: true, description: 'Why a transition is blocked.' },
          requiresRemark: { type: 'boolean' },
          requiresOverride: { type: 'boolean' },
        }),
      },
    },
    notes:
      'Computed on the server so every client shows the same next steps, and so a client ' +
      'cannot invent an action it is not entitled to.',
  },
  'RecordsController.changeStatus': {
    tag: 'Records',
    summary: 'Change record status',
    description:
      'Moves a record along the 17-stage workflow. The transition must be a legal edge and ' +
      'its guards must be satisfied.',
    body: zodSchema(changeStatusSchema, 'ChangeStatus'),
    response: { type: 'object', properties: { status: { type: 'string' } } },
    audited: 'record.status_changed',
    notes:
      'Writes a timeline entry in the same transaction, so history can never disagree with ' +
      'state. Some transitions require a remark; leaving a terminal state requires an ' +
      'administrator override, which is recorded with its reason.',
    errors: { '422': ERROR_RESPONSES.invalidTransition },
  },
  'RecordsController.timelineFeed': {
    tag: 'Records',
    summary: 'Record timeline',
    description: 'Append-only activity for one record. The table rejects UPDATE and DELETE.',
    query: [{ name: 'limit', description: 'Maximum entries.', schema: { type: 'integer', default: 50 } }],
    response: arrayOf({ id: UUID, event: { type: 'string' }, createdAt: ISO }),
  },

  // ── Queues ────────────────────────────────────────────────────────────────
  'QueuesController.verification': {
    tag: 'Queues',
    summary: 'Verification queue',
    description: `Applications awaiting document review. ${QUEUE_NOTE}`,
    response: QUEUE_ROW,
  },
  'QueuesController.payments': {
    tag: 'Queues',
    summary: 'Outstanding payments queue',
    description:
      `Records with money still owed. ${QUEUE_NOTE} Driven by the denormalised payment ` +
      'status, which is written in the same transaction as the ledger row and therefore ' +
      'cannot disagree with it.',
    response: QUEUE_ROW,
  },
  'QueuesController.publications': {
    tag: 'Queues',
    summary: 'Pending publications queue',
    description: `Records with a certificate issued but nothing published yet. ${QUEUE_NOTE}`,
    response: QUEUE_ROW,
  },

  // ── Files ─────────────────────────────────────────────────────────────────
  'UploadsController.presign': {
    tag: 'Evidence & files',
    summary: 'Presign a direct upload',
    description:
      'Returns a short-lived URL for uploading straight to object storage. Large files never ' +
      'pass through the API process.',
    body: zodSchema(presignUploadSchema, 'PresignUpload'),
    response: {
      type: 'object',
      properties: {
        uploadUrl: { type: 'string', format: 'uri' },
        objectKey: { type: 'string' },
        expiresIn: { type: 'integer', description: 'Seconds.' },
      },
    },
    notes:
      'The signature pins the content type and content length, so the presigned URL cannot ' +
      'be reused to upload something else. MIME allow-lists and size caps are per scope.',
  },
  'EvidenceController.confirm': {
    tag: 'Evidence & files',
    summary: 'Confirm an evidence upload',
    description: 'Records the uploaded object against a record once storage has it.',
    body: zodSchema(confirmEvidenceSchema, 'ConfirmEvidence'),
    response: ID_ONLY,
    audited: 'evidence.uploaded',
    idempotency: 'Keyed on the file’s SHA-256, so a retried confirmation cannot double-insert.',
  },
  'EvidenceController.list': {
    tag: 'Evidence & files',
    summary: 'List evidence for a record',
    description: 'Metadata only. Fetch each file through its own download endpoint.',
    query: [RECORD_ID_QUERY],
    response: arrayOf({ id: UUID, fileName: { type: 'string' }, sizeBytes: { type: 'integer' }, isSensitive: { type: 'boolean' } }),
  },
  'EvidenceController.download': {
    tag: 'Evidence & files',
    summary: 'Download evidence',
    description: 'Returns a short-lived presigned download URL rather than proxying the bytes.',
    response: { type: 'object', properties: { url: { type: 'string', format: 'uri' } } },
    audited: 'evidence.downloaded',
    notes:
      'Files flagged sensitive (ID proofs) additionally require `pii:reveal` and ' +
      'are written to the PII access log. There is no delete route, and the database rejects ' +
      'DELETE independently.',
  },
  'AttachmentsController.confirm': {
    tag: 'Evidence & files',
    summary: 'Confirm a general attachment',
    description: 'Attaches a non-evidence document to an applicant.',
    body: zodSchema(confirmAttachmentSchema, 'ConfirmAttachment'),
    response: ID_ONLY,
    audited: 'attachment.uploaded',
  },
  'AttachmentsController.list': {
    tag: 'Evidence & files',
    summary: 'List attachments',
    description: 'All attachments held against one applicant.',
    query: [{ name: 'applicantId', description: 'Applicant UUID.', required: true, schema: UUID }],
    response: arrayOf({ id: UUID, fileName: { type: 'string' }, uploadedAt: ISO }),
  },
  'AttachmentsController.download': {
    tag: 'Evidence & files',
    summary: 'Download an attachment',
    description: 'Short-lived presigned download URL.',
    response: { type: 'object', properties: { url: { type: 'string', format: 'uri' } } },
    audited: 'attachment.downloaded',
  },

  // ── Payments ──────────────────────────────────────────────────────────────
  'PaymentsController.byRecord': {
    tag: 'Payments',
    summary: 'Payment summary for a record',
    description:
      'The plan, every transaction, invoices and the derived balance. All amounts are ' +
      'integer paise.',
    query: [RECORD_ID_QUERY],
    response: {
      type: 'object',
      properties: {
        plan: { type: 'object', nullable: true, additionalProperties: true },
        transactions: arrayOf({ id: UUID, amountPaise: { type: 'integer' }, mode: { type: 'string' }, reversedAt: { ...ISO, nullable: true } }),
        balancePaise: { type: 'integer' },
        status: { type: 'string', example: 'partial' },
      },
    },
  },
  'PaymentsController.createPlan': {
    tag: 'Payments',
    summary: 'Create or replace the payment plan',
    description:
      'Sets base amount, discount, GST and due date. The discount applies to the base; GST ' +
      'is charged on the discounted (taxable) value; the final amount is taxable + GST.',
    body: zodSchema(createPaymentPlanSchema, 'CreatePaymentPlan'),
    response: { type: 'object', properties: { id: UUID, finalPaise: { type: 'integer' } } },
    audited: 'payment.plan_created',
    notes:
      'The same calculation runs in the browser, so the operator’s preview is the figure ' +
      'that gets stored. Database CHECK constraints make an inconsistent total unstorable ' +
      'regardless of what the API sends.',
  },
  'PaymentsController.recordTransaction': {
    tag: 'Payments',
    summary: 'Record a payment received',
    description: 'Appends to the ledger and recomputes the record’s payment status.',
    body: zodSchema(recordTransactionSchema, 'RecordTransaction'),
    response: { type: 'object', properties: { id: UUID, status: { type: 'string' } } },
    audited: 'payment.recorded',
    idempotency:
      'Send a unique `idempotencyKey` per intended payment. A repeat of the same key returns ' +
      'the original transaction instead of taking the money twice — this is what makes a ' +
      'double-clicked Save safe.',
    notes: 'A CHECK constraint caps total paid at the plan’s final amount.',
  },
  'PaymentsController.reverse': {
    tag: 'Payments',
    summary: 'Reverse a transaction',
    description:
      'Marks a transaction reversed and recomputes status. The original row stays — the ' +
      'ledger is append-only, so a correction is a new fact rather than an erasure.',
    response: OK,
    audited: 'payment.reversed',
  },
  'PaymentsController.generateInvoice': {
    tag: 'Payments',
    summary: 'Generate an invoice',
    description: 'Produces a PDF invoice and allocates its number.',
    response: { type: 'object', properties: { invoiceNumber: { type: 'string', example: 'NBR/INV/2026-27/00002' }, url: { type: 'string', format: 'uri' } } },
    audited: 'invoice.generated',
    notes:
      'Numbers come from a financial-year sequence allocated in the database, so two ' +
      'simultaneous requests cannot collide on one number.',
  },

  // ── Certificates ──────────────────────────────────────────────────────────
  'CertificatesController.byRecord': {
    tag: 'Certificates',
    summary: 'Certificate and its versions',
    description: 'The certificate for a record with its full version history, newest first.',
    query: [RECORD_ID_QUERY],
    response: {
      type: 'object',
      nullable: true,
      properties: {
        certificateNumber: { type: 'string' },
        versions: arrayOf({ id: UUID, version: { type: 'integer' }, uploadedAt: ISO, uploadedByName: { type: 'string', nullable: true } }),
      },
    },
  },
  'CertificatesController.upload': {
    tag: 'Certificates',
    summary: 'Issue or re-issue a certificate',
    description: 'Appends a new version. Nothing is ever overwritten.',
    body: zodSchema(uploadCertificateSchema, 'UploadCertificate'),
    response: { type: 'object', properties: { certificateNumber: { type: 'string' }, version: { type: 'integer' } } },
    audited: 'certificate.issued',
    notes:
      'The certificate number is allocated once, on first issue, and survives every ' +
      're-issue. Previous versions cannot be edited or deleted — a database trigger refuses, ' +
      'independently of this API.',
  },
  'CertificatesController.queue': {
    tag: 'Certificates',
    summary: 'Certificates pending',
    description: `Paid records still awaiting a certificate. ${QUEUE_NOTE}`,
    response: QUEUE_ROW,
  },
  'CertificatesController.download': {
    tag: 'Certificates',
    summary: 'Download a certificate version',
    description: 'Presigned URL for one specific version, including superseded ones.',
    response: { type: 'object', properties: { url: { type: 'string', format: 'uri' } } },
    audited: 'certificate.downloaded',
  },

  // ── Publications ──────────────────────────────────────────────────────────
  'PublicationsController.list': {
    tag: 'Publications',
    summary: 'Publication entries for a record',
    description: 'Book, website and social-media entries.',
    query: [RECORD_ID_QUERY],
    response: arrayOf({ id: UUID, channel: { type: 'string' }, publishedAt: ISO, reference: { type: 'string', nullable: true } }),
  },
  'PublicationsController.create': {
    tag: 'Publications',
    summary: 'Record a publication',
    description: 'Logs that this record has been published on a given channel.',
    body: zodSchema(createPublicationSchema, 'CreatePublication'),
    response: ID_ONLY,
    audited: 'publication.created',
  },
  'PublicationsController.download': {
    tag: 'Publications',
    summary: 'Download publication proof',
    description: 'Presigned URL for the uploaded proof-of-publication artefact.',
    response: { type: 'object', properties: { url: { type: 'string', format: 'uri' } } },
  },

  // ── Dispatch ──────────────────────────────────────────────────────────────
  'DispatchController.byRecord': {
    tag: 'Dispatch',
    summary: 'Dispatch for a record',
    description: 'Current dispatch with courier, tracking number and resolved tracking URL.',
    query: [RECORD_ID_QUERY],
    response: {
      type: 'object',
      nullable: true,
      properties: {
        courierName: { type: 'string' },
        trackingNumber: { type: 'string' },
        trackingUrl: { type: 'string', format: 'uri', description: 'Built from the courier’s own URL template, not hardcoded.' },
        status: { type: 'string', example: 'in_transit' },
      },
    },
  },
  'DispatchController.upsert': {
    tag: 'Dispatch',
    summary: 'Create or update a dispatch',
    description: 'Records courier, tracking number and delivery state, and uploads the POD.',
    body: zodSchema(upsertDispatchSchema, 'UpsertDispatch'),
    response: ID_ONLY,
    audited: 'dispatch.updated',
    notes: 'A partial unique index allows only one open dispatch per record at a time.',
  },
  'DispatchController.queue': {
    tag: 'Dispatch',
    summary: 'Dispatch queue',
    description: `Certificates ready to send, and parcels in transit. ${QUEUE_NOTE}`,
    response: QUEUE_ROW,
  },
  'DispatchController.pod': {
    tag: 'Dispatch',
    summary: 'Download proof of delivery',
    description: 'Presigned URL for the POD document.',
    response: { type: 'object', properties: { url: { type: 'string', format: 'uri' } } },
  },

  // ── Tasks ─────────────────────────────────────────────────────────────────
  'TasksController.list': {
    tag: 'Tasks',
    summary: 'List tasks',
    description: 'Tasks for one applicant, or across the team.',
    query: [
      { name: 'applicantId', description: 'Restrict to one applicant.', schema: UUID },
      { name: 'scope', description: 'Whose tasks to return.', schema: { type: 'string', enum: ['mine', 'all'], default: 'mine' } },
      { name: 'overdueOnly', description: 'Only tasks past their due date.', schema: { type: 'boolean' } },
    ],
    response: arrayOf({ id: UUID, title: { type: 'string' }, dueDate: ISO, priority: { type: 'string' }, status: { type: 'string' }, overdue: { type: 'boolean' } }),
  },
  'TasksController.counts': {
    tag: 'Tasks',
    summary: 'Task counts',
    description: 'Badge counts for mine, overdue, due today and all — cheap enough to poll.',
    response: { type: 'object', properties: { mine: { type: 'integer' }, overdue: { type: 'integer' }, dueToday: { type: 'integer' }, all: { type: 'integer' } } },
  },
  'TasksController.create': {
    tag: 'Tasks',
    summary: 'Create a task',
    description: 'Assigns a follow-up, optionally attached to an applicant or record.',
    body: zodSchema(createTaskSchema, 'CreateTask'),
    response: ID_ONLY,
    audited: 'task.created',
  },
  'TasksController.update': {
    tag: 'Tasks',
    summary: 'Update or complete a task',
    description: 'Reassign, reschedule, complete or reopen.',
    body: zodSchema(updateTaskSchema, 'UpdateTask'),
    response: OK,
    audited: 'task.updated',
  },

  // ── Communication ─────────────────────────────────────────────────────────
  'CommunicationsController.history': {
    tag: 'Communication',
    summary: 'Communication history',
    description: 'Email, WhatsApp and call notes for an applicant in one timeline.',
    query: [
      { name: 'applicantId', description: 'Applicant UUID.', required: true, schema: UUID },
      { name: 'channel', description: 'Filter to one channel.', schema: { type: 'string', enum: ['email', 'whatsapp', 'call'] } },
    ],
    response: arrayOf({ id: UUID, channel: { type: 'string' }, subject: { type: 'string', nullable: true }, body: { type: 'string' }, status: { type: 'string' }, sentAt: ISO }),
    notes:
      'The log stores the rendered body, not a template reference, so it still shows what ' +
      'was actually sent after the template is later reworded.',
  },
  'CommunicationsController.preview': {
    tag: 'Communication',
    summary: 'Preview a rendered message',
    description:
      'Renders a template against a record so the operator sees the exact text before it ' +
      'goes out, and names any placeholder with no value behind it.',
    query: [
      { name: 'templateCode', description: 'Template code.', required: true },
      { name: 'recordId', description: 'Record to render against.', required: true, schema: UUID },
    ],
    response: { type: 'object', properties: { subject: { type: 'string', nullable: true }, body: { type: 'string' }, missing: { type: 'array', items: { type: 'string' } } } },
  },
  'CommunicationsController.sendEmail': {
    tag: 'Communication',
    summary: 'Send an email',
    description: 'Renders the template and sends it, logging the rendered body.',
    body: zodSchema(sendEmailSchema, 'SendEmail'),
    response: { type: 'object', properties: { id: UUID, status: { type: 'string' } } },
    audited: 'communication.email_sent',
    notes: 'Blocked when the applicant carries the Do Not Contact flag.',
  },
  'CommunicationsController.retry': {
    tag: 'Communication',
    summary: 'Retry a failed email',
    description: 'Re-sends a message that previously failed, against the same rendered body.',
    response: OK,
  },
  'CommunicationsController.whatsappLink': {
    tag: 'Communication',
    summary: 'Build a WhatsApp click-to-chat link',
    description:
      'Returns a wa.me URL with the rendered message. The operator sends it from their own ' +
      'WhatsApp; nothing is transmitted by the server.',
    body: zodSchema(whatsappLinkSchema, 'WhatsappLink'),
    response: { type: 'object', properties: { url: { type: 'string', format: 'uri' }, body: { type: 'string' } } },
  },
  'CommunicationsController.markSent': {
    tag: 'Communication',
    summary: 'Confirm a WhatsApp message was sent',
    description:
      'Logs the rendered text against the applicant after the operator confirms they sent ' +
      'it — the server cannot observe WhatsApp directly, so this is an explicit attestation.',
    body: zodSchema(markWhatsappSentSchema, 'MarkWhatsappSent'),
    response: ID_ONLY,
    audited: 'communication.whatsapp_sent',
  },
  'CommunicationsController.logCall': {
    tag: 'Communication',
    summary: 'Log a phone call',
    description: 'Records outcome and notes for a call.',
    body: zodSchema(logCallSchema, 'LogCall'),
    response: ID_ONLY,
    audited: 'communication.call_logged',
  },

  // ── Templates ─────────────────────────────────────────────────────────────
  'TemplatesController.list': {
    tag: 'Templates',
    summary: 'List message templates',
    description: 'All email and WhatsApp templates with their bodies and active state.',
    response: arrayOf({ id: UUID, code: { type: 'string' }, channel: { type: 'string' }, name: { type: 'string' }, subject: { type: 'string', nullable: true }, body: { type: 'string' }, isActive: { type: 'boolean' } }),
  },
  'TemplatesController.upsert': {
    tag: 'Templates',
    summary: 'Create or update a template',
    description: 'Upserts by template code.',
    body: zodSchema(upsertTemplateSchema, 'UpsertTemplate'),
    response: ID_ONLY,
    audited: 'template.updated',
    notes:
      'Placeholders are validated against a fixed vocabulary at save time, not at send time. ' +
      'A template referencing an unknown field is rejected here rather than reaching an ' +
      'applicant as a blank.',
  },

  // ── Blacklist & flags ─────────────────────────────────────────────────────
  'BlacklistController.list': {
    tag: 'Blacklist',
    summary: 'Blacklist register',
    description: 'Active entries, or the full register including lifted ones.',
    query: [{ name: 'activeOnly', description: 'Omit lifted entries.', schema: { type: 'boolean', default: true } }],
    response: arrayOf({ id: UUID, applicantId: UUID, kind: { type: 'string' }, reason: { type: 'string' }, effectiveFrom: ISO, liftedAt: { ...ISO, nullable: true }, isActive: { type: 'boolean' } }),
  },
  'BlacklistController.add': {
    tag: 'Blacklist',
    summary: 'Blacklist an applicant',
    description: 'Blocks the applicant from opening new records.',
    body: zodSchema(createBlacklistSchema, 'CreateBlacklist'),
    response: ID_ONLY,
    audited: 'blacklist.added',
  },
  'BlacklistController.lift': {
    tag: 'Blacklist',
    summary: 'Lift a blacklist',
    description: 'Restores the applicant’s ability to apply.',
    body: zodSchema(liftBlacklistSchema, 'LiftBlacklist'),
    response: OK,
    audited: 'blacklist.lifted',
    notes:
      'Stamps the row with the lift reason rather than deleting it. The register is the ' +
      'evidence trail for a decision that blocked someone from applying, so it is never erased.',
  },
  'FlagsController.list': {
    tag: 'Blacklist',
    summary: 'List restriction flags',
    description:
      'Behavioural flags on an applicant, each with its effect: blocks new records, blocks ' +
      'outreach, or blocks erasure.',
    query: [{ name: 'applicantId', description: 'Applicant UUID.', required: true, schema: UUID }],
    response: arrayOf({ id: UUID, flag: { type: 'string' }, reason: { type: 'string', nullable: true }, expiresAt: { ...ISO, nullable: true } }),
  },
  'FlagsController.set': {
    tag: 'Blacklist',
    summary: 'Set a restriction flag',
    description: 'Applies a flag, optionally with an expiry.',
    body: zodSchema(setFlagSchema, 'SetFlag'),
    response: ID_ONLY,
    audited: 'flag.set',
  },
  'FlagsController.remove': {
    tag: 'Blacklist',
    summary: 'Remove a restriction flag',
    description: 'Clears a flag. The row is stamped removed rather than deleted.',
    query: [
      { name: 'applicantId', description: 'Applicant UUID.', required: true, schema: UUID },
      { name: 'flag', description: 'Flag code.', required: true },
    ],
    response: OK,
    audited: 'flag.removed',
  },

  // ── Notifications ─────────────────────────────────────────────────────────
  'NotificationsController.list': {
    tag: 'Notifications',
    summary: 'List notifications',
    description: 'Alerts addressed to the caller, plus broadcasts. Dismissed items are excluded.',
    query: [{ name: 'unreadOnly', description: 'Only unread alerts.', schema: { type: 'boolean' } }],
    response: arrayOf({ id: UUID, kind: { type: 'string' }, title: { type: 'string' }, body: { type: 'string', nullable: true }, severity: { type: 'string' }, link: { type: 'string', nullable: true }, readAt: { ...ISO, nullable: true } }),
  },
  'NotificationsController.count': {
    tag: 'Notifications',
    summary: 'Unread count',
    description:
      'Just the badge number. Separate from the list so the bell can poll cheaply instead of ' +
      'refetching fifty rows for one integer.',
    response: { type: 'object', properties: { unread: { type: 'integer' } } },
  },
  'NotificationsController.markRead': {
    tag: 'Notifications',
    summary: 'Mark one as read',
    description: 'Stamps a single notification read.',
    response: OK,
  },
  'NotificationsController.markAllRead': {
    tag: 'Notifications',
    summary: 'Mark all as read',
    description: 'Clears the caller’s unread badge.',
    response: { type: 'object', properties: { updated: { type: 'integer' } } },
  },
  'NotificationsController.dismiss': {
    tag: 'Notifications',
    summary: 'Dismiss a notification',
    description: 'Hides it from the panel permanently.',
    response: OK,
  },
  'NotificationsController.generate': {
    tag: 'Notifications',
    summary: 'Run the alert sweep now',
    description:
      'Runs the generators immediately instead of waiting for the hourly schedule — useful ' +
      'after changing an SLA setting.',
    response: OK,
    idempotency:
      'Dedupe keys make repeated calls safe: a second run raises nothing new rather than ' +
      'duplicating every alert.',
  },

  // ── Reports & exports ─────────────────────────────────────────────────────
  'ReportsController.run': {
    tag: 'Reports',
    summary: 'Run a report',
    description:
      'Returns columns, rows and totals for one of the eight report types: applications, ' +
      'revenue, pending payments, pending certificates, pending dispatch, employee ' +
      'performance, category-wise and country-wise.',
    pathParams: { type: 'Report type, e.g. `revenue` or `pending_payments`.' },
    query: [
      { name: 'from', description: 'Window start (ISO-8601). Defaults to twelve months ago.', schema: { type: 'string', format: 'date' } },
      { name: 'to', description: 'Window end (ISO-8601). Defaults to today.', schema: { type: 'string', format: 'date' } },
    ],
    response: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        columns: arrayOf({ key: { type: 'string' }, label: { type: 'string' }, align: { type: 'string', nullable: true } }),
        rows: { type: 'array', items: { type: 'object', additionalProperties: true } },
        totals: { type: 'object', nullable: true, additionalProperties: true },
        generatedAt: ISO,
      },
    },
    notes: 'Every report is date-bounded — an unbounded aggregate over a growing table is a ' +
      'query that gets slower forever.',
  },
  'ReportsController.export': {
    tag: 'Reports',
    summary: 'Queue a report export',
    description:
      'Queues a CSV, XLSX or PDF export and returns a job id. Poll `GET /exports` for ' +
      'progress. Exporting is asynchronous because a large export that appears to hang is ' +
      'worse than one that visibly queues.',
    body: zodSchema(exportRequestSchema, 'ExportRequest'),
    response: { type: 'object', properties: { jobId: UUID } },
    audited: 'report.exported',
  },
  'ExportsController.list': {
    tag: 'Reports',
    summary: 'List export jobs',
    description: 'The caller’s own export jobs with status and expiry.',
    response: arrayOf({ id: UUID, reportType: { type: 'string' }, format: { type: 'string' }, status: { type: 'string' }, rowCount: { type: 'integer', nullable: true }, expiresAt: { ...ISO, nullable: true }, expired: { type: 'boolean' } }),
  },
  'ExportsController.download': {
    tag: 'Reports',
    summary: 'Download an export',
    description: 'Presigned URL for a completed export.',
    response: { type: 'object', properties: { url: { type: 'string', format: 'uri' } } },
    audited: 'export.downloaded',
    notes:
      'Exports contain personal data, so they expire 24 hours after generation and only the ' +
      'person who requested one can download it.',
  },

  // ── Notes ─────────────────────────────────────────────────────────────────
  'NotesController.list': {
    tag: 'Notes',
    summary: 'List internal notes',
    description: 'Notes on an applicant, optionally narrowed to one record.',
    query: [
      { name: 'applicantId', description: 'Applicant UUID.', required: true, schema: UUID },
      { name: 'recordId', description: 'Narrow to one record.', schema: UUID },
    ],
    response: arrayOf({ id: UUID, body: { type: 'string' }, authorName: { type: 'string', nullable: true }, createdAt: ISO, editedAt: { ...ISO, nullable: true } }),
  },
  'NotesController.create': {
    tag: 'Notes',
    summary: 'Add a note',
    description: 'Internal only — notes are never shown to applicants.',
    body: zodSchema(createNoteSchema, 'CreateNote'),
    response: ID_ONLY,
    audited: 'note.created',
  },
  'NotesController.update': {
    tag: 'Notes',
    summary: 'Edit a note',
    description: 'Edits the current text and files the previous text as a revision.',
    body: zodSchema(updateNoteSchema, 'UpdateNote'),
    response: OK,
    audited: 'note.updated',
  },
  'NotesController.revisions': {
    tag: 'Notes',
    summary: 'Note revision history',
    description:
      'Every previous version of a note. The revision table is append-only, so an edit ' +
      'cannot quietly rewrite what someone recorded at the time.',
    response: arrayOf({ id: UUID, body: { type: 'string' }, editedByName: { type: 'string', nullable: true }, createdAt: ISO }),
  },

  // ── Administration ────────────────────────────────────────────────────────
  'UsersController.list': {
    tag: 'Administration',
    summary: 'List users',
    description: 'Staff accounts with their roles and session state.',
    query: [{ name: 'includeInactive', description: 'Include deactivated accounts.', schema: { type: 'boolean' } }],
    response: arrayOf({ id: UUID, fullName: { type: 'string' }, email: { type: 'string' }, roleName: { type: 'string' }, isActive: { type: 'boolean' } }),
  },
  'UsersController.create': {
    tag: 'Administration',
    summary: 'Create a user',
    description: 'Provisions a staff account with a temporary password.',
    body: zodSchema(createUserSchema, 'CreateUser'),
    response: ID_ONLY,
    audited: 'user.created',
    notes: 'The account is created with `mustChangePassword`, so the temporary password ' +
      'cannot become a permanent one.',
  },
  'UsersController.update': {
    tag: 'Administration',
    summary: 'Update a user',
    description: 'Changes role, contact details or active state.',
    body: zodSchema(updateUserSchema, 'UpdateUser'),
    response: OK,
    audited: 'user.updated',
    notes: 'Deactivating an account revokes its sessions immediately rather than at token expiry.',
  },
  'UsersController.revoke': {
    tag: 'Administration',
    summary: 'Revoke a user’s sessions',
    description:
      'Signs the user out everywhere by bumping their token version, which invalidates every ' +
      'access token already issued.',
    response: OK,
    audited: 'user.sessions_revoked',
  },
  'RolesController.list': {
    tag: 'Administration',
    summary: 'List roles',
    description: 'Roles with their permission sets and how many users hold each.',
    response: arrayOf({ id: UUID, name: { type: 'string' }, permissions: { type: 'array', items: { type: 'string' } }, userCount: { type: 'integer' } }),
  },
  'RolesController.catalogue': {
    tag: 'Administration',
    summary: 'Permission catalogue',
    description:
      'Every permission code grouped by module, with human labels — the source for the role ' +
      'editor’s matrix.',
    response: arrayOf({ module: { type: 'string' }, label: { type: 'string' }, actions: { type: 'array', items: { type: 'string' } } }),
  },
  'RolesController.create': {
    tag: 'Administration',
    summary: 'Create a role',
    description: 'Defines a new role and its permission set.',
    body: zodSchema(upsertRoleSchema, 'UpsertRole'),
    response: ID_ONLY,
    audited: 'role.created',
  },
  'RolesController.update': {
    tag: 'Administration',
    summary: 'Update a role',
    description: 'Changes a role’s permissions. Takes effect on the holders’ next request.',
    body: zodSchema(upsertRoleSchema, 'UpsertRole'),
    response: OK,
    audited: 'role.updated',
    notes: 'System roles cannot have their permissions removed below the minimum the ' +
      'application needs to function.',
  },
  'SettingsController.list': {
    tag: 'Administration',
    summary: 'List settings',
    description: 'Operational settings grouped by category.',
    response: arrayOf({
      category: { type: 'string' },
      settings: arrayOf({ key: { type: 'string' }, value: {}, label: { type: 'string', nullable: true }, isEditable: { type: 'boolean' } }),
    }),
    notes:
      'Settings that mirror an environment variable or a statutory limit are returned with ' +
      '`isEditable: false` — changing them from the UI would either create a value the ' +
      'process never reads, or quietly weaken a legal obligation.',
  },
  'SettingsController.update': {
    tag: 'Administration',
    summary: 'Update a setting',
    description: 'Sets one key. Non-editable keys are rejected.',
    body: { type: 'object', required: ['value'], properties: { value: { description: 'Any JSON value; the type must match the existing one.' } } },
    response: OK,
    audited: 'setting.updated',
  },
  'SettingsController.testMail': {
    tag: 'Administration',
    summary: 'Send a test email',
    description:
      'Sends one real message using the currently saved SMTP settings and reports the ' +
      'configuration it used.',
    body: { type: 'object', required: ['to'], properties: { to: { type: 'string', format: 'email' } } },
    response: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        config: {
          type: 'object',
          properties: {
            host: { type: 'string' },
            port: { type: 'integer' },
            secure: { type: 'boolean' },
            user: { type: 'string' },
            fromName: { type: 'string' },
            fromAddress: { type: 'string' },
            fromDatabase: { type: 'boolean' },
          },
        },
      },
    },
    notes:
      'A real send rather than a connection check: authentication can succeed while the ' +
      'relay rejects the From address, and that failure would otherwise first appear when a ' +
      'certificate email silently fails. The mail settings override the server environment ' +
      'only where they are non-empty, so a blank field keeps the deployed value.',
    errors: {
      '422': { description: 'SMTP verification or the send itself failed; the reason is returned.' },
    },
  },
  'SettingsController.upsertCategory': {
    tag: 'Reference data',
    summary: 'Create or update a record category',
    description:
      'Categories drive the application form and the category-wise report. Omit `id` to ' +
      'create, supply it to update.',
    body: zodSchema(categorySchema, 'Category'),
    response: ID_ONLY,
    audited: 'catalogue.category_updated',
  },
  'SettingsController.upsertPackage': {
    tag: 'Reference data',
    summary: 'Create or update a package',
    description:
      'Packages carry default pricing used to prefill a payment plan. Amounts are decimal ' +
      'strings here and converted to integer paise on the way in.',
    body: zodSchema(packageSchema, 'Package'),
    response: ID_ONLY,
    audited: 'catalogue.package_updated',
  },
  'SettingsController.upsertCourier': {
    tag: 'Reference data',
    summary: 'Create or update a courier',
    description:
      'Couriers carry a tracking-URL template with a `{trackingNumber}` placeholder, so ' +
      'adding a courier needs no code change.',
    body: zodSchema(courierSchema, 'Courier'),
    response: ID_ONLY,
    audited: 'catalogue.courier_updated',
  },

  // ── Audit ─────────────────────────────────────────────────────────────────
  'AuditController.list': {
    tag: 'Audit',
    summary: 'List audit entries',
    description:
      'Keyset-paginated audit trail with actor, action, entity, before → after changes, IP ' +
      'and request ID.',
    query: [
      { name: 'q', description: 'Free-text across actor, action and entity label.' },
      { name: 'action', description: 'Exact action code.', example: 'record.status_changed' },
      { name: 'actorUserId', description: 'Filter by actor.', schema: UUID },
      { name: 'entityType', description: 'Filter by entity type.' },
      { name: 'entityId', description: 'Filter by entity id.', schema: UUID },
      { name: 'from', description: 'Lower bound. Defaults to 30 days ago.', schema: { type: 'string', format: 'date-time' } },
      { name: 'to', description: 'Upper bound.', schema: { type: 'string', format: 'date-time' } },
      ...CURSOR_QUERY,
    ],
    response: {
      type: 'object',
      properties: {
        items: arrayOf({ id: UUID, action: { type: 'string' }, actorName: { type: 'string', nullable: true }, entityLabel: { type: 'string', nullable: true }, changes: { type: 'object', nullable: true, additionalProperties: true }, ipAddress: { type: 'string', nullable: true }, createdAt: ISO }),
        nextCursor: { type: 'string', nullable: true },
      },
    },
    notes: 'Read-only by construction: the table rejects UPDATE and DELETE at the database level.',
  },
  'AuditController.actions': {
    tag: 'Audit',
    summary: 'Distinct audit actions',
    description: 'The action codes actually present, for populating the filter.',
    response: { type: 'array', items: { type: 'string' } },
  },
  'AuditController.entity': {
    tag: 'Audit',
    summary: 'History for one entity',
    description: 'Everything ever done to one record, applicant, user or payment.',
    pathParams: { type: 'Entity type, e.g. `record`.', id: 'Entity UUID.' },
    response: arrayOf({ id: UUID, action: { type: 'string' }, createdAt: ISO }),
  },
  'AuditController.piiAccess': {
    tag: 'Audit',
    summary: 'PII access log',
    description:
      'Who read which sensitive identifier, when, and the reason they gave. Required by ' +
      'DPDP Act §8(4) and §8(5).',
    query: [
      { name: 'applicantId', description: 'Whose data was accessed.', schema: UUID },
      { name: 'userId', description: 'Who accessed it.', schema: UUID },
    ],
    response: arrayOf({ id: UUID, applicantId: UUID, field: { type: 'string' }, reason: { type: 'string' }, userName: { type: 'string', nullable: true }, createdAt: ISO }),
  },

  // ── Integration ───────────────────────────────────────────────────────────
  'IntegrationsController.receive': {
    tag: 'Integration',
    summary: 'Inbound application webhook',
    description:
      'Receives an application from the existing NBR website. Verifies the signature, stores ' +
      'the raw event and returns 202 immediately; the import runs afterwards so a slow ' +
      'import never causes the sender to time out and retry.',
    body: zodSchema(nbrWebhookApplicationSchema, 'NbrWebhookApplication'),
    response: { type: 'object', properties: { received: { type: 'boolean' }, eventId: UUID } },
    responseDescription: 'Accepted for processing.',
    notes:
      'Sign the raw body with HMAC-SHA256 and send `x-nbr-signature: t=<unix>,v1=<hex>`. The ' +
      'timestamp is inside the signed payload, so a captured request cannot be replayed ' +
      'later; comparison is constant-time. This route is public — the signature *is* the ' +
      'authentication.',
    idempotency:
      'A unique index on (source, external id) means the same application can arrive five ' +
      'times and still produce exactly one record.',
    errors: {
      '401': {
        description: 'Missing, malformed, stale or incorrect signature.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorEnvelope' },
            example: { success: false, data: null, error: { code: 'INVALID_SIGNATURE', message: 'Signature verification failed' } },
          },
        },
      },
    },
  },
  'IntegrationsController.status': {
    tag: 'Integration',
    summary: 'Integration sync status',
    description: 'Last received event, counts by state and the current failure backlog.',
    response: { type: 'object', properties: { lastEventAt: { ...ISO, nullable: true }, pending: { type: 'integer' }, failed: { type: 'integer' }, imported: { type: 'integer' } } },
  },
  'IntegrationsController.events': {
    tag: 'Integration',
    summary: 'List inbound events',
    description: 'The raw event log, including payloads that failed to import and why.',
    query: [
      { name: 'status', description: 'Filter by import state.', example: 'failed' },
      ...CURSOR_QUERY,
    ],
    response: arrayOf({ id: UUID, externalId: { type: 'string' }, status: { type: 'string' }, error: { type: 'string', nullable: true }, receivedAt: ISO }),
  },
  'IntegrationsController.syncPackages': {
    tag: 'Integration',
    summary: 'Sync packages from the website',
    description:
      "Mirrors the public website's plan catalogue into this system's packages, matched on " +
      'the website\'s plan code.',
    response: {
      type: 'object',
      properties: {
        imported: { type: 'integer' },
        updated: { type: 'integer' },
        skipped: { type: 'integer' },
        packages: arrayOf({ name: { type: 'string' }, legacyCode: { type: 'string' }, amount: { type: 'string' } }),
      },
    },
    notes:
      "The website's payments table only accepts three plan codes, so a payment recorded " +
      'here against a CRM-invented package had to be guessed back onto one of them by ' +
      'price. Sharing the catalogue means an operator picks the same package on either ' +
      'side and the code round-trips exactly. Plans the website cannot write back to its ' +
      'own payments table are skipped rather than offered as packages that would silently ' +
      'degrade on push. Prices are mirrored at 0% GST because the website quotes ' +
      'all-inclusive figures with no separate tax line.',
    errors: {
      '422': { description: 'The integration is not configured, or the website rejected the request.' },
    },
  },
  'IntegrationsController.secretIdentity': {
    tag: 'Integration',
    summary: 'Webhook secret fingerprint',
    description:
      'A one-way fingerprint of the shared secret this API verifies against, plus its own ' +
      'clock and replay tolerance.',
    response: {
      type: 'object',
      properties: {
        fingerprint: { type: 'string' },
        secretLength: { type: 'integer' },
        serverTime: ISO,
        toleranceSeconds: { type: 'integer' },
      },
    },
    notes:
      'Exists so a mismatched secret can be diagnosed without either side revealing one. ' +
      'The sender shows the same fingerprint for the secret it signs with; equal ' +
      'fingerprints mean identical secrets. It is HMAC-SHA256(secret, fixed label) ' +
      'truncated to 8 hex characters, and requires the integrations permission rather ' +
      'than being public — a fingerprint served anonymously would let a weak secret be ' +
      'attacked offline.',
  },
  'IntegrationsController.pushStatus': {
    tag: 'Integration',
    summary: 'Outbound push status',
    description:
      'The return leg of the mirror: whether pushing changes back to the NBR website is ' +
      'configured, how many records are mirrored, and which of them last failed to push.',
    response: {
      type: 'object',
      properties: {
        configured: { type: 'boolean' },
        baseUrl: { type: 'string' },
        mirroredRecords: { type: 'integer' },
        failing: arrayOf({
          recordId: UUID,
          externalId: { type: 'string' },
          error: { type: 'string' },
          at: { ...ISO, nullable: true },
        }),
      },
    },
    notes:
      'Only records that arrived from the website are ever pushed back — a record created ' +
      'in the CRM has no counterpart there. Pushes are also suppressed when the change ' +
      'being sent is the echo of one that arrived from the website moments earlier.',
  },
  'IntegrationsController.replay': {
    tag: 'Integration',
    summary: 'Replay an inbound event',
    description:
      'Re-runs the import for a stored event after fixing whatever made it fail. The stored ' +
      'payload is replayed as received — nothing is re-requested from the website.',
    response: OK,
    audited: 'integration.event_replayed',
  },
};
