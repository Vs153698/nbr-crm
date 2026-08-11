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
  assignRecordSchema,
  convertLeadSchema,
  createLeadSchema,
  confirmEmployeeDocumentSchema,
  employeeSchema,
  legacyApplicationActionSchema,
  logLeadCallSchema,
  presignEmployeeDocumentSchema,
  updateEmployeeSchema,
  updateLeadSchema,
  logCallSchema,
  loginSchema,
  markWhatsappSentSchema,
  nbrWebhookApplicationSchema,
  packageSchema,
  presignUploadSchema,
  selectionLetterSchema,
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
  verifyCertificateSchema,
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
  'RecordsController.assign': {
    tag: 'Records',
    summary: 'Assign a record to a user',
    description: 'Sets or clears the employee responsible for a record.',
    body: zodSchema(assignRecordSchema, 'AssignRecord'),
    response: { type: 'object', properties: { assignedToUserId: { ...UUID, nullable: true } } },
    audited: 'record.assigned',
    notes:
      'A first-class operation rather than a field on the edit form: the Smart Action panel ' +
      'offers it at four stages, the applicant list filters on it, and every reassignment is ' +
      'written to the timeline so a record\'s ownership history stays answerable. Assigning ' +
      'to a deactivated account is refused — the record would look assigned while belonging ' +
      'to nobody.',
    errors: {
      '422': { description: 'The chosen user is not active.' },
    },
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
    description: `Applications whose documents are still being checked. ${QUEUE_NOTE}`,
    response: QUEUE_ROW,
    notes:
      'Verified records are *not* here — they are in the approvals queue below. The two used ' +
      'to be one list, which meant a verifier and an approver read the same rows and neither ' +
      'could tell which were theirs.',
  },
  'QueuesController.approvals': {
    tag: 'Queues',
    summary: 'Approval pending queue',
    description: `Verified applications waiting on an approve or reject decision. ${QUEUE_NOTE}`,
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
    description: `Delivered records with nothing published yet. ${QUEUE_NOTE}`,
    response: QUEUE_ROW,
    notes:
      'Publication follows delivery in the pipeline, so this queue is the Publication stage ' +
      'and nothing earlier. It used to include Certificate Completed, which put a record here ' +
      'while its certificate was still in the office — the magazine entry could be written ' +
      'before the applicant had been awarded anything.',
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
    summary: 'Upload a certificate (or a new version)',
    description:
      'Appends a new version and leaves the certificate awaiting verification. Nothing is ' +
      'ever overwritten, and this does not complete the certificate stage.',
    body: zodSchema(uploadCertificateSchema, 'UploadCertificate'),
    response: { type: 'object', properties: { certificateNumber: { type: 'string' }, version: { type: 'integer' } } },
    audited: 'certificate.issued',
    notes:
      'The certificate number is allocated once, on first upload, and survives every ' +
      're-issue. Previous versions cannot be edited or deleted — a database trigger refuses, ' +
      'independently of this API. Uploading always sets the certificate back to ' +
      '`pending_verification`, including a correction to one that was already signed off: the ' +
      'approval belonged to the file it replaced. Call `POST /certificates/verify` to complete ' +
      'the stage.',
  },
  'CertificatesController.verify': {
    tag: 'Certificates',
    summary: 'Mark a certificate verified and complete the stage',
    description:
      'The employee sign-off. Records who verified it, when, and which version — then moves ' +
      'the record to Certificate Completed and on to Dispatch Pending.',
    body: zodSchema(verifyCertificateSchema, 'VerifyCertificate'),
    response: {
      type: 'object',
      properties: {
        certificateNumber: { type: 'string', nullable: true },
        verifiedVersion: { type: 'integer' },
        status: { type: 'string' },
      },
    },
    audited: 'certificate.issued',
    notes:
      'The only thing that completes the certificate stage. Nothing automatic may do it — not ' +
      'a payment settling, and notably not the NBR website, which mints a certificate number ' +
      'of its own as soon as a fee is paid; that number is recorded for reference and a ' +
      'mirrored snapshot cannot carry a record past Certificate Verification without this ' +
      'call. Rejected when no file has been uploaded, and when the latest version has already ' +
      'been verified — correct a certificate by uploading a new version, which reopens the ' +
      'stage.',
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
      'Renders a template against a record so the operator sees the exact message before it ' +
      'goes out, and names any placeholder with no value behind it. For email this runs the ' +
      'same renderer the send uses, so `html` is the message rather than an impression of it.',
    query: [
      { name: 'templateCode', description: 'Template code.', required: true },
      { name: 'recordId', description: 'Record to render against.', required: true, schema: UUID },
    ],
    response: {
      type: 'object',
      properties: {
        subject: { type: 'string', nullable: true },
        body: { type: 'string', description: 'Plain-text alternative.' },
        html: {
          type: 'string',
          nullable: true,
          description: 'The rendered email. Null for WhatsApp, which has no HTML.',
        },
        missing: { type: 'array', items: { type: 'string' } },
      },
    },
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
    response: arrayOf({ id: UUID, code: { type: 'string' }, channel: { type: 'string' }, name: { type: 'string' }, subject: { type: 'string', nullable: true }, body: { type: 'string' }, isActive: { type: 'boolean' }, isSystem: { type: 'boolean' } }),
    notes:
      '`isSystem` marks the templates the Smart Workflow Engine addresses by code. Those can ' +
      'be reworded or switched off but not deleted — a stage action would otherwise be left ' +
      'with no message to send. Anything else is a custom template.',
  },
  'TemplatesController.remove': {
    tag: 'Templates',
    summary: 'Delete a custom template',
    description: 'Removes a template an Admin added. Built-in templates are refused.',
    response: OK,
    audited: 'template.updated',
    notes:
      'The refusal is enforced here rather than only hidden in the interface: a permitted API ' +
      'call must not be able to break a workflow stage the UI merely declines to offer.',
    errors: {
      '422': { description: 'The template is a built-in one. Reword it or deactivate it instead.' },
    },
  },
  'TemplatesController.upsert': {
    tag: 'Templates',
    summary: 'Create or update a template',
    description:
      'Upserts by template code. Any slug is accepted, so an Admin can add templates of ' +
      'their own alongside the built-in seven.',
    body: zodSchema(upsertTemplateSchema, 'UpsertTemplate'),
    response: ID_ONLY,
    audited: 'template.updated',
    notes:
      'Placeholders are validated against a fixed vocabulary at save time, not at send time. ' +
      'A template referencing an unknown field is rejected here rather than reaching an ' +
      'applicant as a blank. Email templates carry `document` — the content areas that render ' +
      'into the public website\'s layout — and their `body` is generated from it as the ' +
      'text alternative rather than being supplied. WhatsApp carries `body` alone.',
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
    description:
      'Blocks the applicant from opening new records, and suspends their account on the NBR ' +
      'website so they cannot log in and file there instead.',
    body: zodSchema(createBlacklistSchema, 'CreateBlacklist'),
    response: ID_ONLY,
    audited: 'blacklist.added',
    notes:
      'The website push is detached and never fails the call: the register entry here is ' +
      'already written and enforced, and a website outage must not undo it. Where the push ' +
      'does fail it is logged and shown on the integrations screen.',
  },
  'BlacklistController.lift': {
    tag: 'Blacklist',
    summary: 'Lift a blacklist',
    description:
      'Restores the applicant’s ability to apply, and un-suspends their website account — but ' +
      'only once no other blacklist entry is still in force against them.',
    body: zodSchema(liftBlacklistSchema, 'LiftBlacklist'),
    response: OK,
    audited: 'blacklist.lifted',
    notes:
      'Stamps the row with the lift reason rather than deleting it. The register is the ' +
      'evidence trail for a decision that blocked someone from applying, so it is never erased.',
  },
  'WebsiteBlacklistController.userBlock': {
    tag: 'Integration',
    summary: 'Website blocked or unblocked an account',
    description:
      'Inbound from the NBR website’s Users screen. A block opens a permanent blacklist entry ' +
      'against the matching applicant here; an unblock lifts the active one.',
    notes:
      'Authenticated by HMAC signature over the raw body, not by a session — this is a ' +
      'server-to-server call. The applicant is matched on mobile first, then email; matching ' +
      'nobody answers 200 with `matched: false`, because a website account that never reached ' +
      'an application is a person this CRM has legitimately never met, and a 404 would only ' +
      'make the website retry a push that can never land.',
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

  // ── Generated documents ───────────────────────────────────────────────────
  'ApplicantDocumentsController.applicantFile': {
    tag: 'Applicants',
    summary: 'Export the applicant file as a PDF',
    description:
      "The applicant's details and every record on the profile, rendered on demand.",
    response: { type: 'object', properties: { url: { type: 'string' }, fileName: { type: 'string' } } },
    notes:
      'Identity document numbers are deliberately omitted. They are encrypted at rest and ' +
      'every read is logged under DPDP §8(4) — a PDF is exactly the artefact that escapes ' +
      'that control by being forwarded on. Generated per request rather than stored: the ' +
      'document describes the profile as it stands, and a stale copy would look ' +
      'authoritative while being wrong.',
  },
  'RecordDocumentsController.selectionLetter': {
    tag: 'Records',
    summary: 'Download the selection letter',
    description: 'A letter confirming the record was selected, addressed to the applicant.',
    response: { type: 'object', properties: { url: { type: 'string' }, fileName: { type: 'string' } } },
    notes:
      'Refused for a record that has not been selected — the letter is a document NBR has ' +
      'to stand behind, and generating one for a rejected or still-under-review record ' +
      'would put that in writing.',
    errors: {
      '422': { description: 'The record has not reached selection.' },
    },
  },
  'RecordDocumentsController.invoice': {
    tag: 'Payments',
    summary: 'Download the invoice PDF',
    description: 'The issued invoice with its frozen figures and the payments received.',
    response: { type: 'object', properties: { url: { type: 'string' }, fileName: { type: 'string' } } },
    notes:
      'Every figure is read from the invoice row, not the payment plan: the numbers were ' +
      'frozen when the invoice was issued, and a later price change must not retroactively ' +
      'alter a document already sent to an applicant. Requires the invoice number to have ' +
      'been generated first.',
    errors: {
      '422': { description: 'No payment has been raised, or no invoice number issued yet.' },
    },
  },

  // ── Sales & leads ─────────────────────────────────────────────────────────
  'LeadsController.list': {
    tag: 'Sales',
    summary: 'List leads',
    description: 'The calling list, filterable by status, owner, source and follow-up queue.',
    query: [
      { name: 'q', description: 'Name, lead code or phone number.' },
      { name: 'status', description: 'Pipeline stage.', example: 'callback' },
      { name: 'ownerUserId', description: 'Whose list to show.' },
      { name: 'followUp', description: 'due_today | overdue | upcoming', example: 'overdue' },
      ...CURSOR_QUERY,
    ],
    response: arrayOf({ id: UUID, leadCode: { type: 'string' }, fullName: { type: 'string' }, mobile: { type: 'string' }, status: { type: 'string' }, ownerName: { type: 'string', nullable: true }, nextFollowUpAt: { ...ISO, nullable: true }, callCount: { type: 'integer' } }),
    notes:
      'Follow-up queues sort oldest-first — the most overdue is the most urgent. Everything ' +
      'else sorts by most recent activity.',
  },
  'LeadsController.get': {
    tag: 'Sales',
    summary: 'Get a lead',
    description: 'One lead with its full call history, newest call first.',
    response: { type: 'object', properties: { id: UUID, leadCode: { type: 'string' }, calls: arrayOf({ id: UUID, outcome: { type: 'string' }, summary: { type: 'string' }, calledAt: ISO }) } },
  },
  'LeadsController.create': {
    tag: 'Sales',
    summary: 'Add a lead',
    description: 'Creates a lead and assigns it, defaulting to the creator.',
    body: zodSchema(createLeadSchema, 'CreateLead'),
    response: { type: 'object', properties: { id: UUID, leadCode: { type: 'string' } } },
    audited: 'lead.created',
    notes:
      'One open lead per phone number. Two reps working the same number off two imported ' +
      'lists is the classic outbound failure, so a duplicate is refused with a pointer to ' +
      'the existing lead. Closed leads are excluded, so someone who said no last year can ' +
      'be approached again.',
    errors: { '409': { description: 'That number is already an open lead.' } },
  },
  'LeadsController.update': {
    tag: 'Sales',
    summary: 'Update a lead',
    description: 'Edits lead details, ownership, status or the next follow-up date.',
    body: zodSchema(updateLeadSchema, 'UpdateLead'),
    response: OK,
    audited: 'lead.updated',
  },
  'LeadsController.logCall': {
    tag: 'Sales',
    summary: 'Log a call',
    description: 'Records one call attempt, its outcome and any follow-up promised.',
    body: zodSchema(logLeadCallSchema, 'LogLeadCall'),
    response: { type: 'object', properties: { callId: UUID, status: { type: 'string' } } },
    audited: 'lead.call_logged',
    notes:
      'The outcome is an enum, not free text: the evening report counts connected calls ' +
      'against attempts, and a text box would make that uncountable within a week. The ' +
      "lead's status follows from the outcome unless overridden, and an unanswered call " +
      'leaves it untouched — failing to reach someone says nothing about their interest. ' +
      'The call row and the denormalised counters are written in one transaction, so the ' +
      'report can never undercount.',
    errors: { '422': { description: 'A callback outcome needs the date that was promised.' } },
  },
  'LeadsController.convert': {
    tag: 'Sales',
    summary: 'Convert a lead to an applicant',
    description: 'Opens a master applicant profile and a record from the lead.',
    body: zodSchema(convertLeadSchema, 'ConvertLead'),
    response: { type: 'object', properties: { applicantId: UUID, applicantCode: { type: 'string' }, recordId: UUID, recordCode: { type: 'string' } } },
    audited: 'lead.converted',
    notes:
      'Runs the ordinary intake path, so a converted lead gets the same duplicate ' +
      'detection, consent ledger entry and timeline as a walk-in rather than a second, ' +
      'divergent code path. The lead row is kept and marked converted — it carries the ' +
      'call history that explains how the applicant was won.',
    errors: { '422': { description: 'The lead has no email address to open a profile with.' } },
  },
  'LeadsController.remove': {
    tag: 'Sales',
    summary: 'Delete a lead',
    description: 'Soft delete. The call history survives for historical figures.',
    response: OK,
    audited: 'lead.deleted',
  },
  'SalesDashboardController.dashboard': {
    tag: 'Sales',
    summary: 'Sales dashboard',
    description: "One day's calling activity, per person and in total, with the live pipeline.",
    query: [
      { name: 'date', description: 'Defaults to today.' },
      { name: 'ownerUserId', description: 'Narrow to one person.' },
    ],
    response: { type: 'object', properties: { date: { type: 'string' }, totals: { type: 'object' }, reps: arrayOf({ name: { type: 'string' }, callsMade: { type: 'integer' }, connected: { type: 'integer' }, followUpsMissed: { type: 'integer' } }), pipeline: arrayOf({ status: { type: 'string' }, count: { type: 'integer' } }) } },
    notes:
      'The same query backs the evening email, so the figure a manager sees at 4pm and the ' +
      'one that lands at 7pm cannot disagree. "Missed" means a follow-up promised for today ' +
      'or earlier on a still-open lead with no call since — a rep who rang at 9am and moved ' +
      'the date has not missed anything.',
  },
  'SalesDashboardController.sendNow': {
    tag: 'Sales',
    summary: 'Send the daily sales report now',
    description: 'Builds and emails the end-of-day summary immediately.',
    response: { type: 'object', properties: { sent: { type: 'boolean' }, to: arrayOf({}) } },
    notes:
      'Skipped when the day had no calls and nothing missed — an empty table trains people ' +
      'to ignore the email.',
  },

  // ── Employee directory ────────────────────────────────────────────────────
  'EmployeesController.list': {
    tag: 'Administration',
    summary: 'List employees',
    description: 'The staff directory, filterable by department, status and employment type.',
    query: [
      { name: 'q', description: 'Name, employee code, designation or phone.' },
      { name: 'department', description: 'Exact department name.' },
      { name: 'status', description: 'active | on_leave | notice_period | exited', example: 'active' },
      ...CURSOR_QUERY,
    ],
    response: arrayOf({ id: UUID, employeeCode: { type: 'string' }, fullName: { type: 'string' }, department: { type: 'string', nullable: true }, designation: { type: 'string', nullable: true }, status: { type: 'string' } }),
    notes:
      'The list omits the personal block — date of birth, home address, emergency contact — ' +
      'which is returned only when opening one employee.',
  },
  'EmployeesController.departments': {
    tag: 'Administration',
    summary: 'Departments in use',
    description: 'Distinct department names, for the filter bar.',
    response: arrayOf({}),
  },
  'EmployeesController.get': {
    tag: 'Administration',
    summary: 'Get an employee',
    description: 'Full record, including the reporting line and direct reports.',
    response: { type: 'object', properties: { id: UUID, employeeCode: { type: 'string' }, fullName: { type: 'string' }, reportsToName: { type: 'string', nullable: true }, reports: arrayOf({ id: UUID, fullName: { type: 'string' } }) } },
  },
  'EmployeesController.create': {
    tag: 'Administration',
    summary: 'Add an employee',
    description: 'Creates a directory record, allocating an employee code when none is given.',
    body: zodSchema(employeeSchema, 'Employee'),
    response: { type: 'object', properties: { id: UUID, employeeCode: { type: 'string' } } },
    audited: 'employee.created',
    notes:
      'Separate from `users`, which governs login accounts. Not every employee has one — ' +
      'field staff and contractors appear here and never sign in — and an account can be ' +
      'deactivated while the person is still employed. Linking is optional and at most one ' +
      'account per employee.',
    errors: { '422': { description: 'The employee code or linked account is already in use.' } },
  },
  'EmployeesController.update': {
    tag: 'Administration',
    summary: 'Update an employee',
    description: 'Edits a directory record, its reporting line or its linked login account.',
    body: zodSchema(updateEmployeeSchema, 'UpdateEmployee'),
    response: OK,
    audited: 'employee.updated',
    errors: { '422': { description: 'Code clash, account already linked, or self-reporting.' } },
  },
  'EmployeesController.remove': {
    tag: 'Administration',
    summary: 'Delete an employee',
    description: 'Soft delete, for a record created in error.',
    response: OK,
    audited: 'employee.deleted',
    notes:
      'An employee who has left is normally marked Exited rather than deleted: audit ' +
      'entries, records they handled and the reporting line all point at them. Refused ' +
      'while others still report to them.',
    errors: { '409': { description: 'Other employees report to this person.' } },
  },

  'IntegrationsController.reset': {
    tag: 'Integration',
    summary: 'Reset the website mirror',
    description:
      "Clears everything imported from the website so it can be re-pushed clean. Called by " +
      'the website\'s own admin panel, which immediately follows it with a full backfill.',
    response: {
      type: 'object',
      properties: {
        recordsCleared: { type: 'integer' },
        applicantsCleared: { type: 'integer' },
        mirrorsCleared: { type: 'integer' },
        eventsCleared: { type: 'integer' },
      },
    },
    audited: 'integration.import_completed',
    notes:
      'Bounded three ways: only records carrying a `legacy_mirror` row are touched, so ' +
      'anything created in the CRM survives; records and applicants are soft-deleted rather ' +
      'than removed; and the append-only timeline and audit log refuse deletion at the ' +
      'database level. An applicant is cleared only when every record they hold came from ' +
      'the website. Authenticated by HMAC signature, like the application webhook.',
    errors: { '401': { description: 'The signature did not verify.' } },
  },

  // ── Selection letter ──────────────────────────────────────────────────────
  'CommunicationsController.selectionLetterPrefill': {
    tag: 'Communication',
    summary: 'Prefill the selection letter',
    description:
      "The letter's editable fields, filled in from the record — holder name, application " +
      'id, approved title and description, place of origin and date of birth.',
    pathParams: { recordId: 'The record the letter is about.' },
    response: {
      type: 'object',
      properties: {
        fields: { type: 'object' },
        organisation: { type: 'object' },
        attachmentName: { type: 'string' },
      },
    },
    notes:
      'Fetched before the composer opens so the operator corrects facts rather than retyping ' +
      'them. The application id prefers the website\'s own code, which is what an applicant ' +
      'quotes back.',
  },
  'CommunicationsController.sendSelectionLetter': {
    tag: 'Communication',
    summary: 'Send the selection letter',
    description:
      'Sends the approved selection letter to the applicant with the Achiever Pack options ' +
      'PDF attached.',
    pathParams: { recordId: 'The record the letter is about.' },
    body: zodSchema(selectionLetterSchema, 'SelectionLetter'),
    response: {
      type: 'object',
      properties: { communicationId: UUID, status: { type: 'string' } },
    },
    audited: 'communication.email_sent',
    notes:
      'The structure is fixed and only the body fields vary — the terms, the selectivity ' +
      'figure and the two-working-day correction window are not per-letter decisions. ' +
      '`kind` switches the three places a record and an appreciation differ: the titled ' +
      'designation, the section heading and the verb describing the holder. The attachment ' +
      'is unconditional, because the letter instructs the applicant to choose a package ' +
      'from it; a missing file is refused rather than sent without.',
    errors: {
      '422': {
        description: 'The applicant is marked do-not-contact, or the attachment is missing.',
      },
    },
  },

  // ── Website review actions ────────────────────────────────────────────────
  'LegacyActionsController.available': {
    tag: 'Integration',
    summary: 'Website actions available on a record',
    description:
      'Which of the website\'s review decisions can be taken on this record right now, ' +
      'filtered by where the application currently sits.',
    pathParams: { id: 'The record.' },
    response: {
      type: 'object',
      properties: {
        mirrored: { type: 'boolean' },
        externalId: { type: 'string', nullable: true },
        externalUrl: { type: 'string', nullable: true },
        appCode: { type: 'string', nullable: true },
        actions: arrayOf({}),
      },
    },
    notes:
      'Empty for a record created in the CRM: it has no counterpart on the website, so ' +
      'there is nothing over there to decide.',
  },
  'LegacyActionsController.run': {
    tag: 'Integration',
    summary: 'Take a website review decision',
    description:
      'Approve, reject, request information, mark verified, cancel or reopen an ' +
      'application mirrored from the website.',
    pathParams: { id: 'The record.' },
    body: zodSchema(legacyApplicationActionSchema, 'LegacyApplicationAction'),
    response: { type: 'object', properties: { ok: { type: 'boolean' }, action: { type: 'string' } } },
    audited: 'record.status_changed',
    notes:
      'The decision is applied on the website, not here. It owns the applicant\'s portal ' +
      'login, the address they applied with and the mail templates, so approving through ' +
      'this endpoint produces byte-identical mail to approving in its own admin panel. ' +
      'The record moves when the resulting snapshot is pushed back. Awaited rather than ' +
      'queued, so a failure to reach the website is reported rather than swallowed.',
    errors: {
      '422': {
        description:
          'The record is CRM-only, the action is not available at this status, a required ' +
          'reason is missing, or the website refused it.',
      },
    },
  },

  // ── Onboarding documents ──────────────────────────────────────────────────
  'EmployeeDocumentsController.list': {
    tag: 'Administration',
    summary: 'List onboarding documents',
    description: "The employee's joining file — letters, ID proofs, certificates and contracts.",
    pathParams: { employeeId: 'The employee whose file is being read.' },
    response: arrayOf({
      id: UUID,
      kind: { type: 'string' },
      fileName: { type: 'string' },
      contentType: { type: 'string' },
      sizeBytes: { type: 'integer' },
      originalSizeBytes: { type: 'integer', nullable: true },
      isSensitive: { type: 'boolean' },
      uploadedByName: { type: 'string', nullable: true },
    }),
    notes:
      '`originalSizeBytes` is what the file weighed before the browser re-encoded it. It ' +
      'equals `sizeBytes` when the file was stored untouched.',
  },
  'EmployeeDocumentsController.presign': {
    tag: 'Administration',
    summary: 'Get an upload URL for a document',
    description:
      'Step 1 of an upload: returns a short-lived presigned PUT URL. The browser sends the ' +
      'bytes straight to storage, so a scanned contract never passes through the API.',
    pathParams: { employeeId: 'The employee the document belongs to.' },
    body: zodSchema(presignEmployeeDocumentSchema, 'PresignEmployeeDocument'),
    response: {
      type: 'object',
      properties: {
        uploadUrl: { type: 'string' },
        storageKey: { type: 'string' },
        expiresInSeconds: { type: 'integer' },
      },
    },
    errors: { '422': { description: 'File type not accepted, or larger than 20 MB.' } },
  },
  'EmployeeDocumentsController.confirm': {
    tag: 'Administration',
    summary: 'Attach an uploaded document',
    description:
      'Step 2: records the file after checking its real size and type against storage, ' +
      'rather than trusting what the client declared.',
    pathParams: { employeeId: 'The employee the document belongs to.' },
    body: zodSchema(confirmEmployeeDocumentSchema, 'ConfirmEmployeeDocument'),
    response: { type: 'object', properties: { id: UUID } },
    audited: 'employee.document_uploaded',
    notes:
      'Documents holding a government identifier — ID proof, address proof, PAN, bank ' +
      'details — are flagged sensitive, and every opening of one is written to the audit log.',
    errors: {
      '422': {
        description: 'The upload did not complete, or these exact bytes are already on file.',
      },
    },
  },
  'EmployeeDocumentsController.download': {
    tag: 'Administration',
    summary: 'Open a document',
    description:
      'A short-lived signed URL. `mode=inline` renders the file in the preview panel; the ' +
      'default saves it to disk.',
    pathParams: {
      employeeId: 'The employee the document belongs to.',
      documentId: 'The document being opened.',
    },
    query: [{ name: 'mode', description: 'inline | attachment', example: 'inline' }],
    response: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        fileName: { type: 'string' },
        contentType: { type: 'string' },
      },
    },
    notes:
      'Lookups are scoped to the employee in the path, so a document id cannot be read ' +
      'through a different profile.',
  },
  'EmployeeDocumentsController.remove': {
    tag: 'Administration',
    summary: 'Remove a document',
    description: 'Soft delete, for a mis-scan or a duplicate.',
    pathParams: {
      employeeId: 'The employee the document belongs to.',
      documentId: 'The document being removed.',
    },
    response: OK,
    audited: 'employee.document_deleted',
    notes:
      'The row and the stored object both survive — only the listing stops showing it — so ' +
      'a file removed by mistake can still be produced.',
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
        retired: { type: 'integer' },
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
  'IntegrationsController.receiveImportedCertificate': {
    tag: 'Integration',
    summary: 'Inbound: an offline certificate imported on the website',
    description:
      'Fired by the website when a certificate is imported through its Certificates → ' +
      'Import screen. Kept off the applications webhook because these carry no ' +
      'application and that payload is parsed as an application snapshot. Keyed on the ' +
      'certificate number, so a redelivery refreshes the row rather than duplicating it. ' +
      'Authenticated by HMAC signature, not by session.',
    response: {
      type: 'object',
      properties: {
        certificateNumber: { type: 'string' },
        created: { type: 'boolean', description: 'False when an existing row was refreshed.' },
      },
    },
    errors: {
      '401': { description: 'The signature did not verify.' },
      '422': { description: 'The payload did not match the expected shape.' },
    },
  },
  'ImportedRecordsController.list': {
    tag: 'Integration',
    summary: 'List imported records',
    description:
      "Offline certificates mirrored from the public website. These have no application " +
      'behind them and are deliberately kept out of the applicant pipeline.',
    query: [
      { name: 'search', description: 'Holder name, record title or certificate number.', schema: { type: 'string' } },
      { name: 'limit', description: 'Page size, capped at 200.', schema: { type: 'integer' } },
      { name: 'offset', description: 'Rows to skip.', schema: { type: 'integer' } },
    ],
    response: { type: 'object' },
  },
  'ImportedRecordsController.get': {
    tag: 'Integration',
    summary: 'One imported record with its activity',
    description: 'The mirrored certificate plus every note, task and message logged against it.',
    response: { type: 'object' },
    errors: { '404': { description: 'No imported record with that id.' } },
  },
  'ImportedRecordsController.sync': {
    tag: 'Integration',
    summary: 'Pull offline certificates from the website',
    description:
      'Keyed on the certificate number, so re-running refreshes rather than duplicates. ' +
      'Reads only what is newer than the latest issue date held, unless `full` is set.',
    response: {
      type: 'object',
      properties: {
        imported: { type: 'integer' },
        updated: { type: 'integer' },
        total: { type: 'integer' },
      },
    },
    errors: {
      '422': { description: 'The integration is not configured, or the website rejected the request.' },
    },
  },
  'ImportedRecordsController.addActivity': {
    tag: 'Integration',
    summary: 'Send an email or WhatsApp message, or add a note or task',
    description:
      'The four actions permitted on an imported record. Held separately from the ' +
      'communications and tasks tables, which are keyed to a record id these do not have. ' +
      '`email` is sent over SMTP before the row is written, and `status` reports the ' +
      'outcome. `whatsapp` returns a `whatsappUrl` click-to-chat link for the operator to ' +
      'send from their own account — the WhatsApp Business API is deferred to a later phase.',
    response: {
      type: 'object',
      properties: {
        id: UUID,
        status: { type: 'string', nullable: true, description: 'sent | failed | logged' },
        whatsappUrl: { type: 'string', nullable: true },
      },
    },
    errors: {
      '422': {
        description:
          'The record has no email or phone number, or the message could not be delivered.',
      },
    },
  },
  'ImportedRecordsController.complete': {
    tag: 'Integration',
    summary: 'Mark an imported-record task complete',
    description: 'Sets completedAt. Applies only to activity of kind "task".',
    response: { type: 'object', properties: { completed: { type: 'boolean' } } },
  },
  'IntegrationsController.syncCategories': {
    tag: 'Integration',
    summary: 'Sync categories from the website',
    description:
      "Mirrors the public website's category list into this system, matched on slug. " +
      'Categories the website does not offer are deactivated, never deleted.',
    response: {
      type: 'object',
      properties: {
        imported: { type: 'integer' },
        updated: { type: 'integer' },
        retired: { type: 'integer' },
        categories: { type: 'array', items: { type: 'string' } },
      },
    },
    notes:
      'Applications are created on the website against its own categories. Any list held ' +
      'here that differs means every import arrives with a category name this system ' +
      'cannot match — "Sports" against "Sports & Adventure" — raising an operator alert ' +
      'for a mismatch nobody can resolve, since the applicant only ever saw the ' +
      "website's list. Matched on slug so a rename over there updates the row here " +
      'rather than orphaning it.',
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
  'IntegrationsController.packagesChanged': {
    tag: 'Integration',
    summary: 'Website plan catalogue changed',
    description:
      'The website telling this system its packages changed, so the catalogue is re-read ' +
      'immediately instead of waiting for someone to run the sync by hand.',
    response: {
      type: 'object',
      properties: {
        imported: { type: 'integer' },
        updated: { type: 'integer' },
        skipped: { type: 'integer' },
        retired: { type: 'integer' },
      },
    },
    notes:
      'Carries no package data on purpose — it triggers the same pull as the manual sync, ' +
      'so there is one importer rather than two that can disagree. Signed with the shared ' +
      'webhook secret; the body is the literal "{}".',
  },
  'IntegrationsController.knownIds': {
    tag: 'Integration',
    summary: 'Applications this CRM holds',
    description:
      'Every website application id currently mirrored here, so the website can work out ' +
      'what it still needs to send.',
    response: {
      type: 'object',
      properties: {
        externalIds: arrayOf({ type: 'string' }),
        count: { type: 'integer' },
      },
    },
    notes:
      'The website used to decide what to sync from its own outbound log — what it ' +
      'believed it had sent — which drifts from what this CRM actually holds the moment ' +
      'anything is deleted here or restored from an older backup. This is the ' +
      'authoritative answer. Signed with the shared webhook secret rather than a session, ' +
      'because the caller is the website, not a user; soft-deleted records are excluded, ' +
      'so a record removed here is offered for resend.',
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
