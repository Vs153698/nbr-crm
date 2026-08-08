import { z } from 'zod';
import { CALL_OUTCOME, LEAD_SOURCE, LEAD_STATUS } from '../constants/sales';
import { EMPLOYEE_DOCUMENT_KIND, EMPLOYEE_STATUS, EMPLOYMENT_TYPE } from '../constants/hr';
import {
  cursorQuerySchema,
  emailSchema,
  indianMobileSchema,
  optionalTrimmedString,
  phoneSchema,
  pincodeSchema,
  trimmedString,
  uuidSchema,
} from './common';

// ── Leads ────────────────────────────────────────────────────────────────────

export const createLeadSchema = z.object({
  fullName: trimmedString(150),
  mobile: indianMobileSchema,
  email: emailSchema.optional(),
  city: optionalTrimmedString(100),
  state: optionalTrimmedString(100),
  achievementSummary: optionalTrimmedString(2000),
  category: optionalTrimmedString(150),
  source: z.nativeEnum(LEAD_SOURCE).default(LEAD_SOURCE.COLD_CALL),
  sourceDetail: optionalTrimmedString(200),
  /** Defaults to the creator when omitted — an unowned lead is nobody's job. */
  ownerUserId: uuidSchema.optional(),
  nextFollowUpAt: z.coerce.date().optional(),
  notes: optionalTrimmedString(4000),
});

export type CreateLeadInput = z.infer<typeof createLeadSchema>;

export const updateLeadSchema = createLeadSchema.partial().extend({
  status: z.nativeEnum(LEAD_STATUS).optional(),
  lostReason: optionalTrimmedString(300),
});

/**
 * Logging a call.
 *
 * `summary` is required and `outcome` is an enum rather than free text: the
 * whole point of the evening report is counting connected calls against
 * attempts, and a text box would make that uncountable within a week.
 */
export const logLeadCallSchema = z
  .object({
    outcome: z.nativeEnum(CALL_OUTCOME),
    summary: trimmedString(4000),
    durationMinutes: z.coerce.number().int().min(0).max(600).optional(),
    /** The commitment. Required when the outcome is a callback request. */
    followUpAt: z.coerce.date().optional(),
    /** Where the lead lands as a result. Defaults from the outcome. */
    resultingStatus: z.nativeEnum(LEAD_STATUS).optional(),
    calledAt: z.coerce.date().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.outcome === CALL_OUTCOME.CALLBACK_REQUESTED && !value.followUpAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['followUpAt'],
        message: 'Give the callback date the lead asked for — that is the commitment being made.',
      });
    }
  });

export type LogLeadCallInput = z.infer<typeof logLeadCallSchema>;

/** Turning a lead into a real applicant + record. */
export const convertLeadSchema = z.object({
  categoryId: uuidSchema,
  recordTitle: trimmedString(1400),
  description: optionalTrimmedString(5000),
  /** Reuse an existing profile instead of creating one, when the rep spotted it. */
  existingApplicantId: uuidSchema.optional(),
  /** Proceed past a duplicate warning. */
  override: z.boolean().default(false),
  overrideReason: optionalTrimmedString(500),
});

