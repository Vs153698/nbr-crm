import { Global, Module } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppWorkbookService } from './whatsapp-workbook.service';

/**
 * Global, same as `MailModule`: both the communications module (sending) and
 * the settings screen (configuring, testing) need this service, and those two
 * live in different feature modules that do not otherwise depend on each
 * other. Making the module import graph express that dependency would mean
 * one of them importing the other for a single service — global avoids
 * inventing an edge that has nothing to do with what either module is for.
 */
@Global()
@Module({
  providers: [WhatsAppService, WhatsAppWorkbookService],
  exports: [WhatsAppService, WhatsAppWorkbookService],
})
export class WhatsAppModule {}
