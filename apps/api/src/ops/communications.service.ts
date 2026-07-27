import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  buildWhatsAppLink,
  COMMUNICATION_CHANNEL,
  COMMUNICATION_STATUS,
  FLAG,
  renderTemplate,
  TEMPLATE_CHANNEL,
  TIMELINE_EVENT,
  toE164,
  validateTemplate,
  type TemplateContext,
} from '@nbr/shared';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { AUDIT, AuditService } from '../audit/audit.service';
import { ForbiddenError, NotFoundError, ValidationError } from '../common/errors';
import { requireActor } from '../common/request-context';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import type { Database } from '../database/client';
import { DB } from '../database/database.tokens';
import * as schema from '../database/schema';
import { MailService } from '../mail/mail.service';
import { CacheService, CacheTag } from '../redis/cache.service';
import { TimelineService } from '../timeline/timeline.service';

export interface RenderedMessage {
  readonly subject: string | null;
  readonly body: string;
  readonly missing: readonly string[];
  readonly to: string | null;
}

/**
 * Communication (§7, §8, §22 — P2-06, P2-07, P2-08).
 *
 * Three rules:
 *
 *  • **The rendered text is stored, not the template id.** Reword a template
 *    next year and the history still shows exactly what the applicant received.
 *  • **DO NOT CONTACT is enforced server-side.** Hiding the button is a
 *    courtesy; refusing the send is the actual control.
 *  • **Email never blocks a request.** The row is written as `queued` and a
 *    worker sends it, so the API answers in milliseconds and a slow SMTP server
 *    cannot stall the UI.
 */
@Injectable()
export class CommunicationsService {
  private readonly logger = new Logger(CommunicationsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly mail: MailService,
    private readonly timeline: TimelineService,
    private readonly audit: AuditService,
    private readonly cache: CacheService,
  ) {}

