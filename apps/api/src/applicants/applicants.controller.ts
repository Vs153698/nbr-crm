import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import {
  ACTIONS,
  MODULES,
  createApplicantSchema,
  duplicateCheckSchema,
  updateApplicantSchema,
  uuidSchema,
  type CreateApplicantInput,
  type DuplicateCheckInput,
  type DuplicateMatch,
} from '@nbr/shared';
import { revealIdentifierSchema } from '@nbr/shared';
import { addRecordSchema, applicantListQuerySchema, type AddRecordInput } from '@nbr/shared';
import { zodBody } from '../common/zod-validation.pipe';
import { Can, CurrentUser } from '../auth/auth.decorators';
import { Enveloped } from '../common/response.interceptor';
import type { Actor } from '../common/request-context';
import { PiiService, type IdentifierField } from '../privacy/pii.service';
import { TimelineService } from '../timeline/timeline.service';
import { AddRecordService } from './add-record.service';
import { ApplicantListService, type ApplicantListRow } from './applicant-list.service';
import { ApplicantsService, type CreateApplicantResult } from './applicants.service';
import { DuplicateService } from './duplicate.service';

@Controller('applicants')
export class ApplicantsController {
  constructor(
    private readonly applicants: ApplicantsService,
    private readonly applicantList: ApplicantListService,
    private readonly addRecord: AddRecordService,
    private readonly duplicates: DuplicateService,
    private readonly pii: PiiService,
    private readonly timeline: TimelineService,
  ) {}

  /**
   * The applicant list (§3, W-04).
   *
   * Filters arrive as repeated query params (`?status=a&status=b`), which
   * Fastify hands over as a string when there is one and an array when there
   * are several — normalised here before validation so the schema sees a
   * consistent shape either way.
   */
  @Get()
  @Can(MODULES.APPLICANTS, ACTIONS.VIEW)
  async list(@Query() rawQuery: Record<string, unknown>): Promise<Enveloped<ApplicantListRow[]>> {
    const query = applicantListQuerySchema.parse(normaliseArrayParams(rawQuery));
    const result = await this.applicantList.list(query);

    return new Enveloped(result.items, {
      nextCursor: result.nextCursor,
      total: result.total,
      limit: query.limit,
    });
  }

  @Post()
  @Can(MODULES.APPLICANTS, ACTIONS.CREATE)
  async create(
    @Body(zodBody(createApplicantSchema)) body: CreateApplicantInput,
  ): Promise<CreateApplicantResult> {
    return this.applicants.create(body);
  }

  /**
   * Live duplicate check (§18). Called on blur from the mobile, email and name
   * fields while the user is still typing, so the warning appears before they
   * have filled in the whole form.
   */
  @Post('check-duplicate')
  @Can(MODULES.APPLICANTS, ACTIONS.VIEW)
  async checkDuplicate(
    @Body(zodBody(duplicateCheckSchema)) body: DuplicateCheckInput,
  ): Promise<{ matches: DuplicateMatch[]; blocking: boolean }> {
    const matches = await this.duplicates.check(body);
    return { matches, blocking: DuplicateService.isBlocking(matches) };
  }

  /** Everything behind the main working screen in one round trip (H-06). */
  @Get(':id/full')
  @Can(MODULES.APPLICANTS, ACTIONS.VIEW)
  async getFull(@Param('id') id: string): Promise<Record<string, unknown>> {
    return this.applicants.getFull(uuidSchema.parse(id));
  }

  @Put(':id')
  @Can(MODULES.APPLICANTS, ACTIONS.EDIT)
  async update(
    @Param('id') id: string,
    @Body(zodBody(updateApplicantSchema)) body: Record<string, never>,
  ): Promise<{ ok: true }> {
    await this.applicants.update(uuidSchema.parse(id), body as never);
    return { ok: true };
  }

  /**
   * Open another record on an existing profile (§4).
   *
   * This is the "same person applied again" path — it never creates a second
   * applicant row, which is the invariant the whole duplicate-detection layer
   * exists to protect.
   */
  @Post(':id/records')
  @Can(MODULES.RECORDS, ACTIONS.CREATE)
  async createRecord(
    @Param('id') id: string,
    @Body(zodBody(addRecordSchema)) body: AddRecordInput,
  ): Promise<{ recordId: string; recordCode: string }> {
    return this.addRecord.addRecord(uuidSchema.parse(id), body as never);
  }

  /** Every certificate ever issued to this applicant, across all their records. */
  @Get(':id/certificates')
  @Can(MODULES.CERTIFICATES, ACTIONS.VIEW)
  async certificateHistory(@Param('id') id: string) {
    return this.addRecord.getCertificateHistory(uuidSchema.parse(id));
  }

  @Get(':id/timeline')
  @Can(MODULES.APPLICANTS, ACTIONS.VIEW)
  async timelineFeed(
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.timeline.list({
      applicantId: uuidSchema.parse(id),
      cursor,
      limit: limit ? Number(limit) : undefined,
    });
  }

  /**
   * Decrypt one government identifier.
   *
   * Separate endpoint rather than a field on the profile payload, because
   * every reveal must be individually justified and individually logged
   * (DPDP §8(4)). The reason the user types is written verbatim to
   * `pii_access_log` before the value is returned.
   */
  @Post(':id/reveal-identifier')
  @Can(MODULES.PII, ACTIONS.REVEAL)
  async reveal(
    @Param('id') id: string,
    @Body(zodBody(revealIdentifierSchema))
    body: { field: IdentifierField; reason: string },
    @CurrentUser() _actor: Actor,
  ): Promise<{ field: string; value: string }> {
    return this.pii.reveal(uuidSchema.parse(id), body.field, body.reason);
  }
}

/**
 * Fastify gives `?status=a` as a string and `?status=a&status=b` as an array.
 * The list schema expects arrays for its multi-select filters, so single
 * values are wrapped before parsing — otherwise picking one status filter
 * fails validation while picking two succeeds.
 */
const ARRAY_PARAMS = new Set([
  'status',
  'assignedToUserId',
  'categoryId',
  'source',
  'paymentStatus',
  'deliveryStatus',
  'flag',
]);

function normaliseArrayParams(query: Record<string, unknown>): Record<string, unknown> {
  const normalised: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(query)) {
    if (ARRAY_PARAMS.has(key) && value !== undefined && !Array.isArray(value)) {
      normalised[key] = [value];
    } else {
      normalised[key] = value;
    }
  }

  return normalised;
}
