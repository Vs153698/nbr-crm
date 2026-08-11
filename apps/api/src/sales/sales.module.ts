import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Module,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ACTIONS,
  applyLeaveSchema,
  attendanceQuerySchema,
  cancelPayslipSchema,
  confirmEmployeeDocumentSchema,
  convertLeadSchema,
  createLeadSchema,
  decideLeaveSchema,
  employeeListQuerySchema,
  createEmployeeSchema,
  generatePayslipSchema,
  leadListQuerySchema,
  logLeadCallSchema,
  markAttendanceSchema,
  MODULES,
  presignEmployeeDocumentSchema,
  salesDashboardQuerySchema,
  updateEmployeeSchema,
  updateLeadSchema,
  uuidSchema,
  type ApplyLeaveInput,
  type CallOutcome,
  type EmployeeDocumentKind,
  type CreateEmployeeInput,
  type EmployeeInput,
  type GeneratePayslipInput,
  type LeadStatus,
  type MarkAttendanceInput,
} from '@nbr/shared';
import { AdminModule } from '../admin/admin.module';
import { ApplicantsModule } from '../applicants/applicants.module';
import { Can } from '../auth/auth.decorators';
import { zodBody } from '../common/zod-validation.pipe';
import { EmployeeDocumentsService, type EmployeeDocumentItem } from './employee-documents.service';
import { EmployeeHrService } from './employee-hr.service';
import { EmployeesService } from './employees.service';
import { LeadsService } from './leads.service';
import { SalesReportService } from './sales-report.service';

@Controller('leads')
class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get()
  @Can(MODULES.LEADS, ACTIONS.VIEW)
  async list(@Query() query: Record<string, unknown>) {
    const filters = leadListQuerySchema.parse(query);
    return this.leads.list(filters);
  }

  @Get(':id')
  @Can(MODULES.LEADS, ACTIONS.VIEW)
  async get(@Param('id') id: string) {
    return this.leads.getById(uuidSchema.parse(id));
  }

  @Post()
  @Can(MODULES.LEADS, ACTIONS.CREATE)
  async create(@Body(zodBody(createLeadSchema)) body: Parameters<LeadsService['create']>[0]) {
    return this.leads.create(body);
  }

  @Put(':id')
  @Can(MODULES.LEADS, ACTIONS.EDIT)
  async update(
    @Param('id') id: string,
    @Body(zodBody(updateLeadSchema)) body: Record<string, unknown>,
  ) {
    return this.leads.update(uuidSchema.parse(id), body);
  }

  /** The core sales action — one call, its outcome, and what was promised. */
  @Post(':id/calls')
  @Can(MODULES.LEADS, ACTIONS.EDIT)
  @HttpCode(201)
  async logCall(
    @Param('id') id: string,
    @Body(zodBody(logLeadCallSchema))
    body: {
      outcome: CallOutcome;
      summary: string;
      durationMinutes?: number;
      followUpAt?: Date;
      resultingStatus?: LeadStatus;
      calledAt?: Date;
    },
  ) {
    return this.leads.logCall(uuidSchema.parse(id), body);
  }

  @Post(':id/convert')
  @Can(MODULES.LEADS, ACTIONS.CHANGE_STATUS)
  async convert(
    @Param('id') id: string,
    @Body(zodBody(convertLeadSchema))
    body: {
      categoryId: string;
      recordTitle: string;
      description?: string;
      existingApplicantId?: string;
      override: boolean;
      overrideReason?: string;
    },
  ) {
    return this.leads.convert(uuidSchema.parse(id), body);
  }

  @Delete(':id')
  @Can(MODULES.LEADS, ACTIONS.DELETE)
  async remove(@Param('id') id: string, @Query('reason') reason?: string) {
    return this.leads.remove(uuidSchema.parse(id), reason);
  }
}

@Controller('sales')
class SalesDashboardController {
  constructor(private readonly report: SalesReportService) {}

  /** The sales dashboard, and the same figures the evening email carries. */
  @Get('dashboard')
  @Can(MODULES.LEADS, ACTIONS.VIEW)
  async dashboard(@Query() query: Record<string, unknown>) {
    const filters = salesDashboardQuerySchema.parse(query);
    return this.report.day(filters);
  }

  /** Send the end-of-day summary now, rather than waiting for the schedule. */
  @Post('daily-report/send')
  @Can(MODULES.REPORTS, ACTIONS.EXPORT)
  @HttpCode(200)
  async sendNow() {
    return this.report.sendDailyReport();
  }
}

@Controller('employees')
class EmployeesController {
  constructor(
    private readonly employees: EmployeesService,
    private readonly hr: EmployeeHrService,
  ) {}

  @Get()
  @Can(MODULES.EMPLOYEES, ACTIONS.VIEW)
  async list(@Query() query: Record<string, unknown>) {
    return this.employees.list(employeeListQuerySchema.parse(query));
  }

