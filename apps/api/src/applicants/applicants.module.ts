import { forwardRef, Module } from '@nestjs/common';
import { GovernanceModule } from '../governance/governance.module';
import { PrivacyModule } from '../privacy/privacy.module';
import { ClientProgressService } from '../records/client-progress.service';
import { QueuesController } from '../records/queues.controller';
import { QueuesService } from '../records/queues.service';
import { RecordsController } from '../records/records.controller';
import { WorkflowService } from '../records/workflow.service';
import { TimelineModule } from '../timeline/timeline.module';
import { AddRecordService } from './add-record.service';
import { ApplicantListService } from './applicant-list.service';
import { ApplicantsController } from './applicants.controller';
import { ApplicantsService } from './applicants.service';
import { DuplicateService } from './duplicate.service';

/**
 * The applicant lifecycle: master profile, duplicate detection, records and
 * the workflow engine. Grouped in one module because they share a transaction
 * boundary — creating an applicant creates a record, an achievement, consent
 * rows and timeline entries as a single atomic operation.
 */
@Module({
  /**
   * The governance import is circular and deliberately so.
   *
   * Governance needs `DuplicateService` from here, to merge a website
   * submission onto an existing profile. This module needs
   * `LegacyActionsService` from there, so that closing or rejecting a mirrored
   * record through the ordinary Change Status modal reaches the website instead
   * of quietly leaving the two systems disagreeing. Both directions are real;
   * `forwardRef` is what lets Nest resolve them.
   */
  imports: [TimelineModule, PrivacyModule, forwardRef(() => GovernanceModule)],
  controllers: [ApplicantsController, RecordsController, QueuesController],
  providers: [
    ApplicantsService,
    ApplicantListService,
    AddRecordService,
    DuplicateService,
    WorkflowService,
    ClientProgressService,
    QueuesService,
  ],
  exports: [ApplicantsService, ApplicantListService, AddRecordService, DuplicateService, WorkflowService],
})
export class ApplicantsModule {}
