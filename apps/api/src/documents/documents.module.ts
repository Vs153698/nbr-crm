import { Controller, Get, Module, Param, Query } from '@nestjs/common';
import { ACTIONS, MODULES, uuidSchema } from '@nbr/shared';
import { Can } from '../auth/auth.decorators';
import { StorageModule } from '../storage/storage.module';
import {
  DocumentsService,
  type DocumentDisposition,
  type GeneratedDocument,
} from './documents.service';

/**
 * `?mode=inline` previews; anything else downloads.
 *
 * Only the one value is recognised, and unknown input falls back to
 * `attachment` — the same convention the evidence and attachment endpoints
 * already use, so a caller learns it once.
 */
function asDisposition(mode?: string): DocumentDisposition {
  return mode === 'inline' ? 'inline' : 'attachment';
}

@Controller('applicants')
class ApplicantDocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  /** §4 Quick Actions — "Export Applicant PDF". */
  @Get(':id/document')
  @Can(MODULES.APPLICANTS, ACTIONS.EXPORT)
  async applicantFile(
    @Param('id') id: string,
    @Query('mode') mode?: string,
  ): Promise<GeneratedDocument> {
    return this.documents.applicantFile(uuidSchema.parse(id), asDisposition(mode));
  }
}

@Controller('records')
class RecordDocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  /** §11.4 — "Download Selection Letter". `?mode=inline` previews instead. */
  @Get(':id/documents/selection-letter')
  @Can(MODULES.RECORDS, ACTIONS.EXPORT)
  async selectionLetter(
    @Param('id') id: string,
    @Query('mode') mode?: string,
  ): Promise<GeneratedDocument> {
    return this.documents.selectionLetter(uuidSchema.parse(id), asDisposition(mode));
  }

  /**
   * §11.6 — the invoice.
   *
   * `?mode=inline` returns the same PDF signed to render in the browser, which
   * is what Preview and View use. An employee is expected to look at the
   * layout, the applicant's details, the amount and the GST before this goes
   * anywhere near a customer, and downloading a file to check it is a poor
   * substitute for seeing it.
   */
  @Get(':id/documents/invoice')
  @Can(MODULES.PAYMENTS, ACTIONS.EXPORT)
  async invoice(
    @Param('id') id: string,
    @Query('mode') mode?: string,
  ): Promise<GeneratedDocument> {
    return this.documents.invoice(uuidSchema.parse(id), asDisposition(mode));
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
