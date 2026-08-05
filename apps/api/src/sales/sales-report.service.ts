import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SALES_REPORT_SETTING_KEYS } from '@nbr/shared';
import { inArray, sql } from 'drizzle-orm';
import type { Database } from '../database/client';
import { DB } from '../database/database.tokens';
import * as schema from '../database/schema';
import { MailService } from '../mail/mail.service';

export interface RepRow {
  readonly userId: string | null;
  readonly name: string;
  readonly callsMade: number;
  readonly connected: number;
  readonly notReached: number;
  readonly talkMinutes: number;
  readonly interested: number;
  readonly followUpsSet: number;
  /** Promised before today and still not made. */
  readonly followUpsMissed: number;
  readonly followUpsDueToday: number;
  readonly newLeads: number;
  readonly converted: number;
}

export interface SalesDay {
  readonly date: string;
  readonly totals: {
    callsMade: number;
    connected: number;
    notReached: number;
    talkMinutes: number;
    interested: number;
    followUpsSet: number;
    followUpsMissed: number;
    followUpsDueToday: number;
    newLeads: number;
    converted: number;
    connectRate: number;
  };
  readonly reps: readonly RepRow[];
  readonly pipeline: ReadonlyArray<{ status: string; count: number }>;
}

/**
 * Sales reporting: the on-screen dashboard and the end-of-day email.
 *
 * Both read the same query, so the figure a manager sees at 4pm and the one
 * that lands in their inbox at 7pm cannot disagree — which is the usual failure
 * of a report written separately from the screen it summarises.
 */
@Injectable()
export class SalesReportService {
  private readonly logger = new Logger(SalesReportService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly mail: MailService,
  ) {}

