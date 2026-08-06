import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';

/**
 * Object storage is infrastructure, like the database and the cache — the
 * evidence vault, certificates, receipts, invoices, publications, proofs of
 * delivery and report exports all need it.
 *
 * Global rather than imported per module so there is exactly one S3 client,
 * and so adding a new module that stores a file does not require touching this
 * wiring.
 */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
