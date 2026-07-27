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
import { zodBody } from '../common/zod-validation.pipe';
import { Can, CurrentUser } from '../auth/auth.decorators';
import type { Actor } from '../common/request-context';
import { PiiService, type IdentifierField } from '../privacy/pii.service';
import { TimelineService } from '../timeline/timeline.service';
import { ApplicantsService, type CreateApplicantResult } from './applicants.service';
import { DuplicateService } from './duplicate.service';

@Controller('applicants')
export class ApplicantsController {
  constructor(
    private readonly applicants: ApplicantsService,
    private readonly duplicates: DuplicateService,
    private readonly pii: PiiService,
    private readonly timeline: TimelineService,
  ) {}

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
