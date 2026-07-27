import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ACTIONS,
  MODULES,
  changeStatusSchema,
  uuidSchema,
  type RecordStatus,
} from '@nbr/shared';
import { Can } from '../auth/auth.decorators';
import { zodBody } from '../common/zod-validation.pipe';
import { TimelineService } from '../timeline/timeline.service';
import { WorkflowService, type SmartActionPanel } from './workflow.service';

@Controller('records')
export class RecordsController {
  constructor(
    private readonly workflow: WorkflowService,
    private readonly timeline: TimelineService,
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
