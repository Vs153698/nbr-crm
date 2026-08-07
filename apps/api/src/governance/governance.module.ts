import {
  Body,
  Controller,
  Get,
  HttpCode,
  Module,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  ACTIONS,
  MODULES,
  categorySchema,
  courierSchema,
  exportRequestSchema,
  packageSchema,
  reportQuerySchema,
  uuidSchema,
  WEBHOOK_SIGNATURE_HEADER,
  type ExportFormat,
  type ReportType,
} from '@nbr/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ApplicantsModule } from '../applicants/applicants.module';
import { Can, Public } from '../auth/auth.decorators';
import { zodBody } from '../common/zod-validation.pipe';
import { ValidationError } from '../common/errors';
import { LegacyLifecycleService } from '../integrations/legacy-lifecycle.service';
import { LegacyPushService } from '../integrations/legacy-push.service';
import { NbrWebsiteService } from '../integrations/nbr-website.service';
import { ImportedRecordsService } from '../integrations/imported-records.service';
import { MailService } from '../mail/mail.service';
import { ExportsService } from '../reports/exports.service';
import { ReportsService } from '../reports/reports.service';
import { GovernanceService } from './governance.service';

const settingSchema = z.object({ value: z.unknown() });
const mailTestSchema = z.object({ to: z.string().email() });

/** The four actions permitted on an imported record, and nothing else. */
const importedActivitySchema = z.object({
  kind: z.enum(['email', 'whatsapp', 'note', 'task']),
  subject: z.string().trim().max(300).optional(),
  body: z.string().trim().min(1).max(5000),
  dueAt: z.coerce.date().optional(),
});

@Controller('reports')
class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly exports: ExportsService,
  ) {}

  /** W-27 — run one of the six report types (§24). */
  @Get(':type')
  @Can(MODULES.REPORTS, ACTIONS.VIEW)
  async run(@Param('type') type: string, @Query() query: Record<string, unknown>) {
    const filters = reportQuerySchema.parse(query);
    return this.reports.run(type as ReportType, filters);
  }

  /** M-13 — queued; the caller gets a job id, not a file. */
  @Post(':type/export')
  @HttpCode(202)
  @Can(MODULES.REPORTS, ACTIONS.EXPORT)
  async export(
    @Param('type') type: string,
    @Body(zodBody(exportRequestSchema))
    body: { format: ExportFormat; columns?: string[] } & Record<string, unknown>,
  ) {
    const { format, columns, ...filters } = body;
    return this.exports.queue({
      reportType: type as ReportType,
      format,
      columns,
      filters: filters as never,
    });
  }
}

@Controller('exports')
class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  /** The download centre. */
  @Get()
  @Can(MODULES.REPORTS, ACTIONS.EXPORT)
  async list() {
    return this.exports.listJobs();
  }

  @Get(':id/download')
  @Can(MODULES.REPORTS, ACTIONS.EXPORT)
  async download(@Param('id') id: string) {
    return this.exports.getDownloadUrl(uuidSchema.parse(id));
  }
}

@Controller('audit-logs')
class AuditController {
  constructor(private readonly governance: GovernanceService) {}

  /** W-30 — read-only; the table itself refuses UPDATE and DELETE. */
  @Get()
  @Can(MODULES.AUDIT, ACTIONS.VIEW)
  async list(@Query() query: Record<string, string | undefined>) {
    return this.governance.listAuditLogs({
      action: query.action,
      actorUserId: query.actorUserId,
      entityType: query.entityType,
      entityId: query.entityId,
      q: query.q,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      cursor: query.cursor,
      limit: query.limit ? Number(query.limit) : undefined,
    });
  }

  @Get('actions')
  @Can(MODULES.AUDIT, ACTIONS.VIEW)
  async actions() {
    return this.governance.auditActions();
  }

  /** Everything ever done to one entity. */
  @Get('entity/:type/:id')
  @Can(MODULES.AUDIT, ACTIONS.VIEW)
  async entity(@Param('type') type: string, @Param('id') id: string) {
    return this.governance.entityHistory(type, uuidSchema.parse(id));
  }

  /** DPDP §8(4) — who read which identifier, and the reason they gave. */
  @Get('pii-access')
  @Can(MODULES.PRIVACY, ACTIONS.VIEW)
  async piiAccess(@Query('applicantId') applicantId?: string, @Query('userId') userId?: string) {
    return this.governance.listPiiAccess({
      applicantId: applicantId ? uuidSchema.parse(applicantId) : undefined,
      userId: userId ? uuidSchema.parse(userId) : undefined,
    });
  }
}

