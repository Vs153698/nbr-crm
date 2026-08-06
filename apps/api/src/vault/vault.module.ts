import { Body, Controller, Get, Module, Param, Post, Query } from '@nestjs/common';
import {
  ACTIONS,
  MODULES,
  confirmAttachmentSchema,
  confirmEvidenceSchema,
  presignUploadSchema,
  uuidSchema,
} from '@nbr/shared';
import { Can } from '../auth/auth.decorators';
import { zodBody } from '../common/zod-validation.pipe';
import type { UploadScope } from '../storage/storage.service';
import { VaultService, type EvidenceItem } from './vault.service';

@Controller('uploads')
class UploadsController {
  constructor(private readonly vault: VaultService) {}

  /**
   * Step 1 of every upload: get a presigned URL.
   *
   * The browser then PUTs the bytes straight to storage. A 200 MB record video
   * never touches this process, so uploads cannot starve the API of workers.
   */
  @Post('presign')
  @Can(MODULES.EVIDENCE, ACTIONS.CREATE)
  async presign(
    @Body(zodBody(presignUploadSchema))
    body: {
      scope: UploadScope;
      fileName: string;
      contentType: string;
      sizeBytes: number;
      recordId?: string;
      applicantId?: string;
    },
  ) {
    return this.vault.presign(body);
  }
}

@Controller('evidence')
class EvidenceController {
  constructor(private readonly vault: VaultService) {}

  /** Step 2: the browser reports the upload landed; we verify and record it. */
  @Post('confirm')
  @Can(MODULES.EVIDENCE, ACTIONS.CREATE)
  async confirm(
    @Body(zodBody(confirmEvidenceSchema))
    body: {
      recordId: string;
      kind: string;
      storageKey: string;
      fileName: string;
      contentType: string;
      sizeBytes: number;
      checksumSha256?: string;
      description?: string;
    },
  ): Promise<{ id: string }> {
    return this.vault.confirmEvidence(body);
  }

  @Get()
  @Can(MODULES.EVIDENCE, ACTIONS.VIEW)
  async list(@Query('recordId') recordId: string): Promise<EvidenceItem[]> {
    return this.vault.listEvidence(uuidSchema.parse(recordId));
  }

  /**
   * Short-lived download URL. Files flagged sensitive (ID proofs, consent
   * forms) additionally require `pii:reveal` and are written to the PII access
   * log — see VaultService.getDownloadUrl.
   */
  @Get(':id/download')
  @Can(MODULES.EVIDENCE, ACTIONS.VIEW)
  async download(@Param('id') id: string): Promise<{ url: string; fileName: string }> {
    return this.vault.getDownloadUrl(uuidSchema.parse(id));
  }
}

@Controller('attachments')
class AttachmentsController {
  constructor(private readonly vault: VaultService) {}

  @Post('confirm')
  @Can(MODULES.EVIDENCE, ACTIONS.CREATE)
  async confirm(
    @Body(zodBody(confirmAttachmentSchema))
    body: {
      applicantId?: string;
      recordId?: string;
      kind: string;
      storageKey: string;
      fileName: string;
      contentType: string;
      sizeBytes: number;
      description?: string;
    },
  ): Promise<{ id: string }> {
    return this.vault.confirmAttachment(body);
  }

  @Get()
  @Can(MODULES.EVIDENCE, ACTIONS.VIEW)
  async list(@Query('applicantId') applicantId: string) {
    return this.vault.listAttachments(uuidSchema.parse(applicantId));
  }

  @Get(':id/download')
  @Can(MODULES.EVIDENCE, ACTIONS.VIEW)
  async download(@Param('id') id: string) {
    return this.vault.getAttachmentDownloadUrl(uuidSchema.parse(id));
  }
}

@Module({
  controllers: [UploadsController, EvidenceController, AttachmentsController],
  providers: [VaultService],
  exports: [VaultService],
})
export class VaultModule {}
