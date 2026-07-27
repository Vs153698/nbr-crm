import { Body, Controller, Get, Module, Param, Post, Query } from '@nestjs/common';
import {
  ACTIONS,
  MODULES,
  createPaymentPlanSchema,
  createPublicationSchema,
  recordTransactionSchema,
  trimmedString,
  uploadCertificateSchema,
  upsertDispatchSchema,
  uuidSchema,
} from '@nbr/shared';
import { z } from 'zod';
import { Can } from '../auth/auth.decorators';
import { zodBody } from '../common/zod-validation.pipe';
import { CertificatesService } from '../fulfilment/certificates.service';
import { DispatchService } from '../fulfilment/dispatch.service';
import { PaymentsService, type PaymentSummary } from './payments.service';

const reverseSchema = z.object({ reason: trimmedString(500) });

@Controller('payments')
class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  @Can(MODULES.PAYMENTS, ACTIONS.VIEW)
  async byRecord(@Query('recordId') recordId: string): Promise<PaymentSummary | null> {
    return this.payments.getByRecord(uuidSchema.parse(recordId));
  }

  /** §11 stage 4 — raise the payment and set its deadline. */
  @Post('plan')
  @Can(MODULES.PAYMENTS, ACTIONS.CREATE)
  async createPlan(
    @Body(zodBody(createPaymentPlanSchema))
    body: {
      recordId: string;
      packageId?: string;
      packageName: string;
      amount: string;
      gstPercent: string;
      discount: string;
      dueDate?: Date;
      notes?: string;
    },
  ) {
    return this.payments.createPlan(body);
  }

  /** M-03 Record Payment — partial and multiple payments supported. */
  @Post('transactions')
  @Can(MODULES.PAYMENTS, ACTIONS.CREATE)
  async recordTransaction(
    @Body(zodBody(recordTransactionSchema))
    body: {
      paymentId: string;
      amount: string;
      paidOn: Date;
      mode: string;
      transactionRef?: string;
      receiptKey?: string;
      remarks?: string;
      idempotencyKey?: string;
    },
  ) {
    return this.payments.recordTransaction(body);
  }

  /** Appends a negative correction rather than deleting the original entry. */
  @Post('transactions/:id/reverse')
  @Can(MODULES.PAYMENTS, ACTIONS.EDIT)
  async reverse(@Param('id') id: string, @Body(zodBody(reverseSchema)) body: { reason: string }) {
    return this.payments.reverseTransaction(uuidSchema.parse(id), body.reason);
  }

  @Post(':id/invoice')
  @Can(MODULES.PAYMENTS, ACTIONS.EXPORT)
  async generateInvoice(@Param('id') id: string) {
    return this.payments.generateInvoice(uuidSchema.parse(id));
  }
}

@Controller('certificates')
class CertificatesController {
  constructor(private readonly certificates: CertificatesService) {}

  @Get()
  @Can(MODULES.CERTIFICATES, ACTIONS.VIEW)
  async byRecord(@Query('recordId') recordId: string) {
    return this.certificates.getByRecord(uuidSchema.parse(recordId));
  }

  /** W-21 — records that have been paid for but have no certificate yet. */
  @Get('queue')
  @Can(MODULES.CERTIFICATES, ACTIONS.VIEW)
  async queue() {
    return this.certificates.pendingQueue();
  }

  /** M-04 — always appends a version; there is no replace path. */
  @Post()
  @Can(MODULES.CERTIFICATES, ACTIONS.CREATE)
  async upload(
    @Body(zodBody(uploadCertificateSchema))
    body: {
      recordId: string;
      certificateNumber?: string;
      recordNumber?: string;
      issueDate: Date;
      pdfKey: string;
      editableFileKey?: string;
      versionReason?: string;
    },
  ) {
    return this.certificates.upload(body);
  }

  /** Superseded versions stay downloadable — that is the point of keeping them. */
  @Get('versions/:id/download')
  @Can(MODULES.CERTIFICATES, ACTIONS.VIEW)
  async download(@Param('id') id: string, @Query('file') file?: string) {
    return this.certificates.getVersionDownloadUrl(
      uuidSchema.parse(id),
      file === 'editable' ? 'editable' : 'pdf',
    );
  }
}

@Controller('publications')
class PublicationsController {
  constructor(private readonly dispatch: DispatchService) {}

  @Get()
  @Can(MODULES.PUBLICATIONS, ACTIONS.VIEW)
  async list(@Query('recordId') recordId: string) {
    return this.dispatch.listPublications(uuidSchema.parse(recordId));
  }

  @Post()
  @Can(MODULES.PUBLICATIONS, ACTIONS.CREATE)
  async create(
    @Body(zodBody(createPublicationSchema))
    body: {
      recordId: string;
      kind: string;
      title: string;
      publishedOn?: Date;
      magazineName?: string;
      pageNumber?: string;
      url?: string;
      fileKey?: string;
      notes?: string;
    },
  ) {
    return this.dispatch.addPublication(body);
  }

  @Get(':id/download')
  @Can(MODULES.PUBLICATIONS, ACTIONS.VIEW)
  async download(@Param('id') id: string) {
    return this.dispatch.getPublicationDownloadUrl(uuidSchema.parse(id));
  }
}

@Controller('dispatch')
class DispatchController {
  constructor(private readonly dispatch: DispatchService) {}

  @Get()
  @Can(MODULES.DISPATCH, ACTIONS.VIEW)
  async byRecord(@Query('recordId') recordId: string) {
    return this.dispatch.getDispatch(uuidSchema.parse(recordId));
  }

  /** W-23 — the dispatch queue. */
  @Get('queue')
  @Can(MODULES.DISPATCH, ACTIONS.VIEW)
  async queue() {
    return this.dispatch.pendingQueue();
  }

  /** M-06 Update Dispatch. */
  @Post()
  @Can(MODULES.DISPATCH, ACTIONS.CREATE)
  async upsert(
    @Body(zodBody(upsertDispatchSchema))
    body: {
      recordId: string;
      courierPartner: string;
      trackingNumber?: string;
      trackingUrl?: string;
      dispatchedOn?: Date;
      deliveryStatus: string;
      deliveredOn?: Date;
      podKey?: string;
      contents?: string;
      remarks?: string;
      notifyApplicant: boolean;
    },
  ) {
    // The tracking URL is derived from the courier's template when the caller
    // does not supply one, so staff never have to paste a tracking link.
    const trackingUrl =
      body.trackingUrl ??
      (body.trackingNumber
        ? ((await this.dispatch.buildTrackingUrl(body.courierPartner, body.trackingNumber)) ??
          undefined)
        : undefined);

    return this.dispatch.upsertDispatch({ ...body, trackingUrl });
  }

  @Get(':id/pod')
  @Can(MODULES.DISPATCH, ACTIONS.VIEW)
  async pod(@Param('id') id: string) {
    return this.dispatch.getPodDownloadUrl(uuidSchema.parse(id));
  }
}

/**
 * The money and fulfilment half of Phase 2 (P2-01…P2-04).
 *
 * One module because these four stages run back-to-back on the same record and
 * share the vault, timeline and cache-invalidation plumbing.
 */
@Module({
  controllers: [
    PaymentsController,
    CertificatesController,
    PublicationsController,
    DispatchController,
  ],
  providers: [PaymentsService, CertificatesService, DispatchService],
  exports: [PaymentsService, CertificatesService, DispatchService],
})
export class PaymentsModule {}