@Controller('settings')
class SettingsController {
  constructor(
    private readonly governance: GovernanceService,
    private readonly mail: MailService,
  ) {}

  /**
   * Send one real message with the currently saved SMTP settings.
   *
   * A real send rather than a connection check: authentication can succeed
   * while the From address is rejected by the relay, and the operator needs to
   * know that now rather than the first time a certificate email silently
   * fails.
   */
  @Post('mail/test')
  @Can(MODULES.SETTINGS, ACTIONS.MANAGE)
  @HttpCode(200)
  async testMail(@Body(zodBody(mailTestSchema)) body: { to: string }) {
    try {
      return await this.mail.testConnection(body.to);
    } catch (error: unknown) {
      throw new ValidationError({
        smtp: [error instanceof Error ? error.message : 'The SMTP test failed.'],
      });
    }
  }

  @Get()
  @Can(MODULES.SETTINGS, ACTIONS.VIEW)
  async list() {
    return this.governance.listSettings();
  }

  @Put(':key')
  @Can(MODULES.SETTINGS, ACTIONS.MANAGE)
  async update(
    @Param('key') key: string,
    @Body(zodBody(settingSchema)) body: { value: unknown },
  ): Promise<{ ok: true }> {
    await this.governance.updateSetting(key, body.value);
    return { ok: true };
  }

  /** §26 catalogue management — categories, packages, couriers. */
  @Put('catalogue/categories')
  @Can(MODULES.SETTINGS, ACTIONS.MANAGE)
  async upsertCategory(
    @Body(zodBody(categorySchema))
    body: { id?: string; name: string; description?: string; isActive: boolean },
  ) {
    return this.governance.upsertCategory(body);
  }

  @Put('catalogue/packages')
  @Can(MODULES.SETTINGS, ACTIONS.MANAGE)
  async upsertPackage(
    @Body(zodBody(packageSchema))
    body: {
      id?: string;
      name: string;
      description?: string;
      amount: string;
      gstPercent: string;
      isActive: boolean;
    },
  ) {
    return this.governance.upsertPackage(body);
  }

  @Put('catalogue/couriers')
  @Can(MODULES.SETTINGS, ACTIONS.MANAGE)
  async upsertCourier(
    @Body(zodBody(courierSchema))
    body: { id?: string; name: string; trackingUrlTemplate?: string; isActive: boolean },
  ) {
    return this.governance.upsertCourier(body);
  }
}

@Controller('integrations/nbr-website')
class IntegrationsController {
  constructor(
    private readonly nbr: NbrWebsiteService,
    private readonly legacyPush: LegacyPushService,
  ) {}

  /**
   * The return leg: whether pushes back to the website are configured, how
   * many records are mirrored, and which of them last failed to push.
   */
  @Get('push-status')
  @Can(MODULES.INTEGRATIONS, ACTIONS.VIEW)
  async pushStatus() {
    return this.legacyPush.status();
  }

  /**
   * Inbound webhook from the existing NBR admin panel (P2-14).
   *
   * `@Public()` because this is a server-to-server call authenticated by HMAC
   * signature, not by a session cookie — there is no user to log in. The
   * signature check inside `receive` is the authentication, and it runs before
   * anything else touches the payload.
   */
  @Public()
  @Post('applications')
  @HttpCode(202)
  async receive(@Req() request: FastifyRequest & { rawBody?: string; body: unknown }) {
    return this.nbr.receive(
      request.rawBody ?? '',
      request.headers[WEBHOOK_SIGNATURE_HEADER] as string | undefined,
      request.body,
    );
  }

  @Get('sync-status')
  @Can(MODULES.INTEGRATIONS, ACTIONS.VIEW)
  async status() {
    return this.nbr.syncStatus();
  }

  /**
   * Mirror the website's plan catalogue into our packages list.
   *
   * Run once at setup, and again whenever prices change over there. With both
   * sides offering the same packages, a payment recorded here pushes back
   * carrying the website's own plan code instead of being matched by price.
   */
  @Post('sync-packages')
  @Can(MODULES.INTEGRATIONS, ACTIONS.MANAGE)
  @HttpCode(200)
  async syncPackages() {
    return this.legacyPush.syncPackages();
  }

