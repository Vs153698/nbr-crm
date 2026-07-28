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
import { NbrWebsiteService } from '../integrations/nbr-website.service';
import { ExportsService } from '../reports/exports.service';
import { ReportsService } from '../reports/reports.service';
import { GovernanceService } from './governance.service';

const settingSchema = z.object({ value: z.unknown() });

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
  constructor(private readonly governance: GovernanceService) {}

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
  constructor(private readonly nbr: NbrWebsiteService) {}

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
  ],
  providers: [GovernanceService, ReportsService, ExportsService, NbrWebsiteService],
  exports: [GovernanceService, ReportsService, ExportsService, NbrWebsiteService],
})
export class GovernanceModule {}