export const leadListQuerySchema = cursorQuerySchema.extend({
  q: optionalTrimmedString(120),
  status: z.nativeEnum(LEAD_STATUS).optional(),
  ownerUserId: uuidSchema.optional(),
  source: z.nativeEnum(LEAD_SOURCE).optional(),
  /** The two operational queues the board is built around. */
  followUp: z.enum(['due_today', 'overdue', 'upcoming']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const salesDashboardQuerySchema = z.object({
  /** Defaults to today in the configured timezone. */
  date: z.coerce.date().optional(),
  /** Narrow to one rep; omitted means the whole team. */
  ownerUserId: uuidSchema.optional(),
});

// ── Employees ────────────────────────────────────────────────────────────────

/**
 * A hand-typed employee ID.
 *
 * Uppercased on the way in so `nbremp014` and `NBREMP014` cannot both exist —
 * the uniqueness index is case-sensitive, and two rows for one person is
 * exactly the failure this ID is meant to prevent. Punctuation is limited to
 * the separators real ID formats use.
 */
export const employeeCodeSchema = z
  .string()
  .trim()
  .min(2, 'An employee ID needs at least 2 characters.')
  .max(30)
  .regex(/^[A-Za-z0-9][A-Za-z0-9/_-]*$/, 'Use letters, numbers, and - / _ only.')
  .transform((value) => value.toUpperCase());

export const employeeSchema = z.object({
  /**
   * Normally typed in by HR so the directory matches the ID already printed on
   * the card and quoted by payroll. Allocated automatically only when omitted.
   */
  employeeCode: employeeCodeSchema.optional(),
  fullName: trimmedString(150),
  mobile: indianMobileSchema,
  alternatePhone: phoneSchema.optional(),
  personalEmail: emailSchema.optional(),
  workEmail: emailSchema.optional(),
  dateOfBirth: z.coerce.date().optional(),
  gender: optionalTrimmedString(20),
  photoKey: optionalTrimmedString(500),

  department: optionalTrimmedString(120),
  designation: optionalTrimmedString(120),
  employmentType: z.nativeEnum(EMPLOYMENT_TYPE).default(EMPLOYMENT_TYPE.FULL_TIME),
  status: z.nativeEnum(EMPLOYEE_STATUS).default(EMPLOYEE_STATUS.ACTIVE),
  joinedOn: z.coerce.date().optional(),
  exitedOn: z.coerce.date().optional(),
  workLocation: optionalTrimmedString(150),
  reportsToEmployeeId: uuidSchema.optional().nullable(),
  /** Link to a login account, when the employee has one. */
  userId: uuidSchema.optional().nullable(),

  addressLine: optionalTrimmedString(300),
  city: optionalTrimmedString(100),
  state: optionalTrimmedString(100),
  pincode: pincodeSchema.optional(),

  emergencyContactName: optionalTrimmedString(150),
  emergencyContactPhone: phoneSchema.optional(),
  emergencyContactRelation: optionalTrimmedString(60),

  notes: optionalTrimmedString(4000),
  isDirectoryVisible: z.boolean().default(true),
});

export type EmployeeInput = z.infer<typeof employeeSchema>;

export const updateEmployeeSchema = employeeSchema.partial();

export const employeeListQuerySchema = cursorQuerySchema.extend({
  q: optionalTrimmedString(120),
  department: optionalTrimmedString(120),
  status: z.nativeEnum(EMPLOYEE_STATUS).optional(),
  employmentType: z.nativeEnum(EMPLOYMENT_TYPE).optional(),
  /**
   * Raised above the shared page cap, which the service already allowed for:
   * the "Reports to" picker needs the whole directory in one call, and anyone
   * missing from that list simply cannot be chosen as a manager.
   */
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// ── Onboarding documents ─────────────────────────────────────────────────────

export const presignEmployeeDocumentSchema = z.object({
  fileName: trimmedString(255),
  contentType: trimmedString(120),
  sizeBytes: z.coerce.number().int().positive(),
});

export const confirmEmployeeDocumentSchema = z.object({
  kind: z.nativeEnum(EMPLOYEE_DOCUMENT_KIND),
  storageKey: trimmedString(500),
  fileName: trimmedString(255),
  contentType: trimmedString(120),
  sizeBytes: z.coerce.number().int().positive(),
  /**
   * What the file weighed before the browser re-encoded it. Recorded so the
   * saving is a measured number on screen rather than a claim, and so a
   * suspiciously lossy compression is visible after the fact.
   */
  originalSizeBytes: z.coerce.number().int().positive().optional(),
  checksumSha256: z.string().length(64).optional(),
  description: optionalTrimmedString(500),
});
