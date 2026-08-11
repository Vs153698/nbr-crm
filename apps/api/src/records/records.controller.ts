import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ACTIONS,
  MODULES,
  assignRecordSchema,
  changeStatusSchema,
  uuidSchema,
  type ClientProgress,
  type RecordStatus,
} from '@nbr/shared';
import { Can } from '../auth/auth.decorators';
import { zodBody } from '../common/zod-validation.pipe';
import { TimelineService } from '../timeline/timeline.service';
import { ClientProgressService } from './client-progress.service';
import { WorkflowService, type SmartActionPanel } from './workflow.service';

@Controller('records')
export class RecordsController {
  constructor(
    private readonly workflow: WorkflowService,
    private readonly timeline: TimelineService,
    private readonly clientProgressService: ClientProgressService,
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
