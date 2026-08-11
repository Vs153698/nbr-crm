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

  /**
   * §Pipeline 1 — arrived, nobody has started on it.
   *
   * Permissioned against Verification rather than Records: the people who work
   * this list are the ones who will verify it, and giving it its own module
   * would mean a new permission on every role for no separation anybody wanted.
   */
  @Get('new-applications')
  @Can(MODULES.VERIFICATION, ACTIONS.VIEW)
  async newApplications() {
    return this.queues.newApplications();
  }

  @Get('verification')
  @Can(MODULES.VERIFICATION, ACTIONS.VIEW)
  async verification() {
    return this.queues.verification();
  }

  /**
   * Verified records waiting on an approve/reject decision.
   *
   * Its own queue rather than a filter on the verification one, because it has
   * a different owner: a verifier works through documents, an approver works
   * through decisions, and merging them meant neither could see what was
   * actually theirs.
   */
  @Get('approvals')
  @Can(MODULES.VERIFICATION, ACTIONS.VIEW)
  async approvals() {
    return this.queues.approvals();
  }

  /**
   * §Pipeline 4 — approved, selection letter due or sent, payment not raised.
   *
   * Permissioned on Communications rather than Payments: the outstanding work
   * here is writing to the applicant, and a finance user with no send rights
   * has nothing to do with the list.
   */
  @Get('selection-sent')
  @Can(MODULES.COMMUNICATIONS, ACTIONS.VIEW)
  async selectionSent() {
    return this.queues.selectionSent();
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
