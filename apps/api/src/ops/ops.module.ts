import { Body, Controller, Delete, Get, HttpCode, Module, Param, Post, Put, Query } from '@nestjs/common';
import {
  ACTIONS,
  MODULES,
  createBlacklistSchema,
  createTaskSchema,
  liftBlacklistSchema,
  logCallSchema,
  markWhatsappSentSchema,
  sendEmailSchema,
  setFlagSchema,
  updateTaskSchema,
  upsertTemplateSchema,
  uuidSchema,
  whatsappLinkSchema,
} from '@nbr/shared';
import { Can, RequireAnyPermission } from '../auth/auth.decorators';
import { zodBody } from '../common/zod-validation.pipe';
import { BlacklistService } from './blacklist.service';
import { CommunicationsService } from './communications.service';
import { NotificationsService } from './notifications.service';
import { TasksService } from './tasks.service';

@Controller('tasks')
class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  @Can(MODULES.TASKS, ACTIONS.VIEW)
  async list(
    @Query('scope') scope?: 'mine' | 'all' | 'applicant',
    @Query('applicantId') applicantId?: string,
    @Query('status') status?: string,
    @Query('assignedToUserId') assignedToUserId?: string,
    @Query('overdueOnly') overdueOnly?: string,
  ) {
    return this.tasks.list({
      scope: scope ?? 'mine',
      applicantId: applicantId ? uuidSchema.parse(applicantId) : undefined,
      status,
      assignedToUserId: assignedToUserId ? uuidSchema.parse(assignedToUserId) : undefined,
      overdueOnly: overdueOnly === 'true',
    });
  }

  /** Counts behind the board's filter chips. */
  @Get('counts')
  @Can(MODULES.TASKS, ACTIONS.VIEW)
  async counts() {
    return this.tasks.counts();
  }

  /** M-10 Add Task / Follow-up. */
  @Post()
  @Can(MODULES.TASKS, ACTIONS.CREATE)
  async create(
    @Body(zodBody(createTaskSchema))
    body: {
      applicantId?: string;
      recordId?: string;
      title: string;
      description?: string;
      assignedToUserId: string;
      dueDate: Date;
      priority: string;
      remindAt?: Date;
    },
  ) {
    return this.tasks.create(body);
  }

  @Put(':id')
  @Can(MODULES.TASKS, ACTIONS.EDIT)
  async update(
    @Param('id') id: string,
    @Body(zodBody(updateTaskSchema)) body: Record<string, never>,
  ): Promise<{ ok: true }> {
    await this.tasks.update(uuidSchema.parse(id), body);
    return { ok: true };
  }
}

@Controller('communications')
class CommunicationsController {
  constructor(private readonly comms: CommunicationsService) {}

  /** §22 unified history. */
  @Get()
  @Can(MODULES.COMMUNICATIONS, ACTIONS.VIEW)
  async history(
    @Query('applicantId') applicantId?: string,
    @Query('recordId') recordId?: string,
    @Query('channel') channel?: string,
  ) {
    return this.comms.history({
      applicantId: applicantId ? uuidSchema.parse(applicantId) : undefined,
      recordId: recordId ? uuidSchema.parse(recordId) : undefined,
      channel,
    });
  }

  /** M-07 live preview with the applicant's real data merged in. */
  @Get('preview')
  @Can(MODULES.COMMUNICATIONS, ACTIONS.VIEW)
  async preview(
    @Query('recordId') recordId: string,
    @Query('templateCode') templateCode: string,
    @Query('channel') channel = 'email',
  ) {
    return this.comms.preview(uuidSchema.parse(recordId), templateCode, channel);
  }

  /** Queued, so the request returns before SMTP is touched (§7 async budget). */
  @Post('email')
  @HttpCode(202)
  @Can(MODULES.COMMUNICATIONS, ACTIONS.SEND)
  async sendEmail(
    @Body(zodBody(sendEmailSchema))
    body: {
      recordId: string;
      templateCode?: string;
      to: string;
      cc?: string[];
      subject: string;
      body: string;
      bodyEdited?: boolean;
      attachmentKeys?: string[];
    },
  ) {
    return this.comms.sendEmail(body);
  }

  @Post(':id/retry')
  @Can(MODULES.COMMUNICATIONS, ACTIONS.SEND)
  async retry(@Param('id') id: string) {
    return this.comms.retry(uuidSchema.parse(id));
  }

  /** M-08 — returns a wa.me deep link; nothing is sent server-side. */
  @Post('whatsapp-link')
  @Can(MODULES.COMMUNICATIONS, ACTIONS.SEND)
  async whatsappLink(
    @Body(zodBody(whatsappLinkSchema))
    body: { recordId: string; templateCode: string; bodyOverride?: string },
  ) {
    return this.comms.whatsappLink(body);
  }

  /** Staff confirm they actually sent it — the history stays honest. */
  @Post('whatsapp-sent')
  @Can(MODULES.COMMUNICATIONS, ACTIONS.SEND)
  async markSent(
    @Body(zodBody(markWhatsappSentSchema)) body: { communicationId: string },
  ): Promise<{ ok: true }> {
    await this.comms.markWhatsappSent(body.communicationId);
    return { ok: true };
  }

  @Post('call-note')
  @Can(MODULES.COMMUNICATIONS, ACTIONS.SEND)
  async logCall(
    @Body(zodBody(logCallSchema))
    body: {
      applicantId: string;
      recordId?: string;
      summary: string;
      durationMinutes?: number;
      outcome?: string;
      followUpDate?: Date;
    },
  ) {
    return this.comms.logCall(body);
  }
}