  /**
   * One day's activity, per rep and in total.
   *
   * "Missed" means a follow-up promised *before today* on a lead that is still
   * open. Today's outstanding commitments are counted separately as due — a rep
   * still has the afternoon to make them.
   */
  async day(input: { date?: Date; ownerUserId?: string } = {}): Promise<SalesDay> {
    const day = input.date ?? new Date();
    const start = new Date(day);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const startIso = start.toISOString();
    const endIso = end.toISOString();
    const ownerFilter = input.ownerUserId ?? null;

    const rows = await this.db.execute<Record<string, unknown>>(sql`
      WITH staff AS (
        SELECT u.id, u.full_name
          FROM users u
         WHERE u.deleted_at IS NULL
           AND u.status = 'active'
           AND (${ownerFilter}::uuid IS NULL OR u.id = ${ownerFilter}::uuid)
      ),
      calls AS (
        SELECT c.called_by_user_id                                          AS user_id,
               count(*)::int                                                AS calls_made,
               count(*) FILTER (
                 WHERE c.outcome IN ('connected','callback_requested','not_interested','interested')
               )::int                                                       AS connected,
               coalesce(sum(c.duration_minutes), 0)::int                    AS talk_minutes,
               count(*) FILTER (WHERE c.outcome = 'interested')::int        AS interested,
               count(*) FILTER (WHERE c.follow_up_at IS NOT NULL)::int      AS follow_ups_set
          FROM lead_calls c
         WHERE c.called_at >= ${startIso}::timestamptz
           AND c.called_at <  ${endIso}::timestamptz
         GROUP BY c.called_by_user_id
      ),
      created AS (
        SELECT l.created_by_user_id AS user_id, count(*)::int AS new_leads
          FROM leads l
         WHERE l.deleted_at IS NULL
           AND l.created_at >= ${startIso}::timestamptz
           AND l.created_at <  ${endIso}::timestamptz
         GROUP BY l.created_by_user_id
      ),
      converted AS (
        SELECT l.owner_user_id AS user_id, count(*)::int AS converted
          FROM leads l
         WHERE l.deleted_at IS NULL
           AND l.converted_at >= ${startIso}::timestamptz
           AND l.converted_at <  ${endIso}::timestamptz
         GROUP BY l.owner_user_id
      ),
      follow_ups AS (
        /*
         * Outstanding follow-ups need no "has a call happened since?" check.
         * Every logged call rewrites next_follow_up_at — to the new promise, or
         * to NULL when none was made — so a date still sitting in the past on an
         * open lead is by construction one nobody has been back to.
         *
         * An earlier version compared against lead_calls.called_at and counted
         * the very call that *made* the promise as having serviced it, which
         * reported zero missed follow-ups while the overdue queue listed them.
         */
        SELECT l.owner_user_id AS user_id,
               -- Promised for today: still theirs to make before close of play.
               count(*) FILTER (
                 WHERE l.next_follow_up_at >= ${startIso}::timestamptz
                   AND l.next_follow_up_at <  ${endIso}::timestamptz
               )::int AS due_today,
               -- Promised before today and never made. Deliberately strict, so
               -- this figure matches the overdue queue a manager will check it
               -- against rather than quietly counting today's open commitments.
               count(*) FILTER (
                 WHERE l.next_follow_up_at < ${startIso}::timestamptz
               )::int AS missed
          FROM leads l
         WHERE l.deleted_at IS NULL
           AND l.next_follow_up_at IS NOT NULL
           AND l.status NOT IN ('converted','lost','not_interested','unqualified')
         GROUP BY l.owner_user_id
      )
      SELECT s.id                                   AS user_id,
             s.full_name                            AS name,
             coalesce(c.calls_made, 0)              AS calls_made,
             coalesce(c.connected, 0)               AS connected,
             coalesce(c.talk_minutes, 0)            AS talk_minutes,
             coalesce(c.interested, 0)              AS interested,
             coalesce(c.follow_ups_set, 0)          AS follow_ups_set,
             coalesce(f.due_today, 0)               AS follow_ups_due_today,
             coalesce(f.missed, 0)                  AS follow_ups_missed,
             coalesce(n.new_leads, 0)               AS new_leads,
             coalesce(v.converted, 0)               AS converted
        FROM staff s
        LEFT JOIN calls      c ON c.user_id = s.id
        LEFT JOIN created    n ON n.user_id = s.id
        LEFT JOIN converted  v ON v.user_id = s.id
        LEFT JOIN follow_ups f ON f.user_id = s.id
       -- Everyone with activity, or anything outstanding. A rep with a clean
       -- slate and nothing due is not worth a line.
       WHERE coalesce(c.calls_made, 0) > 0
          OR coalesce(n.new_leads, 0) > 0
          OR coalesce(v.converted, 0) > 0
          OR coalesce(f.due_today, 0) > 0
          OR coalesce(f.missed, 0) > 0
       ORDER BY calls_made DESC, name ASC
    `);

    const list = rows as unknown as Array<Record<string, string | number | null>>;

    const reps: RepRow[] = list.map((row) => {
      const callsMade = Number(row.calls_made ?? 0);
      const connected = Number(row.connected ?? 0);
      return {
        userId: (row.user_id as string) ?? null,
        name: String(row.name ?? 'Unknown'),
        callsMade,
        connected,
        notReached: callsMade - connected,
        talkMinutes: Number(row.talk_minutes ?? 0),
        interested: Number(row.interested ?? 0),
        followUpsSet: Number(row.follow_ups_set ?? 0),
        followUpsMissed: Number(row.follow_ups_missed ?? 0),
        followUpsDueToday: Number(row.follow_ups_due_today ?? 0),
        newLeads: Number(row.new_leads ?? 0),
        converted: Number(row.converted ?? 0),
      };
    });

    const sum = (pick: (rep: RepRow) => number): number => reps.reduce((n, r) => n + pick(r), 0);
    const callsMade = sum((r) => r.callsMade);
    const connected = sum((r) => r.connected);

    const pipelineRows = await this.db
      .select({
        status: schema.leads.status,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.leads)
      .where(sql`${schema.leads.deletedAt} is null`)
      .groupBy(schema.leads.status);

    return {
      date: start.toISOString().slice(0, 10),
      totals: {
        callsMade,
        connected,
        notReached: callsMade - connected,
        talkMinutes: sum((r) => r.talkMinutes),
        interested: sum((r) => r.interested),
        followUpsSet: sum((r) => r.followUpsSet),
        followUpsMissed: sum((r) => r.followUpsMissed),
        followUpsDueToday: sum((r) => r.followUpsDueToday),
        newLeads: sum((r) => r.newLeads),
        converted: sum((r) => r.converted),
        connectRate: callsMade === 0 ? 0 : Math.round((connected / callsMade) * 100),
      },
      reps,
      pipeline: pipelineRows.map((row) => ({ status: row.status, count: row.count })),
    };
  }

  // ── End-of-day email ──────────────────────────────────────────────────────

  /**
   * Fires hourly and sends only when the configured hour has arrived.
   *
   * A fixed `@Cron` expression cannot read a setting, and letting an operator
   * choose the hour matters more here than firing exactly once: an hourly tick
   * that checks the clock is simpler and more robust than rescheduling a job
   * whenever someone edits the time.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async maybeSendDailyReport(): Promise<void> {
    try {
      const config = await this.reportConfig();
      if (!config.enabled || config.recipients.length === 0) return;

      const now = new Date();
      if (now.getHours() !== config.hour) return;

      await this.sendDailyReport(config.recipients);
    } catch (error: unknown) {
      this.logger.error(
        `Daily sales report failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async sendDailyReport(recipients?: string[]): Promise<{ sent: boolean; to: string[] }> {
    const config = await this.reportConfig();
    const to = recipients ?? config.recipients;

    if (to.length === 0) return { sent: false, to: [] };

    const report = await this.day();

    // Nothing happened all day. Sending an empty table trains people to ignore
    // the email, which is worse than not sending it.
    if (report.totals.callsMade === 0 && report.totals.followUpsMissed === 0) {
      this.logger.log('Daily sales report skipped — no calls and nothing missed.');
      return { sent: false, to };
    }

    await this.mail.send({
      to: to.join(', '),
      subject: `Sales — ${report.date}: ${report.totals.callsMade} calls, ${report.totals.followUpsMissed} follow-ups missed`,
      text: this.renderText(report),
      html: this.renderHtml(report),
    });

    this.logger.log(`Daily sales report sent to ${to.length} recipient(s).`);
    return { sent: true, to };
  }

  private async reportConfig(): Promise<{
    enabled: boolean;
    hour: number;
    recipients: string[];
  }> {
    const rows = await this.db
      .select({ key: schema.settings.key, value: schema.settings.value })
      .from(schema.settings)
      .where(inArray(schema.settings.key, Object.values(SALES_REPORT_SETTING_KEYS)));

    const map = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    const time = String(map[SALES_REPORT_SETTING_KEYS.sendAt] ?? '19:00');
    const hour = Number(time.split(':')[0]);

    return {
      enabled: map[SALES_REPORT_SETTING_KEYS.enabled] === true,
      hour: Number.isFinite(hour) ? hour : 19,
      recipients: String(map[SALES_REPORT_SETTING_KEYS.recipients] ?? '')
        .split(',')
        .map((address) => address.trim())
        .filter(Boolean),
    };
  }

  private renderText(report: SalesDay): string {
    const lines = [
      `Sales summary — ${report.date}`,
      '',
      `Calls made        ${report.totals.callsMade}`,
      `Connected         ${report.totals.connected} (${report.totals.connectRate}%)`,
      `Not reached       ${report.totals.notReached}`,
      `Talk time         ${report.totals.talkMinutes} min`,
      `Interested        ${report.totals.interested}`,
      `New leads         ${report.totals.newLeads}`,
      `Converted         ${report.totals.converted}`,
      `Follow-ups set    ${report.totals.followUpsSet}`,
      `Follow-ups missed ${report.totals.followUpsMissed}`,
      '',
      'By person:',
    ];

    for (const rep of report.reps) {
      lines.push(
        `  ${rep.name}: ${rep.callsMade} calls, ${rep.connected} connected, ` +
          `${rep.interested} interested, ${rep.converted} converted, ` +
          `${rep.followUpsMissed} missed`,
      );
    }

    return lines.join('\n');
  }

  private renderHtml(report: SalesDay): string {
    const cell = 'padding:6px 10px;border-bottom:1px solid #E1E7F0;font-size:13px';
    const head =
      'padding:6px 10px;border-bottom:1px solid #C9D3E4;font-size:11px;text-transform:uppercase;' +
      'letter-spacing:.06em;color:#47536B;text-align:left';

    const rows = report.reps
      .map(
        (rep) => `<tr>
          <td style="${cell}">${escapeHtml(rep.name)}</td>
          <td style="${cell};text-align:right">${rep.callsMade}</td>
          <td style="${cell};text-align:right">${rep.connected}</td>
          <td style="${cell};text-align:right">${rep.talkMinutes}</td>
          <td style="${cell};text-align:right">${rep.interested}</td>
          <td style="${cell};text-align:right">${rep.converted}</td>
          <td style="${cell};text-align:right;color:${rep.followUpsMissed > 0 ? '#C7362F' : '#47536B'}">${rep.followUpsMissed}</td>
        </tr>`,
      )
      .join('');

    return `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#10182B;max-width:760px">
      <h2 style="margin:0 0 4px;font-size:17px">Sales summary</h2>
      <p style="margin:0 0 16px;color:#47536B;font-size:13px">${report.date}</p>

      <p style="margin:0 0 16px;font-size:13px;color:#47536B">
        <b style="color:#10182B">${report.totals.callsMade}</b> calls ·
        <b style="color:#10182B">${report.totals.connected}</b> connected (${report.totals.connectRate}%) ·
        <b style="color:#10182B">${report.totals.interested}</b> interested ·
        <b style="color:#10182B">${report.totals.converted}</b> converted ·
        <b style="color:${report.totals.followUpsMissed > 0 ? '#C7362F' : '#10182B'}">${report.totals.followUpsMissed}</b> follow-ups missed
      </p>

      <table style="border-collapse:collapse;width:100%">
        <thead><tr>
          <th style="${head}">Person</th>
          <th style="${head};text-align:right">Calls</th>
          <th style="${head};text-align:right">Connected</th>
          <th style="${head};text-align:right">Minutes</th>
          <th style="${head};text-align:right">Interested</th>
          <th style="${head};text-align:right">Converted</th>
          <th style="${head};text-align:right">Missed</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }
}

/** Names and free text reach this email; without escaping they would be markup. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
