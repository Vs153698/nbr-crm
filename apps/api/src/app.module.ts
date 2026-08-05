import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AdminModule } from './admin/admin.module';
import { ApplicantsModule } from './applicants/applicants.module';
import { AuditModule } from './audit/audit.service';
import { AuthGuard } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { DocumentsModule } from './documents/documents.module';
import { GovernanceModule } from './governance/governance.module';
import { LookupsModule } from './lookups/lookups.module';
import { NotesModule } from './notes/notes.module';
import { OpsModule } from './ops/ops.module';
import { PaymentsModule } from './payments/payments.module';
import { StorageModule } from './storage/storage.module';
import { PrivacyModule } from './privacy/privacy.module';
import { TimelineModule } from './timeline/timeline.module';
import { VaultModule } from './vault/vault.module';
import { AllExceptionsFilter } from './common/exception.filter';
import { ResponseInterceptor } from './common/response.interceptor';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { MailModule } from './mail/mail.module';
import { RedisModule } from './redis/redis.module';

/**
 * Root module.
 *
 * The two global providers here are what make the security posture
 * default-safe rather than default-open:
 *
 *  • `AuthGuard` runs on every route, so a new endpoint is authenticated
 *    unless someone explicitly marks it `@Public()`.
 *  • `AllExceptionsFilter` is the only place an error reaches the client, so
 *    an internal message cannot escape through a handler that forgot to catch.
 */
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    RedisModule,
    AuditModule,
    MailModule,
    AuthModule,
    HealthModule,
    TimelineModule,
    PrivacyModule,
    StorageModule,
    ApplicantsModule,
    DashboardModule,
    DocumentsModule,
    LookupsModule,
    VaultModule,
    NotesModule,
    PaymentsModule,
    OpsModule,
    GovernanceModule,
    AdminModule,
    ScheduleModule.forRoot(),
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