@Controller('templates')
class TemplatesController {
  constructor(private readonly comms: CommunicationsService) {}

  @Get()
  @Can(MODULES.TEMPLATES, ACTIONS.VIEW)
  async list() {
    return this.comms.listTemplates();
  }

  /** Placeholders are validated here so a typo fails at save, not at send. */
  @Put()
  @Can(MODULES.TEMPLATES, ACTIONS.EDIT)
  async upsert(
    @Body(zodBody(upsertTemplateSchema))
    body: {
      code: string;
      channel: string;
      name: string;
      subject?: string;
      body: string;
      isActive: boolean;
    },
  ) {
    return this.comms.upsertTemplate(body);
  }

  /** Custom templates only — the built-ins back workflow stages. */
  @Delete(':id')
  @Can(MODULES.TEMPLATES, ACTIONS.EDIT)
  async remove(@Param('id') id: string) {
    return this.comms.deleteTemplate(uuidSchema.parse(id));
  }
}

@Controller('blacklists')
class BlacklistController {
  constructor(private readonly blacklist: BlacklistService) {}

  /** W-25 register — active entries and lifted history. */
  @Get()
  @Can(MODULES.BLACKLIST, ACTIONS.VIEW)
  async list(@Query('activeOnly') activeOnly?: string) {
    return this.blacklist.list({ activeOnly: activeOnly !== 'false' });
  }

  /** M-09 Blacklist Applicant. */
  @Post()
  @Can(MODULES.BLACKLIST, ACTIONS.CREATE)
  async add(
    @Body(zodBody(createBlacklistSchema))
    body: {
      applicantId: string;
      kind: string;
      reason: string;
      reasonDetail: string;
      effectiveUntil?: Date;
      documentKeys: string[];
      remarks?: string;
    },
  ) {
    return this.blacklist.add(body);
  }

  /** Lifting stamps the record rather than deleting it. */
  @Post(':id/lift')
  @Can(MODULES.BLACKLIST, ACTIONS.EDIT)
  async lift(
    @Param('id') id: string,
    @Body(zodBody(liftBlacklistSchema)) body: { reason: string },
  ): Promise<{ ok: true }> {
    await this.blacklist.lift(uuidSchema.parse(id), body.reason);
    return { ok: true };
  }
}

@Controller('flags')
class FlagsController {
  constructor(private readonly blacklist: BlacklistService) {}

  @Get()
  @Can(MODULES.APPLICANTS, ACTIONS.VIEW)
  async list(@Query('applicantId') applicantId: string) {
    return this.blacklist.listFlags(uuidSchema.parse(applicantId));
  }

  @Post()
  @RequireAnyPermission('blacklist:create', 'applicants:edit')
  async set(
    @Body(zodBody(setFlagSchema))
    body: { applicantId: string; flag: string; reason?: string; expiresAt?: Date },
  ) {
    return this.blacklist.setFlag(body);
  }

  @Delete()
  @RequireAnyPermission('blacklist:edit', 'applicants:edit')
  async remove(
    @Query('applicantId') applicantId: string,
    @Query('flag') flag: string,
  ): Promise<{ ok: true }> {
    await this.blacklist.removeFlag(uuidSchema.parse(applicantId), flag);
    return { ok: true };
  }
}

@Controller('notifications')
class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @Can(MODULES.NOTIFICATIONS, ACTIONS.VIEW)
  async list(@Query('unreadOnly') unreadOnly?: string) {
    return this.notifications.list({ unreadOnly: unreadOnly === 'true' });
  }

  /** Drives the bell badge — kept separate so it can be polled cheaply. */
  @Get('count')
  @Can(MODULES.NOTIFICATIONS, ACTIONS.VIEW)
  async count(): Promise<{ unread: number }> {
    return { unread: await this.notifications.unreadCount() };
  }

  @Post(':id/read')
  @Can(MODULES.NOTIFICATIONS, ACTIONS.VIEW)
  async markRead(@Param('id') id: string): Promise<{ ok: true }> {
    await this.notifications.markRead(uuidSchema.parse(id));
    return { ok: true };
  }

  @Post('read-all')
  @Can(MODULES.NOTIFICATIONS, ACTIONS.VIEW)
  async markAllRead() {
    return this.notifications.markAllRead();
  }

  @Post(':id/dismiss')
  @Can(MODULES.NOTIFICATIONS, ACTIONS.VIEW)
  async dismiss(@Param('id') id: string): Promise<{ ok: true }> {
    await this.notifications.dismiss(uuidSchema.parse(id));
    return { ok: true };
  }

  /**
   * Run the queue sweep now instead of waiting for the hourly cron.
   *
   * Useful after changing an SLA setting, and the only way to confirm the
   * generators work without waiting an hour. Dedupe keys make it safe to call
   * repeatedly — a second run raises nothing new.
   */
  @Post('generate')
  @Can(MODULES.NOTIFICATIONS, ACTIONS.MANAGE)
  async generate(): Promise<{ ok: true }> {
    await this.notifications.generateQueueAlerts();
    return { ok: true };
  }
}

/**
 * The operations half of Phase 2 (P2-05…P2-09, P2-11).
 *
 * Tasks, communication, blacklist and notifications sit together because they
 * are the cross-cutting workflow layer — every one of them attaches to an
 * applicant and writes to the same timeline.
 */
@Module({
  controllers: [
    TasksController,
    CommunicationsController,
    TemplatesController,
    BlacklistController,
    FlagsController,
    NotificationsController,
  ],
  providers: [TasksService, CommunicationsService, BlacklistService, NotificationsService],
  exports: [TasksService, CommunicationsService, BlacklistService, NotificationsService],
})
export class OpsModule {}
