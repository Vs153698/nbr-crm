import { z } from 'zod';
import {
  APPLICATION_SOURCE,
  GENDER,
  RECORD_TYPE,
} from '../constants/catalog';
import { CONSENT_ARTEFACT, CONSENT_CHANNEL, PROCESSING_PURPOSE } from '../constants/dpdp';
import { RECORD_STATUS } from '../constants/statuses';
import {
  cursorQuerySchema,
  emailSchema,
  indianMobileSchema,
  optionalTrimmedString,
  phoneSchema,
  pincodeSchema,
  sortQuerySchema,
  trimmedString,
  uuidSchema,
} from './common';

/**
 * Master applicant profile (§4). One person = one profile, forever. Repeat
 * applicants get a new *record*, never a new applicant row.
 */
export const applicantCoreSchema = z.object({
  fullName: trimmedString(150),
  fatherName: optionalTrimmedString(150),
  motherName: optionalTrimmedString(150),
  dateOfBirth: z.coerce
    .date()
    .refine((d) => d <= new Date(), { message: 'Date of birth cannot be in the future' })
    .refine((d) => d.getFullYear() >= 1900, { message: 'Enter a valid date of birth' })
    .optional(),
  gender: z.nativeEnum(GENDER).optional(),
  mobile: indianMobileSchema,
  whatsapp: phoneSchema.optional(),
  email: emailSchema,
  addressLine: optionalTrimmedString(300),
  city: optionalTrimmedString(100),
  state: optionalTrimmedString(100),
  country: trimmedString(100).default('India'),
  pincode: pincodeSchema.optional(),
  nationality: optionalTrimmedString(100),
  photoKey: optionalTrimmedString(500),
});

/**
 * Government identifiers live behind their own schema because they are
 * encrypted at rest, masked in every list, and only readable with `pii:reveal`
 * (DPDP §8(4) reasonable security safeguards).
 */
export const applicantIdentifiersSchema = z.object({
  aadhaarNumber: z
    .string()
    .transform((v) => v.replace(/\s/g, ''))
    .pipe(z.string().regex(/^[2-9]\d{11}$/, 'Aadhaar must be 12 digits'))
    .optional(),
  passportNumber: z
    .string()
    .transform((v) => v.trim().toUpperCase())
    .pipe(z.string().min(6).max(20))
    .optional(),
  panNumber: z
    .string()
    .transform((v) => v.trim().toUpperCase())
    .pipe(z.string().regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'Enter a valid PAN'))
    .optional(),
});

/** §6 Achievement details, captured with the record. */
export const achievementSchema = z.object({
  recordTitle: trimmedString(1400),
  categoryId: uuidSchema,
  recordType: z.nativeEnum(RECORD_TYPE).default(RECORD_TYPE.INDIVIDUAL),
  description: optionalTrimmedString(5000),
  /** Set by the verification team; what actually gets printed. */
  approvedDescription: optionalTrimmedString(5000),
  achievementDate: z.coerce.date().optional(),
  location: optionalTrimmedString(250),
  participantCount: z.coerce.number().int().min(1).max(1_000_000).default(1),
});

/**
 * DPDP §6 consent block. Captured at intake for every purpose, with the notice
 * version the applicant actually saw. Essential purposes must be accepted for
 * the application to proceed; optional ones (publicity, dispatch) are free to
 * decline and can be withdrawn later without breaking the record.
 */
export const consentBlockSchema = z.object({
  purposes: z
    .array(z.nativeEnum(PROCESSING_PURPOSE))
    .min(1, 'At least the essential purposes must be accepted'),
  artefacts: z.array(z.nativeEnum(CONSENT_ARTEFACT)).default([]),
  channel: z.nativeEnum(CONSENT_CHANNEL),
  noticeVersion: trimmedString(20),
  /** Required when the applicant is under 18 (DPDP §9). */
  guardianName: optionalTrimmedString(150),
  guardianRelationship: optionalTrimmedString(60),
  guardianContact: phoneSchema.optional(),
  /** R2 key of the signed consent form, when one exists. */
  evidenceKey: optionalTrimmedString(500),
});

