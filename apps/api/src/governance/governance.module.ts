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
  forwardRef,
} from '@nestjs/common';
import {
  ACTIONS,
  MODULES,
  categorySchema,
  courierSchema,
  exportRequestSchema,
  packageSchema,
  legacyApplicationActionSchema,
  reportQuerySchema,
  uuidSchema,
  WEBHOOK_SIGNATURE_HEADER,
  type ExportFormat,
  type LegacyApplicationActionInput,
  type PermissionCode,
  type ReportType,
} from '@nbr/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ApplicantsModule } from '../applicants/applicants.module';
import { Can, Public } from '../auth/auth.decorators';
import { zodBody } from '../common/zod-validation.pipe';
import { ForbiddenError, ValidationError } from '../common/errors';
import { requireActor } from '../common/request-context';
import { LegacyLifecycleService } from '../integrations/legacy-lifecycle.service';
import { LegacyPushService } from '../integrations/legacy-push.service';
import {
  LegacyActionsService,
  type LegacyActionAvailability,
} from '../integrations/legacy-actions.service';
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

/**
 * The permission each imported-record action really needs.
 *
 * Sending a message to a certificate holder is the same act whether they came
 * through the pipeline or were catalogued offline, so it answers to the same
 * permission. Mapping them here keeps one endpoint serving all four kinds
 * without flattening them to a single coarse right.
 */
const ACTIVITY_PERMISSION = {
  email: `${MODULES.COMMUNICATIONS}:${ACTIONS.SEND}`,
  whatsapp: `${MODULES.COMMUNICATIONS}:${ACTIONS.SEND}`,
  note: `${MODULES.NOTES}:${ACTIONS.CREATE}`,
  task: `${MODULES.TASKS}:${ACTIONS.CREATE}`,
} as const satisfies Record<'email' | 'whatsapp' | 'note' | 'task', PermissionCode>;