  /**
   * Mirror the website's category list into ours.
   *
   * Applications are created against the website's categories, so any category
   * we hold that it does not raises an unmatched-category alert on every import
   * — a mismatch the operator cannot resolve, because the applicant only ever
   * saw the website's list.
   */
  @Post('sync-categories')
  @Can(MODULES.INTEGRATIONS, ACTIONS.MANAGE)
  @HttpCode(200)
  async syncCategories() {
    return this.legacyPush.syncCategories();
  }

  /**
   * Fingerprint of the webhook secret, for comparing against the sender's.
   * Turns a 401 into a definite answer about whether the secrets match.
   */
  @Get('secret-identity')
  @Can(MODULES.INTEGRATIONS, ACTIONS.VIEW)
  secretIdentity() {
    return this.nbr.secretIdentity();
  }

  @Get('events')
  @Can(MODULES.INTEGRATIONS, ACTIONS.VIEW)
  async events(@Query('limit') limit?: string) {
    return this.nbr.listEvents(limit ? Number(limit) : undefined);
  }

  /** Replay a failed import once the underlying problem is fixed. */
  @Post('events/:id/replay')
  @Can(MODULES.INTEGRATIONS, ACTIONS.MANAGE)
  async replay(@Param('id') id: string) {
    return this.nbr.replay(uuidSchema.parse(id));
  }
}


/**
 * Imported records — offline certificates mirrored from the website.
 *
 * Its own controller rather than rows inside Applicants, because these have no
 * application behind them. See the schema comment on `importedRecords` for why
 * they are kept apart.
 */
@Controller('imported-records')
class ImportedRecordsController {
  constructor(private readonly imported: ImportedRecordsService) {}

  @Get()
  @Can(MODULES.INTEGRATIONS, ACTIONS.VIEW)
  async list(
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.imported.list({
      search,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Get(':id')
  @Can(MODULES.INTEGRATIONS, ACTIONS.VIEW)
  async get(@Param('id') id: string) {
    return this.imported.get(uuidSchema.parse(id));
  }

  /** Pull the website's offline certificates. Safe to re-run. */
  @Post('sync')
  @Can(MODULES.INTEGRATIONS, ACTIONS.MANAGE)
  @HttpCode(200)
  async sync(@Body() body?: { full?: boolean }) {
    return this.imported.sync({ full: body?.full === true });
  }

  /** One of the four permitted actions: email, whatsapp, note, task. */
  @Post(':id/activity')
  @Can(MODULES.INTEGRATIONS, ACTIONS.MANAGE)
  async addActivity(
    @Param('id') id: string,
    @Body(zodBody(importedActivitySchema))
    body: { kind: 'email' | 'whatsapp' | 'note' | 'task'; subject?: string; body: string; dueAt?: Date },
  ) {
    return this.imported.addActivity({
      importedRecordId: uuidSchema.parse(id),
      kind: body.kind,
      subject: body.subject,
      body: body.body,
      dueAt: body.dueAt,
    });
  }

  @Post('activity/:activityId/complete')
  @Can(MODULES.INTEGRATIONS, ACTIONS.MANAGE)
  @HttpCode(200)
  async complete(@Param('activityId') activityId: string) {
    await this.imported.completeTask(uuidSchema.parse(activityId));
    return { completed: true };
  }
}

/**
 * Reporting, audit, settings and the inbound website integration
 * (P2-12, P2-13, P2-14).
 */
@Module({
  // The importer reuses the same duplicate-detection engine the manual Add
  // Applicant form uses, so a website submission from a returning applicant
  // merges onto their existing profile rather than creating a second one.
  imports: [ApplicantsModule],
  controllers: [
    ReportsController,
    ExportsController,
    AuditController,
    SettingsController,
    IntegrationsController,
    ImportedRecordsController,
  ],
  providers: [
    GovernanceService,
    ReportsService,
    ExportsService,
    NbrWebsiteService,
    LegacyLifecycleService,
    LegacyPushService,
    ImportedRecordsService,
  ],
  exports: [
    GovernanceService,
    ReportsService,
    ExportsService,
    NbrWebsiteService,
    // Payments, certificates and dispatch inject this to push their changes
    // back to the public site.
    LegacyPushService,
  ],
})
export class GovernanceModule {}