/** Statuses a genuinely new record may start at. */
const INTAKE_STATUSES: readonly string[] = [
  RECORD_STATUS.NEW_LEAD,
  RECORD_STATUS.APPLICATION_SUBMITTED,
  RECORD_STATUS.UNDER_REVIEW,
];

/** Payload for the Add Applicant screen (W-05): person + first record in one go. */
export const createApplicantSchema = z.object({
  applicant: applicantCoreSchema,
  identifiers: applicantIdentifiersSchema.optional(),
  record: z
    .object({
      source: z.nativeEnum(APPLICATION_SOURCE).default(APPLICATION_SOURCE.WALK_IN),
      assignedToUserId: uuidSchema.optional(),
      initialStatus: z.nativeEnum(RECORD_STATUS).default(RECORD_STATUS.NEW_LEAD),
      internalRemarks: optionalTrimmedString(2000),
      achievement: achievementSchema,

      /**
       * Back-entry, exactly as on Add Record — an applicant recognised before
       * this system existed is most often entered here, on their first visit,
       * not as a second record on a profile that does not yet exist.
       */
      existingRecordCode: optionalTrimmedString(20),
      existingCertificateNumber: optionalTrimmedString(80),
      originallyAwardedOn: z.coerce.date().optional(),
    })
    .superRefine((value, ctx) => {
      const isBackEntry = Boolean(value.existingRecordCode);

      if (!isBackEntry && !INTAKE_STATUSES.includes(value.initialStatus)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['initialStatus'],
          message:
            'A new record can only start at lead, submitted or under-review. To enter a record NBR has already awarded, supply its existing record number.',
        });
      }

      if (value.existingCertificateNumber && !isBackEntry) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['existingCertificateNumber'],
          message: 'Supply the existing record number as well when entering a past record.',
        });
      }
    }),
  consent: consentBlockSchema.optional(),
  /** Set by an Admin to proceed past a duplicate or blacklist warning (§18, §19). */
  overrideDuplicate: z.boolean().default(false),
  overrideReason: optionalTrimmedString(500),
});

export type CreateApplicantInput = z.infer<typeof createApplicantSchema>;

export const updateApplicantSchema = z.object({
  applicant: applicantCoreSchema.partial(),
  identifiers: applicantIdentifiersSchema.partial().optional(),
  /** Optimistic lock — rejects the write if someone else saved in the meantime. */
  expectedUpdatedAt: z.coerce.date().optional(),
});

/** §18 Duplicate Detection — runs while the user types. */
export const duplicateCheckSchema = z
  .object({
    mobile: z.string().optional(),
    email: z.string().optional(),
    fullName: z.string().optional(),
    dateOfBirth: z.coerce.date().optional(),
    aadhaarNumber: z.string().optional(),
    passportNumber: z.string().optional(),
    /** Exclude this applicant from the results when editing an existing profile. */
    excludeApplicantId: uuidSchema.optional(),
  })
  .refine(
    (v) => Boolean(v.mobile || v.email || v.fullName || v.aadhaarNumber || v.passportNumber),
    { message: 'Provide at least one identifier to check' },
  );

export type DuplicateCheckInput = z.infer<typeof duplicateCheckSchema>;

export const DUPLICATE_MATCH_REASON = {
  MOBILE: 'mobile',
  EMAIL: 'email',
  AADHAAR: 'aadhaar',
  PASSPORT: 'passport',
  NAME_DOB: 'name_dob',
  FUZZY_NAME: 'fuzzy_name',
} as const;

export type DuplicateMatchReason =
  (typeof DUPLICATE_MATCH_REASON)[keyof typeof DUPLICATE_MATCH_REASON];

