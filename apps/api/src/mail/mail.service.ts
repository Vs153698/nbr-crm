import { Inject, Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

export interface OutboundMail {
  readonly to: string;
  readonly cc?: string[];
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
  readonly attachments?: Array<{ filename: string; content: Buffer; contentType?: string }>;
}

export interface SendResult {
  readonly messageId: string;
}

/**
 * SMTP transport.
 *
 * Application code never calls this directly for applicant-facing mail — the
 * communications module queues a BullMQ job and returns 202 in under 50 ms
 * (§7 "no endpoint may … call SMTP … synchronously"). The worker calls this.
 *
 * Password-reset mail is the one exception: it is sent inline because the user
 * is standing at the form waiting for it, and it carries no applicant data.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  constructor(@Inject(ENV) private readonly env: Env) {}

  private getTransporter(): Transporter {
    this.transporter ??= nodemailer.createTransport({
      host: this.env.SMTP_HOST,
      port: this.env.SMTP_PORT,
      secure: this.env.SMTP_SECURE,
      auth: this.env.SMTP_USER
        ? { user: this.env.SMTP_USER, pass: this.env.SMTP_PASSWORD }
        : undefined,
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
    });
    return this.transporter;
  }

  async send(mail: OutboundMail): Promise<SendResult> {
    const info = await this.getTransporter().sendMail({
      from: `"${this.env.MAIL_FROM_NAME}" <${this.env.MAIL_FROM_ADDRESS}>`,
      to: mail.to,
      cc: mail.cc,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      attachments: mail.attachments,
    });

    return { messageId: String(info.messageId) };
  }

  /**
   * Password-reset link.
   *
   * Failures are swallowed on purpose: the caller (`POST /auth/forgot-password`)
   * must return the same 202 whether or not the address exists, and an SMTP
   * error surfacing to the client would leak that the account is real.
   */
  async sendPasswordReset(email: string, token: string): Promise<void> {
    const link = `${this.env.WEB_URL}/reset-password?token=${encodeURIComponent(token)}`;

    try {
      await this.send({
        to: email,
        subject: `Reset your ${this.env.APP_NAME} password`,
        text: [
          'A password reset was requested for your account.',
          '',
          `Open this link to set a new password (valid for 30 minutes):`,
          link,
          '',
          'If you did not request this, you can ignore this email — your password will not change.',
          '',
          this.env.DPDP_DATA_FIDUCIARY_NAME,
        ].join('\n'),
      });
    } catch (error: unknown) {
      this.logger.error(
        `Failed to send password reset mail: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async verifyConnection(): Promise<boolean> {
    try {
      await this.getTransporter().verify();
      return true;
    } catch (error: unknown) {
      this.logger.warn(
        `SMTP verification failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }
}
