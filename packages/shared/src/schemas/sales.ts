import { z } from 'zod';
import { CALL_OUTCOME, LEAD_SOURCE, LEAD_STATUS } from '../constants/sales';
import { EMPLOYEE_STATUS, EMPLOYMENT_TYPE } from '../constants/hr';
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
  recordTitle: trimmedString(1000),
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

export const employeeSchema = z.object({
  /** Allocated automatically when omitted. */
  employeeCode: optionalTrimmedString(30),
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
});
