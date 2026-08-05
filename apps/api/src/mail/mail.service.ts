import { Inject, Injectable, Logger } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import nodemailer, { type Transporter } from 'nodemailer';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import type { Database } from '../database/client';
import { DB } from '../database/database.tokens';
import * as schema from '../database/schema';

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

/** Settings keys that override the environment when set. */
export const MAIL_SETTING_KEYS = {
  host: 'mail.smtp_host',
  port: 'mail.smtp_port',
  secure: 'mail.smtp_secure',
  user: 'mail.smtp_user',
  password: 'mail.smtp_password',
  fromName: 'mail.from_name',
  fromAddress: 'mail.from_address',
} as const;

export interface SmtpConfig {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly user: string;
  readonly password: string;
  readonly fromName: string;
  readonly fromAddress: string;
  /** True when at least one value came from Settings rather than the environment. */
  readonly fromDatabase: boolean;
}

/** How long a resolved configuration is reused before Settings is re-read. */
const CONFIG_TTL_MS = 60_000;

/**
 * SMTP transport.
 *
 * Application code never calls this directly for applicant-facing mail — the
 * communications module queues a BullMQ job and returns 202 in under 50 ms
 * (§7 "no endpoint may … call SMTP … synchronously"). The worker calls this.
 *
 * Password-reset mail is the one exception: it is sent inline because the user
 * is standing at the form waiting for it, and it carries no applicant data.
 *
 * Configuration is resolved from Settings first and the environment second, so
 * an operator whose mail provider changes on a Friday afternoon can fix it from
 * the admin screen instead of waiting for a redeploy. A blank setting means
 * "keep using the environment value" rather than "send with no host".
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;
  /** Fingerprint of the config the cached transporter was built from. */
  private transporterKey: string | null = null;
  private cachedConfig: SmtpConfig | null = null;
  private cachedAt = 0;

  constructor(
    @Inject(ENV) private readonly env: Env,
    // Settings are read straight from the table rather than through
    // GovernanceService. MailService is global and GovernanceService is not,
    // and routing this through the governance module would couple every
    // outbound email to the reporting and audit graph for one SELECT.
    @Inject(DB) private readonly db: Database,
  ) {}

  /**
   * Resolve the active SMTP configuration.
   *
   * Cached for a minute: this runs on every queued send, and a database round
   * trip per email would be pure overhead for a value that changes perhaps
   * twice a year.
   */
  async resolveConfig(options: { fresh?: boolean } = {}): Promise<SmtpConfig> {
    if (!options.fresh && this.cachedConfig && Date.now() - this.cachedAt < CONFIG_TTL_MS) {
      return this.cachedConfig;
    }

    let stored: Record<string, unknown> = {};
    try {
      const rows = await this.db
        .select({ key: schema.settings.key, value: schema.settings.value })
        .from(schema.settings)
        .where(inArray(schema.settings.key, Object.values(MAIL_SETTING_KEYS)));

      stored = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    } catch (error: unknown) {
      // Falling back to the environment is strictly better than not sending.
      this.logger.warn(
        `Could not read mail settings, using environment: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const text = (key: string): string => {
      const value = stored[key];
      return typeof value === 'string' ? value.trim() : '';
    };

    const host = text(MAIL_SETTING_KEYS.host);
    const port = text(MAIL_SETTING_KEYS.port);
    const secure = text(MAIL_SETTING_KEYS.secure);
    const user = text(MAIL_SETTING_KEYS.user);
    const password = text(MAIL_SETTING_KEYS.password);
    const fromName = text(MAIL_SETTING_KEYS.fromName);
    const fromAddress = text(MAIL_SETTING_KEYS.fromAddress);

    const config: SmtpConfig = {
      host: host || this.env.SMTP_HOST,
      port: port ? Number(port) : this.env.SMTP_PORT,
      secure: secure ? secure === 'true' : this.env.SMTP_SECURE,
      // Both are optional in the environment schema — an unauthenticated relay
      // is a legitimate setup, and empty string is how the rest of this class
      // spells "no credentials".
      user: user || this.env.SMTP_USER || '',
      password: password || this.env.SMTP_PASSWORD || '',
      fromName: fromName || this.env.MAIL_FROM_NAME,
      fromAddress: fromAddress || this.env.MAIL_FROM_ADDRESS,
      fromDatabase: Boolean(host || user || fromAddress),
    };

    this.cachedConfig = config;
    this.cachedAt = Date.now();
    return config;
  }

  private async getTransporter(): Promise<Transporter> {
    const config = await this.resolveConfig();
    // Rebuilding the pool on every send would defeat connection reuse, so the
    // transporter is kept until the configuration it was built from changes.
    const key = `${config.host}:${config.port}:${config.secure}:${config.user}`;

    if (!this.transporter || this.transporterKey !== key) {
      this.transporter?.close();
      this.transporter = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: config.user ? { user: config.user, pass: config.password } : undefined,
        pool: true,
        maxConnections: 3,
        maxMessages: 100,
      });
      this.transporterKey = key;
    }

    return this.transporter;
  }

  async send(mail: OutboundMail): Promise<SendResult> {
    const config = await this.resolveConfig();
    const transporter = await this.getTransporter();

    const info = await transporter.sendMail({
      from: `"${config.fromName}" <${config.fromAddress}>`,
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
      const transporter = await this.getTransporter();
      await transporter.verify();
      return true;
    } catch (error: unknown) {
      this.logger.warn(
        `SMTP verification failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  /**
   * Verify the saved settings and send one real message.
   *
   * Deliberately re-reads the configuration rather than using the cache: the
   * operator has just changed it, and testing the previous values would tell
   * them nothing useful.
   */
  async testConnection(to: string): Promise<{ ok: true; config: Omit<SmtpConfig, 'password'> }> {
    await this.resolveConfig({ fresh: true });
    // Force a rebuild so the test uses what was just saved.
    this.transporterKey = null;

    const config = await this.resolveConfig();
    const transporter = await this.getTransporter();

    await transporter.verify();
    await transporter.sendMail({
      from: `"${config.fromName}" <${config.fromAddress}>`,
      to,
      subject: `${this.env.APP_NAME} — SMTP test`,
      text: [
        'Your SMTP configuration is working.',
        '',
        `Host: ${config.host}:${config.port}`,
        `User: ${config.user || '(no authentication)'}`,
        `From: ${config.fromName} <${config.fromAddress}>`,
        `Source: ${config.fromDatabase ? 'Settings' : 'server environment'}`,
      ].join('\n'),
    });

    const { password: _password, ...safe } = config;
    return { ok: true, config: safe };
  }
}