  @Get('departments')
  @Can(MODULES.EMPLOYEES, ACTIONS.VIEW)
  async departments() {
    return this.employees.departments();
  }

  /**
   * The five figures across the top of the Employees list.
   *
   * Static path, declared before `:id` — Fastify prefers a literal segment over
   * a parametric one, but keeping them in reading order saves the next person
   * having to know that.
   */
  @Get('stats')
  @Can(MODULES.EMPLOYEES, ACTIONS.VIEW)
  async stats() {
    return this.hr.stats();
  }

  @Get(':id')
  @Can(MODULES.EMPLOYEES, ACTIONS.VIEW)
  async get(@Param('id') id: string) {
    return this.employees.getById(uuidSchema.parse(id));
  }

  @Post()
  @Can(MODULES.EMPLOYEES, ACTIONS.CREATE)
  async create(@Body(zodBody(createEmployeeSchema)) body: CreateEmployeeInput) {
    return this.employees.create(body);
  }

  @Put(':id')
  @Can(MODULES.EMPLOYEES, ACTIONS.EDIT)
  async update(
    @Param('id') id: string,
    @Body(zodBody(updateEmployeeSchema)) body: Partial<EmployeeInput>,
  ) {
    return this.employees.update(uuidSchema.parse(id), body);
  }

  @Delete(':id')
  @Can(MODULES.EMPLOYEES, ACTIONS.DELETE)
  async remove(@Param('id') id: string, @Query('reason') reason?: string) {
    return this.employees.remove(uuidSchema.parse(id), reason);
  }
}

/**
 * The onboarding file.
 *
 * Nested under the employee rather than sitting beside the evidence vault: the
 * permission that matters is `employees:*`, and scoping every lookup to the
 * employee in the path means a document id cannot be read through somebody
 * else's profile.
 */
@Controller('employees/:employeeId/documents')
class EmployeeDocumentsController {
  constructor(private readonly documents: EmployeeDocumentsService) {}

  @Get()
  @Can(MODULES.EMPLOYEES, ACTIONS.VIEW)
  async list(@Param('employeeId') employeeId: string): Promise<EmployeeDocumentItem[]> {
    return this.documents.list(uuidSchema.parse(employeeId));
  }

  /** Step 1 of an upload: the browser PUTs the bytes straight to storage. */
  @Post('presign')
  @Can(MODULES.EMPLOYEES, ACTIONS.EDIT)
  async presign(
    @Param('employeeId') employeeId: string,
    @Body(zodBody(presignEmployeeDocumentSchema))
    body: { fileName: string; contentType: string; sizeBytes: number },
  ) {
    return this.documents.presign(uuidSchema.parse(employeeId), body);
  }

  /** Step 2: the browser reports the upload landed; we verify and record it. */
  @Post()
  @Can(MODULES.EMPLOYEES, ACTIONS.EDIT)
  @HttpCode(201)
  async confirm(
    @Param('employeeId') employeeId: string,
    @Body(zodBody(confirmEmployeeDocumentSchema))
    body: {
      kind: EmployeeDocumentKind;
      storageKey: string;
      fileName: string;
      contentType: string;
      sizeBytes: number;
      originalSizeBytes?: number;
      checksumSha256?: string;
      description?: string;
    },
  ): Promise<{ id: string }> {
    return this.documents.confirm(uuidSchema.parse(employeeId), body);
  }

  /** `?mode=inline` renders the file in the preview panel instead of saving it. */
  @Get(':documentId/download')
  @Can(MODULES.EMPLOYEES, ACTIONS.VIEW)
  async download(
    @Param('employeeId') employeeId: string,
    @Param('documentId') documentId: string,
    @Query('mode') mode?: string,
  ) {
    return this.documents.downloadUrl(
      uuidSchema.parse(employeeId),
      uuidSchema.parse(documentId),
      mode === 'inline' ? 'inline' : 'attachment',
    );
  }

  @Delete(':documentId')
  @Can(MODULES.EMPLOYEES, ACTIONS.EDIT)
  async remove(
    @Param('employeeId') employeeId: string,
    @Param('documentId') documentId: string,
    @Query('reason') reason?: string,
  ) {
    return this.documents.remove(
      uuidSchema.parse(employeeId),
      uuidSchema.parse(documentId),
      reason,
    );
  }
}

/**
 * Attendance, leave and payroll for one employee (§HR).
 *
 * Its own controller on the same `employees/:id` base path rather than more
 * methods on `EmployeesController`: that one is the directory — who works here
 * and what their details are — and this is what happens to them month by month.
 * The URLs read the same either way.
 */
@Controller('employees/:employeeId')
class EmployeeHrController {
  constructor(private readonly hr: EmployeeHrService) {}

