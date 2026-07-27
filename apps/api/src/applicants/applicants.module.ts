import { Module } from '@nestjs/common';
import { PrivacyModule } from '../privacy/privacy.module';
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
  imports: [TimelineModule, PrivacyModule],
  controllers: [ApplicantsController, RecordsController],
  providers: [ApplicantsService, ApplicantListService, AddRecordService, DuplicateService, WorkflowService],
  exports: [ApplicantsService, ApplicantListService, AddRecordService, DuplicateService, WorkflowService],
})
export class ApplicantsModule {}
