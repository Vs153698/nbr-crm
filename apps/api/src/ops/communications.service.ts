import { Inject, Injectable, Logger } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  buildWhatsAppLink,
  COMMUNICATION_CHANNEL,
  COMMUNICATION_STATUS,
  FLAG,
  editableStrings,
  renderEmail,
  renderEmailShell,
  renderTemplate,
  TEMPLATE_CHANNEL,
  TIMELINE_EVENT,
  toE164,
  toPlainText,
  validateTemplate,
  type EmailDocument,
  type TemplateContext,
  isSystemTemplateCode,
  TASK_PRIORITY,
  TEMPLATE_CODE,
  renderSelectionLetter,
  renderSelectionLetterText,
  selectionLetterSubject,
  SELECTION_KIND_META,
  CONFIDENTIAL_STAMP_CID,
  type SelectionLetterInput,
  type SelectionLetterOrganisation,
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
import { StorageService } from '../storage/storage.service';
import { CacheService, CacheTag } from '../redis/cache.service';
import { TimelineService } from '../timeline/timeline.service';
import { TasksService } from './tasks.service';

export interface RenderedMessage {
  readonly subject: string | null;
  /** Plain text — what the history stores, and the alternative part of the mail. */
  readonly body: string;
  /** The email as the recipient will see it. Null for WhatsApp. */
  readonly html: string | null;
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
/**
 * The Achiever Pack options PDF, attached to every selection letter.
 *
 * Resolved from `__dirname` so it works under tsx from `src` and after a build
 * from `dist` — nest-cli copies `mail/assets` alongside the compiled output.
 */
const ACHIEVER_PACK_PATH = join(__dirname, '..', 'mail', 'assets', 'nbr-achiever-pack-2026.pdf');
const ACHIEVER_PACK_FILENAME = 'NBR National Achiever Pack Recognition Packages 2026';
const CONFIDENTIAL_STAMP_PATH = join(__dirname, '..', 'mail', 'assets', 'confidential-stamp.png');

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
    private readonly tasks: TasksService,
    // Signs the per-attachment links on the message detail view.
    private readonly storage: StorageService,
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

    const subject = template.subject ? renderTemplate(template.subject, context) : null;

    /**
     * An email with content areas renders through the same function the send
     * uses, so the preview is the message rather than an approximation of it.
     * WhatsApp has no HTML and keeps its plain-text path.
     */
    const rendered =
      template.document && channel === TEMPLATE_CHANNEL.EMAIL
        ? renderEmail(template.document, context, this.env.DPDP_DATA_FIDUCIARY_NAME)
        : null;

    const body = rendered ? null : renderTemplate(template.body, context);

