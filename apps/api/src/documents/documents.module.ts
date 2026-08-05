import { Controller, Get, Module, Param } from '@nestjs/common';
import { ACTIONS, MODULES, uuidSchema } from '@nbr/shared';
import { Can } from '../auth/auth.decorators';
import { StorageModule } from '../storage/storage.module';
import { DocumentsService, type GeneratedDocument } from './documents.service';

@Controller('applicants')
class ApplicantDocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  /** §4 Quick Actions — "Export Applicant PDF". */
  @Get(':id/document')
  @Can(MODULES.APPLICANTS, ACTIONS.EXPORT)
  async applicantFile(@Param('id') id: string): Promise<GeneratedDocument> {
    return this.documents.applicantFile(uuidSchema.parse(id));
  }
}

@Controller('records')
class RecordDocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  /** §11.4 — "Download Selection Letter". */
  @Get(':id/documents/selection-letter')
  @Can(MODULES.RECORDS, ACTIONS.EXPORT)
  async selectionLetter(@Param('id') id: string): Promise<GeneratedDocument> {
    return this.documents.selectionLetter(uuidSchema.parse(id));
  }

  /** §11.6 — "Generate Invoice". */
  @Get(':id/documents/invoice')
  @Can(MODULES.PAYMENTS, ACTIONS.EXPORT)
  async invoice(@Param('id') id: string): Promise<GeneratedDocument> {
    return this.documents.invoice(uuidSchema.parse(id));
  }
}

/**
 * Generated documents (§4, §11.4, §11.6).
 *
 * Separate from the modules that own the underlying data because all three
 * share the same rendering and publishing plumbing, and because none of them
 * writes anything: a document here is a view of the record, produced on demand.
 */
@Module({
  imports: [StorageModule],
  controllers: [ApplicantDocumentsController, RecordDocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
