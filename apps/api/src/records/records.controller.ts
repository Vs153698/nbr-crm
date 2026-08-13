import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import {
  ACTIONS,
  MODULES,
  assignRecordSchema,
  changeStatusSchema,
  officialRecordDetailsSchema,
  uuidSchema,
  markProgressSchema,
  type ClientProgress,
  type ClientProgressStage,
  type MarkProgressInput,
  type OfficialRecordDetailsInput,
  type RecordStatus,
} from '@nbr/shared';
import { Can } from '../auth/auth.decorators';
import { zodBody } from '../common/zod-validation.pipe';
import { TimelineService } from '../timeline/timeline.service';
import { ClientProgressService } from './client-progress.service';
import { RecordDetailsService } from './record-details.service';
import { WorkflowService, type SmartActionPanel } from './workflow.service';

@Controller('records')
export class RecordsController {
  constructor(
    private readonly workflow: WorkflowService,
    private readonly timeline: TimelineService,
    private readonly clientProgressService: ClientProgressService,
    private readonly recordDetails: RecordDetailsService,
  ) {}

  /**
   * The Smart Workflow Engine panel for this record's current stage (§11).
   * Computed server-side so every client shows the same next steps, and so a
   * client cannot invent an action it isn't entitled to.
   */
  @Get(':id/actions')
  @Can(MODULES.RECORDS, ACTIONS.VIEW)
  async actions(@Param('id') id: string): Promise<SmartActionPanel> {
    return this.workflow.getActionPanel(uuidSchema.parse(id));
  }

  /**
   * The eleven-stage progress badge NBR reports to its client.
   *
   * A separate, read-only projection rather than a field on the record: it is
   * derived from dated facts scattered across the timeline, payments,
   * certificates, dispatch and evidence, and folding that into every record
   * response would make eight extra queries on every list render for something
   * only the detail view shows.
   *
   * Reports what has happened, never where the record sits — see
   * `ClientProgressService`.
   */
  @Get(':id/client-progress')
  @Can(MODULES.RECORDS, ACTIONS.VIEW)
  async clientProgress(@Param('id') id: string): Promise<ClientProgress> {
    return this.clientProgressService.forRecord(uuidSchema.parse(id));
  }

  /**
   * Record a stage by hand.
   *
   * For something that happened where the CRM was not there to see it — a photo
   * sent over WhatsApp, a delivery confirmed on the phone. The badge keeps
   * showing it as hand-marked, and a derived fact always takes precedence.
   */
  @Post(':id/client-progress/:stage')
  @Can(MODULES.RECORDS, ACTIONS.MARK_PROGRESS)
  async markProgress(
    @Param('id') id: string,
    @Param('stage') stage: string,
    @Body(zodBody(markProgressSchema)) body: MarkProgressInput,
  ): Promise<{ ok: true }> {
    return this.clientProgressService.mark(
      uuidSchema.parse(id),
      stage as ClientProgressStage,
      body,
    );
  }

  /** Withdraw a hand-marked stage; the derived answer takes over again. */
  @Delete(':id/client-progress/:stage')
  @Can(MODULES.RECORDS, ACTIONS.MARK_PROGRESS)
  async clearProgressMark(
    @Param('id') id: string,
    @Param('stage') stage: string,
  ): Promise<{ ok: true }> {
    return this.clientProgressService.clearMark(uuidSchema.parse(id), stage as ClientProgressStage);
  }

  /**
   * NBR's own wording for the record, and what was recognised.
   *
   * Deliberately cannot reach the applicant's title or description — the schema
   * behind it carries only the three official fields, so the separation is a
   * property of the contract rather than a rule the next handler has to keep.
   */
  @Post(':id/official-details')
  @Can(MODULES.RECORDS, ACTIONS.EDIT)
  async updateOfficialDetails(
    @Param('id') id: string,
    @Body(zodBody(officialRecordDetailsSchema)) body: OfficialRecordDetailsInput,
  ): Promise<{ ok: true }> {
    return this.recordDetails.updateOfficial(uuidSchema.parse(id), body);
  }

  @Post(':id/status')
  @Can(MODULES.RECORDS, ACTIONS.CHANGE_STATUS)
  async changeStatus(
    @Param('id') id: string,
    @Body(zodBody(changeStatusSchema))
    body: {
      toStatus: RecordStatus;
      remark?: string;
      override: boolean;
      overrideReason?: string;
      expectedUpdatedAt?: Date;
    },
  ): Promise<{ status: RecordStatus }> {
    return this.workflow.changeStatus(uuidSchema.parse(id), body);
  }

  /** §11 "Assign employee". Pass null to clear the assignment. */
  @Post(':id/assign')
  @Can(MODULES.RECORDS, ACTIONS.EDIT)
  async assign(
    @Param('id') id: string,
    @Body(zodBody(assignRecordSchema))
    body: { assignedToUserId: string | null; remark?: string },
  ): Promise<{ assignedToUserId: string | null }> {
    return this.workflow.assign(uuidSchema.parse(id), body);
  }

  @Get(':id/timeline')
  @Can(MODULES.RECORDS, ACTIONS.VIEW)
  async timelineFeed(
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.timeline.list({
      recordId: uuidSchema.parse(id),
      cursor,
      limit: limit ? Number(limit) : undefined,
    });
  }
}