export interface DuplicateMatch {
  readonly applicantId: string;
  readonly applicantCode: string;
  readonly fullName: string;
  readonly maskedMobile: string;
  readonly maskedEmail: string;
  readonly city: string | null;
  readonly recordCount: number;
  readonly reasons: readonly DuplicateMatchReason[];
  /** 0–1. Exact identifier hits score 1; trigram name matches score similarity. */
  readonly confidence: number;
  readonly isBlacklisted: boolean;
}

/** Applicant list query (§3) — server-side search, filter, sort, cursor page. */
export const applicantListQuerySchema = cursorQuerySchema.merge(sortQuerySchema).extend({
  q: optionalTrimmedString(200),
  status: z.array(z.nativeEnum(RECORD_STATUS)).optional(),
  assignedToUserId: z.array(uuidSchema).optional(),
  categoryId: z.array(uuidSchema).optional(),
  source: z.array(z.nativeEnum(APPLICATION_SOURCE)).optional(),
  paymentStatus: z.array(z.string().max(30)).optional(),
  deliveryStatus: z.array(z.string().max(30)).optional(),
  flag: z.array(z.string().max(30)).optional(),
  createdFrom: z.coerce.date().optional(),
  createdTo: z.coerce.date().optional(),
  updatedFrom: z.coerce.date().optional(),
  updatedTo: z.coerce.date().optional(),
  includeBlacklisted: z.coerce.boolean().default(true),
});

export type ApplicantListQuery = z.infer<typeof applicantListQuerySchema>;

/**
 * Add a further record to an existing applicant (§4 "Person → Record #1 →
 * Record #2 → Record #3"). Deliberately has no `applicant` block — a returning
 * applicant's personal details are already on file and are edited through the
 * profile, not re-entered per record.
 */
export const addRecordSchema = z
  .object({
    source: z.nativeEnum(APPLICATION_SOURCE).default(APPLICATION_SOURCE.WALK_IN),
    assignedToUserId: uuidSchema.optional(),
    initialStatus: z.nativeEnum(RECORD_STATUS).default(RECORD_STATUS.NEW_LEAD),
    internalRemarks: optionalTrimmedString(2000),
    achievement: achievementSchema,
    /** Admin override when the applicant is blacklisted (§19). */
    override: z.boolean().default(false),
    overrideReason: optionalTrimmedString(500),

    /**
     * ── Back-entry of a record NBR already awarded ────────────────────────────
     *
     * A holder who was recognised before this system existed arrives with a
     * record number already printed on their certificate. Minting them a fresh
     * one would put two different numbers on the same achievement, so their own
     * number is carried across instead of generated.
     *
     * Supplying it is also what marks the record as historical, which is why the
     * status rules below relax only when it is present: an entry that is
     * recording the past legitimately starts at Completed, while a genuinely new
     * application must still begin at the top of the workflow.
     */
    existingRecordCode: optionalTrimmedString(20),
    /** The number printed on the certificate they already hold. */
    existingCertificateNumber: optionalTrimmedString(80),
    /** When the record was originally awarded, for the timeline. */
    originallyAwardedOn: z.coerce.date().optional(),
  })
  .superRefine((value, ctx) => {
    const isBackEntry = Boolean(value.existingRecordCode);

    if (!isBackEntry && !INTAKE_STATUSES.includes(value.initialStatus)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['initialStatus'],
        message:
          'A new record can only start at lead, submitted or under-review. To enter a record NBR has already awarded, supply its existing record number.',
      });
    }

    // A certificate number without a record number is a half-told story: there
    // is nothing to attach it to that would not itself be newly invented.
    if (value.existingCertificateNumber && !isBackEntry) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['existingCertificateNumber'],
        message: 'Supply the existing record number as well when entering a past record.',
      });
    }
  });

export type AddRecordInput = z.infer<typeof addRecordSchema>;