  /** Everything the profile's Overview tab needs, in one call. */
  @Get('overview')
  @Can(MODULES.EMPLOYEES, ACTIONS.VIEW)
  async overview(@Param('employeeId') employeeId: string) {
    return this.hr.overview(uuidSchema.parse(employeeId));
  }

  @Get('activity')
  @Can(MODULES.EMPLOYEES, ACTIONS.VIEW)
  async activity(@Param('employeeId') employeeId: string, @Query('limit') limit?: string) {
    return this.hr.activity(uuidSchema.parse(employeeId), limit ? Number(limit) : undefined);
  }

  // ── Attendance ────────────────────────────────────────────────────────────

  @Get('attendance')
  @Can(MODULES.EMPLOYEES, ACTIONS.VIEW)
  async attendance(
    @Param('employeeId') employeeId: string,
    @Query() query: Record<string, unknown>,
  ) {
    const { month, year } = attendanceQuerySchema.parse(query);
    const now = new Date();
    return this.hr.attendanceForMonth(
      uuidSchema.parse(employeeId),
      month ?? now.getMonth() + 1,
      year ?? now.getFullYear(),
    );
  }

  /**
   * Mark or correct one day.
   *
   * Idempotent on (employee, date): re-marking corrects rather than adding a
   * second row, so the register can never hold two answers for one day.
   */
  @Post('attendance')
  @Can(MODULES.EMPLOYEES, ACTIONS.EDIT)
  async markAttendance(
    @Param('employeeId') employeeId: string,
    @Body(zodBody(markAttendanceSchema)) body: MarkAttendanceInput,
  ) {
    return this.hr.markAttendance(uuidSchema.parse(employeeId), body);
  }

  // ── Leave ─────────────────────────────────────────────────────────────────

  @Get('leave')
  @Can(MODULES.EMPLOYEES, ACTIONS.VIEW)
  async leave(@Param('employeeId') employeeId: string) {
    return this.hr.listLeave(uuidSchema.parse(employeeId));
  }

  @Post('leave')
  @Can(MODULES.EMPLOYEES, ACTIONS.EDIT)
  async applyLeave(
    @Param('employeeId') employeeId: string,
    @Body(zodBody(applyLeaveSchema)) body: ApplyLeaveInput,
  ) {
    return this.hr.applyLeave(uuidSchema.parse(employeeId), body);
  }

  /**
   * Approve, reject or cancel a request.
   *
   * Approving writes the days into the attendance register, which is what makes
   * leave and attendance agree — and what lets payroll read one number.
   */
  @Post('leave/:leaveId/decide')
  @Can(MODULES.EMPLOYEES, ACTIONS.EDIT)
  async decideLeave(
    @Param('leaveId') leaveId: string,
    @Body(zodBody(decideLeaveSchema)) body: { status: string; decisionNote?: string },
  ) {
    return this.hr.decideLeave(uuidSchema.parse(leaveId), body);
  }

  // ── Payroll ───────────────────────────────────────────────────────────────

  @Get('payslips')
  @Can(MODULES.EMPLOYEES, ACTIONS.VIEW)
  async payslips(@Param('employeeId') employeeId: string) {
    return this.hr.listPayslips(uuidSchema.parse(employeeId));
  }

  @Post('payslips')
  @Can(MODULES.EMPLOYEES, ACTIONS.EDIT)
  async generatePayslip(
    @Param('employeeId') employeeId: string,
    @Body(zodBody(generatePayslipSchema)) body: GeneratePayslipInput,
  ) {
    return this.hr.generatePayslip(uuidSchema.parse(employeeId), body);
  }

  @Post('payslips/:payslipId/cancel')
  @Can(MODULES.EMPLOYEES, ACTIONS.EDIT)
  async cancelPayslip(
    @Param('payslipId') payslipId: string,
    @Body(zodBody(cancelPayslipSchema)) body: { reason: string },
  ) {
    return this.hr.cancelPayslip(uuidSchema.parse(payslipId), body.reason);
  }
}

/**
 * Outbound sales and the staff directory.
 *
 * One module because both are administrative surfaces that hang off `users`
 * without touching the applicant workflow — and because the sales report needs
 * the staff list the directory already loads.
 */
@Module({
  // Converting a lead goes through the ordinary intake path, so a converted
  // lead gets the same duplicate detection, consent ledger and timeline as a
  // walk-in rather than a second, divergent code path.
  // AdminModule for UsersService: adding an employee can mint their login, and
  // that must go through the same path Users & Roles uses — same role checks,
  // same password policy, same audit entry.
  imports: [ApplicantsModule, AdminModule],
  controllers: [
    LeadsController,
    SalesDashboardController,
    EmployeesController,
    EmployeeHrController,
    EmployeeDocumentsController,
  ],
  providers: [
    LeadsService,
    EmployeesService,
    EmployeeHrService,
    EmployeeDocumentsService,
    SalesReportService,
  ],
  exports: [LeadsService, EmployeesService, SalesReportService],
})
export class SalesModule {}
