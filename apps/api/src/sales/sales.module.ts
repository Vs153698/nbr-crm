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
  convertLeadSchema,
  createLeadSchema,
  employeeListQuerySchema,
  employeeSchema,
  leadListQuerySchema,
  logLeadCallSchema,
  MODULES,
  salesDashboardQuerySchema,
  updateEmployeeSchema,
  updateLeadSchema,
  uuidSchema,
  type CallOutcome,
  type EmployeeInput,
  type LeadStatus,
} from '@nbr/shared';
import { ApplicantsModule } from '../applicants/applicants.module';
import { Can } from '../auth/auth.decorators';
import { zodBody } from '../common/zod-validation.pipe';
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
  constructor(private readonly employees: EmployeesService) {}

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

  @Get(':id')
  @Can(MODULES.EMPLOYEES, ACTIONS.VIEW)
  async get(@Param('id') id: string) {
    return this.employees.getById(uuidSchema.parse(id));
  }

  @Post()
  @Can(MODULES.EMPLOYEES, ACTIONS.CREATE)
  async create(@Body(zodBody(employeeSchema)) body: EmployeeInput) {
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
  imports: [ApplicantsModule],
  controllers: [LeadsController, SalesDashboardController, EmployeesController],
  providers: [LeadsService, EmployeesService, SalesReportService],
  exports: [LeadsService, EmployeesService, SalesReportService],
})
export class SalesModule {}
