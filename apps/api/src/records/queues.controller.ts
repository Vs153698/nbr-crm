import { Controller, Get } from '@nestjs/common';
import { ACTIONS, MODULES } from '@nbr/shared';
import { Can } from '../auth/auth.decorators';
import { QueuesService } from './queues.service';

/**
 * W-19 / W-20 / W-22 — the three record-driven work queues.
 *
 * Each is permissioned against its own module rather than `records:view`, so a
 * Finance user sees the payments queue without also gaining the verification
 * one.
 */
@Controller('queues')
export class QueuesController {
  constructor(private readonly queues: QueuesService) {}

  @Get('verification')
  @Can(MODULES.VERIFICATION, ACTIONS.VIEW)
  async verification() {
    return this.queues.verification();
  }

  @Get('payments')
  @Can(MODULES.PAYMENTS, ACTIONS.VIEW)
  async payments() {
    return this.queues.payments();
  }

  @Get('publications')
  @Can(MODULES.PUBLICATIONS, ACTIONS.VIEW)
  async publications() {
    return this.queues.publications();
  }
}