function requirePermissionFor(kind: keyof typeof ACTIVITY_PERMISSION): void {
  const actor = requireActor();
  const needed = ACTIVITY_PERMISSION[kind];

  if (!actor.isSuperAdmin && !actor.permissions.has(needed)) {
    throw new ForbiddenError(`You do not have permission to do this (${needed}).`);
  }
}

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
    private readonly imported: ImportedRecordsService,
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

  /**
   * Inbound push for an offline certificate imported on the website.
   *
   * Its own endpoint rather than a branch of `applications` above, because that
   * payload is parsed as an application snapshot and one of these — which has
   * no application at all — would be rejected before reaching anything useful.
   * `@Public()` for the same reason: the HMAC signature is the authentication.
   */
  @Public()
  @Post('imported-certificates')
  @HttpCode(200)
  async receiveImportedCertificate(
    @Req() request: FastifyRequest & { rawBody?: string; body: unknown },
  ) {
    return this.imported.receivePush(
      request.rawBody ?? '',
      request.headers[WEBHOOK_SIGNATURE_HEADER] as string | undefined,
      request.body,
    );
  }

  /**
   * Clear everything that came from the website, ready for a full re-push.
   *
   * `@Public()` for the same reason as the webhook above: this is a
   * server-to-server call from the website's own admin panel, authenticated by
   * HMAC signature rather than a session. The signature check runs before
   * anything is touched.
   *
   * Deliberately reachable only from over there. The reset is meaningful only
   * when immediately followed by a backfill, and the website is the only side
   * that can perform one — offering the button here would let an operator empty
   * the mirror with no way to refill it.
   */
  @Public()
  @Post('reset')
  @HttpCode(200)
  async reset(@Req() request: FastifyRequest & { rawBody?: string; body: unknown }) {
    return this.nbr.resetFromWebsite(
      request.rawBody ?? '',
      request.headers[WEBHOOK_SIGNATURE_HEADER] as string | undefined,
    );
  }

  /**
   * The application ids this CRM holds, for the website's sync planner.
   *
   * `@Public()` like the other connector routes — a signed server-to-server
   * call. Read-only, and returns nothing but opaque ids.
   */
  @Public()
  @Get('known-ids')
  async knownIds(@Req() request: FastifyRequest & { rawBody?: string }) {
    return this.nbr.knownIdsForWebsite(
      request.rawBody ?? '',
      request.headers[WEBHOOK_SIGNATURE_HEADER] as string | undefined,
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
   * The website telling us its plan catalogue changed.
   *
   * Deliberately a nudge and not a payload. The importer above already knows
   * how to match plans by code, update prices and retire what has disappeared;
   * accepting a package body here would be a second, subtly different copy of
   * that logic, and the two would drift. So this verifies the signature and
   * then runs exactly the same pull an operator would have run by hand — the
   * only thing that changes is that nobody has to remember to.
   *
   * The website was the source of truth for prices already; until now the CRM
   * only learned about a new package when someone thought to press the button,
   * so a package added over there was quietly unavailable here.
   */
  @Public()
  @Post('packages-changed')
  @HttpCode(200)
  async packagesChanged(@Req() request: FastifyRequest & { rawBody?: string }) {
    return this.nbr.resyncPackagesForWebsite(
      request.rawBody ?? '',
      request.headers[WEBHOOK_SIGNATURE_HEADER] as string | undefined,
      () => this.legacyPush.syncPackages(),
    );
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
/**
 * The website's review actions, on a record.
 *
 * A second controller on the `records` base path rather than a method on
 * `RecordsController`: this needs `LegacyPushService`, which the governance
 * module owns, and having the applicants module reach in for it would make the
 * two modules mutually dependent. The URLs read the same either way.
 */
@Controller('records')
class LegacyActionsController {
  constructor(private readonly legacyActions: LegacyActionsService) {}

  /** Empty for a record created here — there is nothing on the website to decide. */
  @Get(':id/legacy-actions')
  @Can(MODULES.RECORDS, ACTIONS.VIEW)
  async available(@Param('id') id: string): Promise<LegacyActionAvailability> {
    return this.legacyActions.available(uuidSchema.parse(id));
  }

  /**
   * Take a review decision on an application mirrored from the website.
   *
   * Applied on the website, which mails the applicant from its own templates —
   * so approving here is byte-identical, to the applicant, to approving there.
   * Awaited rather than detached: an operator who clicks Approve has to be told
   * if the applicant was not in fact written to.
   */
  @Post(':id/legacy-action')
  @Can(MODULES.RECORDS, ACTIONS.CHANGE_STATUS)
  async run(
    @Param('id') id: string,
    @Body(zodBody(legacyApplicationActionSchema)) body: LegacyApplicationActionInput,
  ) {
    return this.legacyActions.run(uuidSchema.parse(id), body);
  }
}

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


  /**
   * One of the four permitted actions: email, whatsapp, note, task.
   *
   * Authorised per kind against the permission that already means that thing,
   * rather than on `integrations:manage`. Emailing a certificate holder or
   * leaving a note is ordinary operational work; `integrations:manage` is
   * reserved for Super Admin because it means "reconfigure the website link",
   * and gating notes behind it would leave every Admin looking at a screen
   * they cannot use.
   */
  @Post(':id/activity')
  @Can(MODULES.INTEGRATIONS, ACTIONS.VIEW)
  async addActivity(
    @Param('id') id: string,
    @Body(zodBody(importedActivitySchema))
    body: { kind: 'email' | 'whatsapp' | 'note' | 'task'; subject?: string; body: string; dueAt?: Date },
  ) {
    requirePermissionFor(body.kind);

    return this.imported.addActivity({
      importedRecordId: uuidSchema.parse(id),
      kind: body.kind,
      subject: body.subject,
      body: body.body,
      dueAt: body.dueAt,
    });
  }

  @Post('activity/:activityId/complete')
  @Can(MODULES.INTEGRATIONS, ACTIONS.VIEW)
  @HttpCode(200)
  async complete(@Param('activityId') activityId: string) {
    requirePermissionFor('task');
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
  imports: [forwardRef(() => ApplicantsModule)],
  controllers: [
    ReportsController,
    ExportsController,
    AuditController,
    SettingsController,
    IntegrationsController,
    LegacyActionsController,
    ImportedRecordsController,
  ],
  providers: [
    GovernanceService,
    ReportsService,
    ExportsService,
    NbrWebsiteService,
    LegacyLifecycleService,
    LegacyPushService,
    LegacyActionsService,
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
    // The workflow engine injects this so a Close or Reject taken in the
    // ordinary Change Status modal reaches the website, not just one taken in
    // the Website Review panel.
    LegacyActionsService,
  ],
})
export class GovernanceModule {}
