import { Global, Module } from '@nestjs/common';
import { PiiService } from './pii.service';

/**
 * DPDP Act, 2023 services.
 *
 * Global because identifier encryption is needed anywhere applicant data is
 * written, and because keeping exactly one `FieldCipher` instance means the
 * encryption key is loaded and validated once at boot rather than per module.
 */
@Global()
@Module({
  providers: [PiiService],
  exports: [PiiService],
})
export class PrivacyModule {}