  /**
   * Build the merge context for a record from live data.
   *
   * Everything a template may reference is resolved here in one pass, so a
   * preview and the eventual send can never differ.
   */
  async buildContext(recordId: string): Promise<{
    context: TemplateContext;
    applicantId: string;
    email: string;
    whatsapp: string | null;
    doNotContact: boolean;
  }> {
    const [row] = await this.db
      .select({
        applicantId: schema.applicants.id,
        applicantCode: schema.applicants.applicantCode,
        fullName: schema.applicants.fullName,
        email: schema.applicants.email,
        mobile: schema.applicants.mobile,
        whatsapp: schema.applicants.whatsapp,
        recordCode: schema.records.recordCode,
        status: schema.records.status,
        recordTitle: schema.achievements.recordTitle,
        categoryName: schema.categories.name,
        assignedToName: schema.users.fullName,
      })
      .from(schema.records)
      .innerJoin(schema.applicants, eq(schema.records.applicantId, schema.applicants.id))
      .leftJoin(schema.achievements, eq(schema.achievements.recordId, schema.records.id))
      .leftJoin(schema.categories, eq(schema.achievements.categoryId, schema.categories.id))
      .leftJoin(schema.users, eq(schema.records.assignedToUserId, schema.users.id))
      .where(and(eq(schema.records.id, recordId), isNull(schema.records.deletedAt)))
      .limit(1);

    if (!row) throw new NotFoundError('Record');

    const [payment] = await this.db
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.recordId, recordId))
      .limit(1);

    const [certificate] = await this.db
      .select()
      .from(schema.certificates)
      .where(eq(schema.certificates.recordId, recordId))
      .limit(1);

    const [dispatch] = await this.db
      .select()
      .from(schema.dispatches)
      .where(and(eq(schema.dispatches.recordId, recordId), eq(schema.dispatches.isCurrent, true)))
      .limit(1);

    const [publication] = await this.db
      .select()
      .from(schema.publications)
      .where(eq(schema.publications.recordId, recordId))
      .orderBy(desc(schema.publications.createdAt))
      .limit(1);

    const [invoice] = payment
      ? await this.db
          .select()
          .from(schema.invoices)
          .where(eq(schema.invoices.paymentId, payment.id))
          .orderBy(desc(schema.invoices.issuedOn))
          .limit(1)
      : [];

    const [latestTransaction] = payment
      ? await this.db
          .select()
          .from(schema.paymentTransactions)
          .where(eq(schema.paymentTransactions.paymentId, payment.id))
          .orderBy(desc(schema.paymentTransactions.paidOn))
          .limit(1)
      : [];

    const doNotContact = await this.hasFlag(row.applicantId, FLAG.DO_NOT_CONTACT);

    const balance = payment
      ? (Math.round(Number(payment.finalAmount) * 100) -
          Math.round(Number(payment.amountPaid) * 100)) /
        100
      : 0;

    const daysRemaining = payment?.dueDate
      ? Math.ceil((payment.dueDate.getTime() - Date.now()) / 86_400_000)
      : null;

    const context: TemplateContext = {
      applicant_name: row.fullName,
      applicant_first_name: row.fullName.split(/\s+/)[0],
      applicant_id: row.applicantCode,
      record_id: row.recordCode,
      record_title: row.recordTitle ?? undefined,
      category: row.categoryName ?? undefined,
      status: row.status,
      assigned_employee: row.assignedToName ?? undefined,
      package_name: payment?.packageName,
      amount: payment?.finalAmount,
      amount_paid: payment?.amountPaid,
      balance_due: payment ? balance.toFixed(2) : undefined,
      due_date: payment?.dueDate ? formatIsoDate(payment.dueDate) : undefined,
      days_remaining: daysRemaining !== null ? String(daysRemaining) : undefined,
      invoice_number: invoice?.invoiceNumber,
      transaction_id: latestTransaction?.transactionRef ?? undefined,
      certificate_no: certificate?.certificateNumber ?? undefined,
      certificate_issue_date: certificate?.issueDate ? formatIsoDate(certificate.issueDate) : undefined,
      courier_partner: dispatch?.courierPartner,
      tracking_no: dispatch?.trackingNumber ?? undefined,
      tracking_url: dispatch?.trackingUrl ?? undefined,
      dispatch_date: dispatch?.dispatchedOn ? formatIsoDate(dispatch.dispatchedOn) : undefined,
      magazine_name: publication?.magazineName ?? undefined,
      magazine_page: publication?.pageNumber ?? undefined,
      article_url: publication?.url ?? undefined,
      organisation_name: this.env.DPDP_DATA_FIDUCIARY_NAME,
      support_email: this.env.MAIL_FROM_ADDRESS,
      support_phone: this.env.DPDP_GRIEVANCE_OFFICER_PHONE ?? undefined,
      today: formatIsoDate(new Date()),
    };

    return {
      context,
      applicantId: row.applicantId,
      email: row.email,
      whatsapp: row.whatsapp ?? row.mobile,
      doNotContact,
    };
  }

  /** M-07 live preview — the same render the send will perform. */
  async preview(recordId: string, templateCode: string, channel: string): Promise<RenderedMessage> {
    const [template] = await this.db
      .select()
      .from(schema.templates)
      .where(
        and(
          eq(schema.templates.code, templateCode),
          eq(schema.templates.channel, channel),
          eq(schema.templates.isActive, true),
        ),
      )
      .limit(1);

    if (!template) throw new NotFoundError('Template');

    const { context, email, whatsapp } = await this.buildContext(recordId);

    const body = renderTemplate(template.body, context);
    const subject = template.subject ? renderTemplate(template.subject, context) : null;

    return {
      subject: subject?.output ?? null,
      body: body.output,
      // Surfaced so the modal can warn "certificate number is missing" *before*
      // an email goes out with a blank in it.
      missing: [...new Set([...body.missing, ...(subject?.missing ?? [])])],
      to: channel === TEMPLATE_CHANNEL.WHATSAPP ? whatsapp : email,
    };
  }

  /**
   * Queue an email (§7). Returns immediately; a worker performs the send.
   *
   * The row is the queue: `status='queued'` with `attemptCount`, so a crash
   * between write and send loses nothing and the retry is visible to staff.
   */
  async sendEmail(input: {
    recordId: string;
    templateCode?: string;
    to: string;
    cc?: string[];
    subject: string;
    body: string;
    attachmentKeys?: string[];
  }): Promise<{ communicationId: string; status: string }> {
    const actor = requireActor();
    const { applicantId, doNotContact } = await this.buildContext(input.recordId);

    if (doNotContact) {
      throw new ForbiddenError(
        'This applicant is flagged Do Not Contact. Remove the flag before sending anything.',
      );
    }

    const [communication] = await this.db
      .insert(schema.communications)
      .values({
        applicantId,
        recordId: input.recordId,
        channel: COMMUNICATION_CHANNEL.EMAIL,
        direction: 'outbound',
        templateCode: input.templateCode ?? null,
        toAddress: input.to,
        ccAddresses: input.cc ?? null,
        subject: input.subject,
        // The rendered text, not a template reference — history must survive
        // the template being reworded.
        body: input.body,
        attachmentKeys: input.attachmentKeys ?? [],
        status: COMMUNICATION_STATUS.QUEUED,
        queuedAt: new Date(),
        sentByUserId: actor.userId,
        sentByName: actor.fullName,
      })
      .returning({ id: schema.communications.id });

    const communicationId = communication!.id;

    // Dispatched without awaiting so the caller gets its 202 immediately.
    void this.deliver(communicationId, input);

    await this.timeline.write({
      applicantId,
      recordId: input.recordId,
      eventType: TIMELINE_EVENT.EMAIL_SENT,
      summary: `Email queued — ${input.subject}`,
      meta: { to: input.to, templateCode: input.templateCode ?? null },
    });

    await this.audit.record({
      action: AUDIT.EMAIL_SENT,
      entityType: 'communication',
      entityId: communicationId,
      entityLabel: input.subject,
      meta: { to: input.to },
    });

    return { communicationId, status: COMMUNICATION_STATUS.QUEUED };
  }

  /**
   * Perform the actual SMTP send and record the outcome.
   *
   * Errors are caught and written to the row rather than thrown — the caller
   * has already been answered, and a failed send must be visible in the
   * communication history rather than only in a log file.
   */
  private async deliver(
    communicationId: string,
    input: { to: string; cc?: string[]; subject: string; body: string },
  ): Promise<void> {
    try {
      const result = await this.mail.send({
        to: input.to,
        cc: input.cc,
        subject: input.subject,
        text: input.body,
      });

      await this.db
        .update(schema.communications)
        .set({
          status: COMMUNICATION_STATUS.SENT,
          sentAt: new Date(),
          providerMessageId: result.messageId,
          attemptCount: sql`${schema.communications.attemptCount} + 1`,
        })
        .where(eq(schema.communications.id, communicationId));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Email ${communicationId} failed: ${message}`);

      await this.db
        .update(schema.communications)
        .set({
          status: COMMUNICATION_STATUS.FAILED,
          failedAt: new Date(),
          failureReason: message,
          attemptCount: sql`${schema.communications.attemptCount} + 1`,
        })
        .where(eq(schema.communications.id, communicationId));
    }
  }

  /** Retry a failed send from the communication history. */
  async retry(communicationId: string): Promise<{ status: string }> {
    const [communication] = await this.db
      .select()
      .from(schema.communications)
      .where(eq(schema.communications.id, communicationId))
      .limit(1);

    if (!communication) throw new NotFoundError('Message');
    if (communication.status === COMMUNICATION_STATUS.SENT) {
      throw new ValidationError({ _: ['That message was already sent.'] });
    }
    if (!communication.toAddress) {
      throw new ValidationError({ _: ['That message has no recipient address.'] });
    }

    await this.db
      .update(schema.communications)
      .set({ status: COMMUNICATION_STATUS.QUEUED, failureReason: null })
      .where(eq(schema.communications.id, communicationId));

    void this.deliver(communicationId, {
      to: communication.toAddress,
      cc: communication.ccAddresses ?? undefined,
      subject: communication.subject ?? '',
      body: communication.body,
    });

    return { status: COMMUNICATION_STATUS.QUEUED };
  }

  /**
   * M-08 WhatsApp click-to-chat (§8).
   *
   * Phase 1–2 does not use the WhatsApp Business API — that is explicitly a
   * future phase. Staff click a wa.me deep link with the message prefilled,
   * then confirm they sent it, which is what makes the history honest rather
   * than assuming delivery.
   */
  async whatsappLink(input: {
    recordId: string;
    templateCode: string;
    bodyOverride?: string;
  }): Promise<{ communicationId: string; link: string; body: string; to: string }> {
    const actor = requireActor();
    const { applicantId, whatsapp, doNotContact } = await this.buildContext(input.recordId);

    if (doNotContact) {
      throw new ForbiddenError('This applicant is flagged Do Not Contact.');
    }
    if (!whatsapp) {
      throw new ValidationError({ _: ['This applicant has no WhatsApp or mobile number on file.'] });
    }

    const rendered =
      input.bodyOverride ??
      (await this.preview(input.recordId, input.templateCode, TEMPLATE_CHANNEL.WHATSAPP)).body;

    const e164 = toE164(whatsapp);
    if (!e164) {
      throw new ValidationError({ _: ['That mobile number is not in a format WhatsApp accepts.'] });
    }

    const [communication] = await this.db
      .insert(schema.communications)
      .values({
        applicantId,
        recordId: input.recordId,
        channel: COMMUNICATION_CHANNEL.WHATSAPP,
        direction: 'outbound',
        templateCode: input.templateCode,
        toAddress: e164,
        body: rendered,
        // Not "sent" — nobody has confirmed anything left the device yet.
        status: COMMUNICATION_STATUS.QUEUED,
        queuedAt: new Date(),
        sentByUserId: actor.userId,
        sentByName: actor.fullName,
      })
      .returning({ id: schema.communications.id });

    return {
      communicationId: communication!.id,
      link: buildWhatsAppLink(e164, rendered),
      body: rendered,
      to: e164,
    };
  }

  /** Staff confirm the WhatsApp message actually went out. */
  async markWhatsappSent(communicationId: string): Promise<void> {
    const [communication] = await this.db
      .select()
      .from(schema.communications)
      .where(eq(schema.communications.id, communicationId))
      .limit(1);

    if (!communication) throw new NotFoundError('Message');

    await this.db
      .update(schema.communications)
      .set({ status: COMMUNICATION_STATUS.MARKED_SENT, sentAt: new Date() })
      .where(eq(schema.communications.id, communicationId));

    await this.timeline.write({
      applicantId: communication.applicantId,
      recordId: communication.recordId,
      eventType: TIMELINE_EVENT.WHATSAPP_SENT,
      summary: `WhatsApp sent — ${communication.templateCode ?? 'message'}`,
      meta: { to: communication.toAddress },
    });

    await this.audit.record({
      action: AUDIT.WHATSAPP_SENT,
      entityType: 'communication',
      entityId: communicationId,
      entityLabel: communication.templateCode ?? 'WhatsApp',
    });
  }

  /** §22 Call notes. */
  async logCall(input: {
    applicantId: string;
    recordId?: string;
    summary: string;
    durationMinutes?: number;
    outcome?: string;
    followUpDate?: Date;
  }): Promise<{ id: string }> {
    const actor = requireActor();

    const [communication] = await this.db
      .insert(schema.communications)
      .values({
        applicantId: input.applicantId,
        recordId: input.recordId ?? null,
        channel: COMMUNICATION_CHANNEL.CALL,
        direction: 'outbound',
        body: input.summary,
        status: COMMUNICATION_STATUS.SENT,
        sentAt: new Date(),
        callDurationMinutes: input.durationMinutes ?? null,
        callOutcome: input.outcome ?? null,
        sentByUserId: actor.userId,
        sentByName: actor.fullName,
      })
      .returning({ id: schema.communications.id });

    await this.timeline.write({
      applicantId: input.applicantId,
      recordId: input.recordId ?? null,
      eventType: TIMELINE_EVENT.CALL_LOGGED,
      summary: `Call logged — ${input.summary.slice(0, 80)}`,
      meta: { durationMinutes: input.durationMinutes ?? null, outcome: input.outcome ?? null },
    });

    return { id: communication!.id };
  }

  /** §22 unified history, filterable by channel. */
  async history(filters: { applicantId?: string; recordId?: string; channel?: string }) {
    const conditions = [];
    if (filters.recordId) conditions.push(eq(schema.communications.recordId, filters.recordId));
    else if (filters.applicantId) {
      conditions.push(eq(schema.communications.applicantId, filters.applicantId));
    }
    if (filters.channel) conditions.push(eq(schema.communications.channel, filters.channel));

    const rows = await this.db
      .select({
        id: schema.communications.id,
        channel: schema.communications.channel,
        templateCode: schema.communications.templateCode,
        toAddress: schema.communications.toAddress,
        subject: schema.communications.subject,
        body: schema.communications.body,
        status: schema.communications.status,
        sentAt: schema.communications.sentAt,
        failedAt: schema.communications.failedAt,
        failureReason: schema.communications.failureReason,
        attemptCount: schema.communications.attemptCount,
        callDurationMinutes: schema.communications.callDurationMinutes,
        callOutcome: schema.communications.callOutcome,
        sentByName: schema.communications.sentByName,
        createdAt: schema.communications.createdAt,
      })
      .from(schema.communications)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.communications.createdAt))
      .limit(200);

    return rows.map((row) => ({
      ...row,
      sentAt: row.sentAt?.toISOString() ?? null,
      failedAt: row.failedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  // ── Template manager (W-26) ───────────────────────────────────────────────

  async listTemplates() {
    return this.cache.remember('templates:all', 600, [CacheTag.templates()], () =>
      this.db
        .select({
          id: schema.templates.id,
          code: schema.templates.code,
          channel: schema.templates.channel,
          name: schema.templates.name,
          subject: schema.templates.subject,
          body: schema.templates.body,
          isActive: schema.templates.isActive,
          updatedAt: schema.templates.updatedAt,
        })
        .from(schema.templates)
        .orderBy(schema.templates.channel, schema.templates.code),
    );
  }

  /**
   * Save a template.
   *
   * Placeholders are validated here rather than at send time — a typo like
   * `{{applicnat_name}}` should fail when the Admin saves it, not silently
   * render as an empty string in an applicant's email six weeks later.
   */
  async upsertTemplate(input: {
    code: string;
    channel: string;
    name: string;
    subject?: string;
    body: string;
    isActive: boolean;
  }): Promise<{ id: string }> {
    const actor = requireActor();

    const bodyCheck = validateTemplate(input.body);
    const subjectCheck = input.subject
      ? validateTemplate(input.subject)
      : { valid: true, unknown: [] as string[] };

    if (!bodyCheck.valid || !subjectCheck.valid) {
      const unknown = [...new Set([...bodyCheck.unknown, ...subjectCheck.unknown])];
      throw new ValidationError({
        body: [
          `Unknown placeholder${unknown.length === 1 ? '' : 's'}: ${unknown.map((u) => `{{${u}}}`).join(', ')}. Check the field list.`,
        ],
      });
    }

    const values = {
      code: input.code,
      channel: input.channel,
      name: input.name,
      subject: input.subject ?? null,
      body: input.body,
      isActive: input.isActive,
      updatedByUserId: actor.userId,
    };

    const [template] = await this.db
      .insert(schema.templates)
      .values(values)
      .onConflictDoUpdate({
        target: [schema.templates.code, schema.templates.channel],
        set: values,
      })
      .returning({ id: schema.templates.id });

    await this.cache.invalidateTags(CacheTag.templates());

    await this.audit.record({
      action: AUDIT.TEMPLATE_UPDATED,
      entityType: 'template',
      entityId: template!.id,
      entityLabel: `${input.channel}/${input.code}`,
    });

    return { id: template!.id };
  }

  private async hasFlag(applicantId: string, flag: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: schema.applicantFlags.id })
      .from(schema.applicantFlags)
      .where(
        and(
          eq(schema.applicantFlags.applicantId, applicantId),
          eq(schema.applicantFlags.flag, flag),
          isNull(schema.applicantFlags.removedAt),
        ),
      )
      .limit(1);
    return Boolean(row);
  }
}

/** Templates render dates in the applicant-facing "15 Aug 2026" form. */
function formatIsoDate(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(date);
}