    return {
      subject: subject?.output ?? null,
      body: rendered ? rendered.text : body!.output,
      // The rendered document, so the modal can show the recipient's view.
      html: rendered?.html ?? null,
      // Surfaced so the modal can warn "certificate number is missing" *before*
      // an email goes out with a blank in it.
      missing: [
        ...new Set([
          ...(rendered ? rendered.missing : body!.missing),
          ...(subject?.missing ?? []),
        ]),
      ],
      to: channel === TEMPLATE_CHANNEL.WHATSAPP ? whatsapp : email,
    };
  }

  /**
   * The HTML that actually goes out, built here rather than accepted from the
   * client.
   *
   * Markup arriving over the wire would be markup the organisation signs its
   * name to without having seen it, and the stored history would then describe
   * something other than what was delivered.
   *
   * An untouched templated send is re-rendered from the stored document
   * against the live record, so its highlighted values, tables and steps
   * survive — flattening the previewed text into one paragraph would throw all
   * of that away. Once the employee has rewritten the message, their words win
   * and get the shell wrapped around them; so does a free-typed message. Either
   * way every email leaving this system looks like the website's.
   */
  private async buildOutboundHtml(input: {
    recordId: string;
    templateCode?: string;
    subject: string;
    body: string;
    bodyEdited?: boolean;
  }): Promise<string> {
    if (input.templateCode && !input.bodyEdited) {
      const [template] = await this.db
        .select()
        .from(schema.templates)
        .where(
          and(
            eq(schema.templates.code, input.templateCode),
            eq(schema.templates.channel, TEMPLATE_CHANNEL.EMAIL),
          ),
        )
        .limit(1);

      if (template?.document) {
        const { context } = await this.buildContext(input.recordId);
        return renderEmail(template.document, context, this.env.DPDP_DATA_FIDUCIARY_NAME).html;
      }
    }

    return renderEmailShell(
      { heading: input.subject, blocks: [{ type: 'paragraph', text: input.body }] },
      this.env.DPDP_DATA_FIDUCIARY_NAME,
    );
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
    bodyEdited?: boolean;
    attachmentKeys?: string[];
  }): Promise<{ communicationId: string; status: string }> {
    const actor = requireActor();
    const { applicantId, doNotContact } = await this.buildContext(input.recordId);

    if (doNotContact) {
      throw new ForbiddenError(
        'This applicant is flagged Do Not Contact. Remove the flag before sending anything.',
      );
    }

    const html = await this.buildOutboundHtml(input);

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
    void this.deliver(communicationId, { ...input, html });

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
    input: {
      to: string;
      cc?: string[];
      subject: string;
      body: string;
      html?: string;
      attachments?: Array<{
        filename: string;
        content: Buffer;
        contentType?: string;
        /** Embeds the file in the body via `src="cid:…"` instead of attaching it. */
        cid?: string;
      }>;
    },
  ): Promise<void> {
    try {
      const result = await this.mail.send({
        to: input.to,
        cc: input.cc,
        subject: input.subject,
        // Both parts: the HTML is what nearly everyone sees, and the text is
        // what remains readable in a client that refuses to render it.
        text: input.body,
        html: input.html,
        attachments: input.attachments,
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

    // Rebuilt rather than reused, because the HTML was never stored — only the
    // text was. Without this a retry would quietly go out as plain text and
    // look nothing like the message the first attempt tried to send.
    const html = communication.recordId
      ? await this.buildOutboundHtml({
          recordId: communication.recordId,
          templateCode: communication.templateCode ?? undefined,
          subject: communication.subject ?? '',
          body: communication.body,
        })
      : undefined;

    void this.deliver(communicationId, {
      to: communication.toAddress,
      cc: communication.ccAddresses ?? undefined,
      subject: communication.subject ?? '',
      body: communication.body,
      html,
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
  }): Promise<{ id: string; followUpTaskId: string | null }> {
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

    /**
     * A follow-up date becomes a real task.
     *
     * It was previously accepted by the endpoint and then dropped on the floor:
     * the caller typed "ring back on Tuesday", the API returned 200, and nothing
     * anywhere remembered it. A task is the right home — it is what the
     * Tasks & Follow-ups board reads, what the overdue notification job checks,
     * and what the sales report counts as missed.
     */
    let followUpTaskId: string | null = null;
    if (input.followUpDate) {
      const { id } = await this.tasks.create({
        applicantId: input.applicantId,
        recordId: input.recordId,
        title: `Follow up on call${input.outcome ? ` — ${input.outcome}` : ''}`,
        description: input.summary,
        // Whoever made the call owns the callback unless it is reassigned.
        assignedToUserId: actor.userId,
        dueDate: input.followUpDate,
        priority: TASK_PRIORITY.NORMAL,
      });
      followUpTaskId = id;
    }

    await this.timeline.write({
      applicantId: input.applicantId,
      recordId: input.recordId ?? null,
      eventType: TIMELINE_EVENT.CALL_LOGGED,
      summary: `Call logged — ${input.summary.slice(0, 80)}`,
      meta: {
        durationMinutes: input.durationMinutes ?? null,
        outcome: input.outcome ?? null,
        followUpDate: input.followUpDate?.toISOString() ?? null,
        followUpTaskId,
      },
    });

    return { id: communication!.id, followUpTaskId };
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

  /**
   * One message, in full (§22 Email History).
   *
   * Its own endpoint rather than fatter rows on the list. The history is capped
   * at 200 entries and every one of them would otherwise carry a full body, its
   * CC list and a signed URL per attachment — a few hundred kilobytes and a
   * burst of storage signing to render a list where only the subject line is
   * read. Clicking one message is the moment to pay for it.
   *
   * `from` is resolved live from the mail configuration rather than stored on
   * the row. It is a property of the installation, not of the message, and a
   * copy frozen at send time would quietly disagree with reality the first time
   * the address is changed.
   */
  async detail(communicationId: string) {
    const [row] = await this.db
      .select()
      .from(schema.communications)
      .where(eq(schema.communications.id, communicationId))
      .limit(1);

    if (!row) throw new NotFoundError('Message');

    const [template] = row.templateCode
      ? await this.db
          .select({ name: schema.templates.name })
          .from(schema.templates)
          .where(
            and(
              eq(schema.templates.code, row.templateCode),
              eq(schema.templates.channel, row.channel),
            ),
          )
          .limit(1)
      : [];

    const mail = await this.mail.resolveConfig();

    /**
     * Attachments, with a link each.
     *
     * Signed on open, never stored — the URL outlives neither the sheet nor the
     * permission that produced it. The stored value is a storage key, so the
     * displayed name is its last path segment.
     */
    const attachments = await Promise.all(
      (row.attachmentKeys ?? []).map(async (key) => ({
        key,
        fileName: key.split('/').pop() ?? key,
        url: await this.storage.presignDownload(key, key.split('/').pop() ?? 'attachment'),
      })),
    );

    return {
      id: row.id,
      channel: row.channel,
      direction: row.direction,
      templateCode: row.templateCode,
      templateName: template?.name ?? null,
      to: row.toAddress,
      // Outbound mail leaves from the configured address; an inbound message
      // came from the applicant, and claiming otherwise would be wrong.
      from: row.direction === 'outbound' ? `${mail.fromName} <${mail.fromAddress}>` : row.toAddress,
      cc: row.ccAddresses ?? [],
      subject: row.subject,
      body: row.body,
      status: row.status,
      attemptCount: row.attemptCount,
      failureReason: row.failureReason,
      providerMessageId: row.providerMessageId,
      queuedAt: row.queuedAt?.toISOString() ?? null,
      sentAt: row.sentAt?.toISOString() ?? null,
      failedAt: row.failedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      sentByName: row.sentByName,
      callDurationMinutes: row.callDurationMinutes,
      callOutcome: row.callOutcome,
      attachments,
    };
  }

  // ── Template manager (W-26) ───────────────────────────────────────────────

  async listTemplates() {
    return this.cache.remember('templates:all', 600, [CacheTag.templates()], async () => {
      const rows = await this.db
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
        .orderBy(schema.templates.channel, schema.templates.code);

      // The Smart Workflow Engine addresses system templates by code, so the
      // screen has to distinguish them: renaming one is fine, deleting it would
      // leave a stage action with no message to send.
      return rows.map((row) => ({ ...row, isSystem: isSystemTemplateCode(row.code) }));
    });
  }

  /**
   * Delete a custom template.
   *
   * System templates are refused rather than hidden from the UI as well —
   * a permitted API call must not be able to break a workflow stage that the
   * interface merely declines to offer.
   */
  async deleteTemplate(id: string): Promise<{ ok: true }> {
    const [template] = await this.db
      .select({ code: schema.templates.code, channel: schema.templates.channel })
      .from(schema.templates)
      .where(eq(schema.templates.id, id))
      .limit(1);

    if (!template) throw new NotFoundError('Template');

    if (isSystemTemplateCode(template.code)) {
      throw new ValidationError({
        code: [
          `"${template.code}" is a built-in template used by the workflow and cannot be deleted. Reword it, or switch it off instead.`,
        ],
      });
    }

    await this.db.delete(schema.templates).where(eq(schema.templates.id, id));
    await this.cache.invalidateTags(CacheTag.templates());

    await this.audit.record({
      action: AUDIT.TEMPLATE_UPDATED,
      entityType: 'template',
      entityId: id,
      entityLabel: `deleted ${template.channel}/${template.code}`,
    });

    return { ok: true };
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
    body?: string;
    document?: EmailDocument;
    isActive: boolean;
  }): Promise<{ id: string }> {
    const actor = requireActor();

    const isEmail = input.channel === TEMPLATE_CHANNEL.EMAIL;

    /**
     * Email content is stored as areas, so `body` is derived rather than typed.
     * Generating it here — not in the browser — keeps the stored text
     * alternative honest: it always describes the document that was actually
     * saved, whatever the client sent.
     */
    const body =
      isEmail && input.document
        ? toPlainText(input.document, this.env.DPDP_DATA_FIDUCIARY_NAME)
        : (input.body ?? '');

    // Every editable string is checked, not just the body — a typo in a
    // highlighted value or a button label is just as broken at send time.
    const unknown = new Set<string>();
    for (const text of [
      body,
      input.subject ?? '',
      ...(input.document ? editableStrings(input.document) : []),
    ]) {
      for (const name of validateTemplate(text).unknown) unknown.add(name);
    }

    if (unknown.size > 0) {
      throw new ValidationError({
        body: [
          `Unknown placeholder${unknown.size === 1 ? '' : 's'}: ${[...unknown].map((u) => `{{${u}}}`).join(', ')}. Check the field list.`,
        ],
      });
    }

    const values = {
      code: input.code,
      channel: input.channel,
      name: input.name,
      subject: input.subject ?? null,
      body,
      document: isEmail ? (input.document ?? null) : null,
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

  // ── Selection letter ───────────────────────────────────────────────────────

  /**
   * Everything the letter needs, read off the record.
   *
   * The operator is shown these already filled in and edits what is wrong,
   * rather than retyping a name and a date of birth that the CRM already holds
   * — which is where transcription errors on a printed certificate come from.
   */
  async selectionLetterPrefill(recordId: string): Promise<{
    fields: Omit<SelectionLetterInput, 'kind'>;
    organisation: SelectionLetterOrganisation;
    attachmentName: string;
  }> {
    const [row] = await this.db
      .select({
        applicantId: schema.applicants.id,
        applicantCode: schema.applicants.applicantCode,
        fullName: schema.applicants.fullName,
        email: schema.applicants.email,
        dateOfBirth: schema.applicants.dateOfBirth,
        city: schema.applicants.city,
        state: schema.applicants.state,
        recordTitle: schema.achievements.recordTitle,
        description: schema.achievements.description,
        legacyAppCode: schema.legacyMirror.legacyAppCode,
      })
      .from(schema.records)
      .innerJoin(schema.applicants, eq(schema.records.applicantId, schema.applicants.id))
      .leftJoin(schema.achievements, eq(schema.achievements.recordId, schema.records.id))
      .leftJoin(schema.legacyMirror, eq(schema.legacyMirror.recordId, schema.records.id))
      .where(and(eq(schema.records.id, recordId), isNull(schema.records.deletedAt)))
      .limit(1);

    if (!row) throw new NotFoundError('Record');

    const actor = requireActor();
    const [signatory] = await this.db
      .select({ fullName: schema.users.fullName })
      .from(schema.users)
      .where(eq(schema.users.id, actor.userId))
      .limit(1);

    const formatDay = (value: string | Date | null) => {
      if (!value) return '';
      const date = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(date.getTime())) return '';
      return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
    };

    return {
      fields: {
        holderName: row.fullName,
        toEmail: row.email,
        // The website's own application id is what the applicant quotes back,
        // so it is preferred over the CRM's internal record code.
        applicationId: row.legacyAppCode ?? row.applicantCode,
        title: row.recordTitle ?? '',
        description: row.description ?? '',
        dateOfBirth: formatDay(row.dateOfBirth),
        city: row.city ?? '',
        state: row.state ?? '',
        confirmedOn: formatDay(new Date()),
        signatoryName: signatory?.fullName ?? '',
        signatoryTitle: 'Official Registrar & Documentation Body',
      },
      organisation: await this.selectionLetterOrganisation(),
      attachmentName: ACHIEVER_PACK_FILENAME,
    };
  }

  /**
   * Send the selection letter.
   *
   * The Achiever Pack PDF is attached unconditionally — the letter's own text
   * instructs the applicant to choose a package "from the attached PDF", so a
   * letter without it is incoherent and there is no case for making it optional.
   */
  async sendSelectionLetter(
    recordId: string,
    input: SelectionLetterInput,
  ): Promise<{ communicationId: string; status: string }> {
    const { applicantId, doNotContact } = await this.buildContext(recordId);

    if (doNotContact) {
      throw new ValidationError({
        to: ['This applicant has asked not to be contacted. Lift the restriction first.'],
      });
    }

    const organisation = await this.selectionLetterOrganisation();
    const subject = selectionLetterSubject(input, organisation);
    const html = renderSelectionLetter(input, organisation);
    const text = renderSelectionLetterText(input, organisation);

    // Read before the row is written: the letter instructs the applicant to
    // choose a package "from the attached PDF", so one sent without it is
    // incoherent. Better to refuse than to send a letter that contradicts
    // itself, and better to find out now than after it is queued.
    let attachment: Buffer;
    let stamp: Buffer | null = null;
    try {
      attachment = await readFile(ACHIEVER_PACK_PATH);
    } catch (error: unknown) {
      this.logger.error(
        `Achiever Pack missing at ${ACHIEVER_PACK_PATH}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new ValidationError({
        attachment: [
          'The Achiever Pack PDF is missing from the server, and this letter cannot be sent without it.',
        ],
      });
    }

    /**
     * The confidential stamp, embedded inline.
     *
     * Unlike the Achiever Pack this is decoration, so a missing file downgrades
     * the letter rather than blocking it — the confidentiality line before the
     * sign-off still carries the point in words.
     */
    try {
      stamp = await readFile(CONFIDENTIAL_STAMP_PATH);
    } catch {
      this.logger.warn(`Confidential stamp missing at ${CONFIDENTIAL_STAMP_PATH} — sending without it`);
    }


    const actor = requireActor();

    const [communication] = await this.db
      .insert(schema.communications)
      .values({
        applicantId,
        recordId,
        channel: COMMUNICATION_CHANNEL.EMAIL,
        templateCode: TEMPLATE_CODE.SELECTION,
        toAddress: input.toEmail,
        ccAddresses: input.ccEmail ? [input.ccEmail] : null,
        subject,
        body: text,
        status: COMMUNICATION_STATUS.QUEUED,
        sentByUserId: actor.userId,
        sentByName: actor.fullName,
      })
      .returning({ id: schema.communications.id });

    const communicationId = communication!.id;

    void this.deliver(communicationId, {
      to: input.toEmail,
      cc: input.ccEmail ? [input.ccEmail] : undefined,
      subject,
      body: text,
      html,
      attachments: [
        {
          filename: `${ACHIEVER_PACK_FILENAME}.pdf`,
          content: attachment,
          contentType: 'application/pdf',
        },
        // `cid` keeps this in the body rather than listing it as a second
        // attachment the applicant would have to open.
        ...(stamp
          ? [
              {
                filename: 'confidential.png',
                content: stamp,
                contentType: 'image/png',
                cid: CONFIDENTIAL_STAMP_CID,
              },
            ]
          : []),
      ],
    });

    await this.timeline.write({
      applicantId,
      recordId,
      eventType: TIMELINE_EVENT.EMAIL_SENT,
      summary: `Selection letter queued — ${SELECTION_KIND_META[input.kind].label}`,
      meta: { to: input.toEmail, kind: input.kind, attachment: ACHIEVER_PACK_FILENAME },
    });

    await this.audit.record({
      action: AUDIT.EMAIL_SENT,
      entityType: 'communication',
      entityId: communicationId,
      entityLabel: subject,
      meta: { to: input.toEmail, kind: input.kind },
    });

    return { communicationId, status: COMMUNICATION_STATUS.QUEUED };
  }

  /** Contact and banking details, from settings so they are not per-letter. */
  private async selectionLetterOrganisation(): Promise<SelectionLetterOrganisation> {
    /**
     * Read straight from `settings` rather than injecting GovernanceService,
     * which would make the ops and governance modules mutually dependent.
     */
    const [row] = await this.db
      .select({ key: schema.settings.key, value: schema.settings.value })
      .from(schema.settings)
      .where(eq(schema.settings.key, 'org.letterhead'))
      .limit(1);

    const overrides = (row?.value ?? {}) as Record<string, unknown>;
    const read = (key: string, fallback: string): string => {
      const value = overrides[key];
      return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
    };

    return {
      name: this.env.DPDP_DATA_FIDUCIARY_NAME,
      supportEmail: read('support_email', 'support@nationalbookofrecords.org'),
      supportPhone: read('support_phone', '+91 9403892952'),
      dispatchPhone: read('dispatch_phone', '+91 9403892952'),
      website: read('website', 'www.nationalbookofrecords.org'),
      bankAccountName: read('bank_account_name', 'National Book of Records'),
      bankAccountNumber: read('bank_account_number', '258930576636'),
      bankIfsc: read('bank_ifsc', 'INDB0001410'),
      bankName: read('bank_name', 'IndusInd Bank — Palwal Branch'),
      upiNumber: read('upi_number', '+91 8950902427'),
      achieverPackDocumentName: 'National Book of Records – Achiever Pack Options 2026',
    };
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
