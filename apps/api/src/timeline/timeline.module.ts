import { Global, Module } from '@nestjs/common';
import { TimelineService } from './timeline.service';

/**
 * Global because nearly every module writes to the timeline — a payment, a
 * certificate upload and a dispatch update all append to the same feed.
 */
@Global()
@Module({
  providers: [TimelineService],
  exports: [TimelineService],
})
export class TimelineModule {}
