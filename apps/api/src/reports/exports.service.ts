import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { ExportFormat, ReportType } from '@nbr/shared';
import { and, desc, eq, isNotNull, lte, sql } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { AUDIT, AuditService } from '../audit/audit.service';
import { ForbiddenError, NotFoundError } from '../common/errors';
import { requireActor } from '../common/request-context';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import type { Database } from '../database/client';
import { DB } from '../database/database.tokens';
import * as schema from '../database/schema';
import { StorageService } from '../storage/storage.service';
import { ReportsService, type ReportFilters, type ReportResult } from './reports.service';

/**
 * Report exports (§24, M-13).
 *
 * Exports run as background jobs: the request returns a job id immediately and
 * a worker builds the file. A 20,000-row Excel export inside an HTTP request
 * would hold a worker for a minute and time out behind Cloudflare.
 *
 * Export artefacts contain personal data, so they are written to private
 * storage with an expiry and swept up afterwards — an export left lying around
 * for a year is a DPDP problem, not a housekeeping one.
 */
@Injectable()
export class ExportsService {
  private readonly logger = new Logger(ExportsService.name);

  /** How long a finished export stays downloadable before the sweeper removes it. */
  private static readonly ARTEFACT_TTL_HOURS = 24;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly reports: ReportsService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  /** Queue an export and return immediately (§7 async budget: 202 in < 50 ms). */
  async queue(input: {
    reportType: ReportType;
    format: ExportFormat;
    filters: ReportFilters;
    columns?: string[];
  }): Promise<{ jobId: string; status: string }> {
    const actor = requireActor();

    const [job] = await this.db
      .insert(schema.exportJobs)
      .values({
        requestedByUserId: actor.userId,
        reportType: input.reportType,
        format: input.format,
        filters: input.filters as Record<string, unknown>,
        columns: input.columns ?? null,
        status: 'queued',
      })
      .returning({ id: schema.exportJobs.id });

    const jobId = job!.id;

    // Not awaited — the caller gets its job id straight away.
    void this.process(jobId);

    await this.audit.record({
      action: AUDIT.REPORT_EXPORTED,
      entityType: 'export_job',
      entityId: jobId,
      entityLabel: `${input.reportType} (${input.format})`,
      meta: { filters: input.filters },
    });

    return { jobId, status: 'queued' };
  }

  private async process(jobId: string): Promise<void> {
    try {
      await this.db
        .update(schema.exportJobs)
        .set({ status: 'running', startedAt: new Date() })
        .where(eq(schema.exportJobs.id, jobId));

      const [job] = await this.db
        .select()
        .from(schema.exportJobs)
        .where(eq(schema.exportJobs.id, jobId))
        .limit(1);

      if (!job) return;

      const filters = job.filters as ReportFilters;
      const report = await this.reports.run(job.reportType as ReportType, {
        ...filters,
        from: filters.from ? new Date(filters.from) : undefined,
        to: filters.to ? new Date(filters.to) : undefined,
      });

      const buffer = await this.render(report, job.format as ExportFormat);
      const fileName = `${job.reportType}-${new Date().toISOString().slice(0, 10)}.${job.format}`;

      const storageKey = this.storage.buildKey('attachment', `exports/${jobId}`, fileName);
      await this.storage.putObject(storageKey, buffer, contentTypeFor(job.format as ExportFormat));

      await this.db
        .update(schema.exportJobs)
        .set({
          status: 'completed',
          completedAt: new Date(),
          rowCount: report.rows.length,
          storageKey,
          expiresAt: new Date(Date.now() + ExportsService.ARTEFACT_TTL_HOURS * 3_600_000),
        })
        .where(eq(schema.exportJobs.id, jobId));

      // Tell the requester it is ready — the plan's "download centre +
      // notification when ready".
      await this.db.insert(schema.notifications).values({
        userId: job.requestedByUserId,
        kind: 'export_ready',
        title: `Export ready — ${job.reportType.replace(/_/g, ' ')}`,
        body: `${report.rows.length} rows. The file expires in ${ExportsService.ARTEFACT_TTL_HOURS} hours.`,
        severity: 'info',
        link: '/reports?tab=downloads',
        dedupeKey: `export_ready:${jobId}`,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Export ${jobId} failed: ${message}`);

      await this.db
        .update(schema.exportJobs)
        .set({ status: 'failed', completedAt: new Date(), error: message })
        .where(eq(schema.exportJobs.id, jobId));
    }
  }

  private async render(report: ReportResult, format: ExportFormat): Promise<Buffer> {
    if (format === 'csv') return this.renderCsv(report);
    if (format === 'xlsx') return this.renderXlsx(report);
    return this.renderPdf(report);
  }

  private renderCsv(report: ReportResult): Buffer {
    const escape = (value: unknown): string => {
      const text = value === null || value === undefined ? '' : String(value);
      // Quote anything containing a delimiter, quote or newline — otherwise a
      // record title with a comma silently shifts every later column.
      return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };

    const lines = [
      report.columns.map((column) => escape(column.label)).join(','),
      ...report.rows.map((row) => report.columns.map((c) => escape(row[c.key])).join(',')),
    ];

    if (report.totals) {
      lines.push(report.columns.map((c) => escape(report.totals?.[c.key])).join(','));
    }

    // BOM so Excel opens UTF-8 correctly — without it, Indian names with
    // non-ASCII characters render as mojibake on a default Windows install.
    return Buffer.from(`﻿${lines.join('\r\n')}`, 'utf8');
  }

  private async renderXlsx(report: ReportResult): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = this.env.DPDP_DATA_FIDUCIARY_NAME;
    workbook.created = new Date();

    const sheet = workbook.addWorksheet(report.type.replace(/_/g, ' ').slice(0, 31));

    sheet.columns = report.columns.map((column) => ({
      header: column.label,
      key: column.key,
      width: Math.max(14, Math.min(40, column.label.length + 6)),
      style: column.align === 'right' ? { alignment: { horizontal: 'right' } } : {},
    }));

    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0E1B3D' },
    };
    sheet.getRow(1).height = 20;

    for (const row of report.rows) sheet.addRow(row);

    if (report.totals) {
      const totalRow = sheet.addRow(report.totals);
      totalRow.font = { bold: true };
      totalRow.border = { top: { style: 'thin' } };
    }

    // Freeze the header so a 5,000-row export stays readable while scrolling.
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: report.columns.length },
    };

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  private renderPdf(report: ReportResult): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      // Landscape — these reports are wide, and portrait would truncate.
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(16).fillColor('#0E1B3D').text(this.env.DPDP_DATA_FIDUCIARY_NAME);
      doc
        .fontSize(11)
        .fillColor('#47536B')
        .text(report.type.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()));
      doc
        .fontSize(8)
        .fillColor('#7A869E')
        .text(`Generated ${new Date(report.generatedAt).toLocaleString('en-IN')}`);
      doc.moveDown(0.8);

      const pageWidth = doc.page.width - 72;
      const columnWidth = pageWidth / report.columns.length;
      let y = doc.y;

      const drawHeader = () => {
        doc.rect(36, y, pageWidth, 18).fill('#0E1B3D');
        doc.fillColor('#FFFFFF').fontSize(7.5);
        report.columns.forEach((column, index) => {
          doc.text(column.label, 40 + index * columnWidth, y + 5, {
            width: columnWidth - 8,
            align: column.align ?? 'left',
            ellipsis: true,
          });
        });
        y += 18;
      };

      drawHeader();

      doc.fontSize(7.5);
      for (const [rowIndex, row] of report.rows.entries()) {
        // New page when we run out of room, repeating the header.
        if (y > doc.page.height - 60) {
          doc.addPage();
          y = 36;
          drawHeader();
          doc.fontSize(7.5);
        }

        if (rowIndex % 2 === 1) doc.rect(36, y, pageWidth, 14).fill('#F7F9FC');

        doc.fillColor('#10182B');
        report.columns.forEach((column, index) => {
          doc.text(String(row[column.key] ?? ''), 40 + index * columnWidth, y + 3.5, {
            width: columnWidth - 8,
            align: column.align ?? 'left',
            ellipsis: true,
          });
        });
        y += 14;
      }

      if (report.totals) {
        doc.rect(36, y, pageWidth, 16).fill('#EAF0FD');
        doc.fillColor('#0E1B3D').fontSize(8);
        report.columns.forEach((column, index) => {
          doc.text(String(report.totals?.[column.key] ?? ''), 40 + index * columnWidth, y + 4, {
            width: columnWidth - 8,
            align: column.align ?? 'left',
            ellipsis: true,
          });
        });
      }

      doc.end();
    });
  }

  /** The download centre. Only the requester's own exports are listed. */
  async listJobs(): Promise<
    Array<{
      id: string;
      reportType: string;
      format: string;
      status: string;
      rowCount: number | null;
      error: string | null;
      createdAt: string;
      completedAt: string | null;
      expiresAt: string | null;
      expired: boolean;
    }>
  > {
    const actor = requireActor();

    const rows = await this.db
      .select()
      .from(schema.exportJobs)
      .where(eq(schema.exportJobs.requestedByUserId, actor.userId))
      .orderBy(desc(schema.exportJobs.createdAt))
      .limit(30);

    return rows.map((row) => ({
      id: row.id,
      reportType: row.reportType,
      format: row.format,
      status: row.status,
      rowCount: row.rowCount,
      error: row.error,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      expired: Boolean(row.expiresAt && row.expiresAt.getTime() < Date.now()),
    }));
  }

  async getDownloadUrl(jobId: string): Promise<{ url: string; fileName: string }> {
    const actor = requireActor();

    const [job] = await this.db
      .select()
      .from(schema.exportJobs)
      .where(eq(schema.exportJobs.id, jobId))
      .limit(1);

    if (!job?.storageKey) throw new NotFoundError('Export');

    // An export is a snapshot of personal data taken for one person's stated
    // purpose — it is not a shared artefact.
    if (job.requestedByUserId !== actor.userId && !actor.isSuperAdmin) {
      throw new ForbiddenError('You can only download exports you requested.');
    }

    if (job.expiresAt && job.expiresAt.getTime() < Date.now()) {
      throw new NotFoundError('Export (expired)');
    }

    const fileName = `${job.reportType}-${job.createdAt.toISOString().slice(0, 10)}.${job.format}`;
    return { url: await this.storage.presignDownload(job.storageKey, fileName), fileName };
  }

  /**
   * Delete expired export artefacts.
   *
   * Files holding personal data must not accumulate indefinitely (DPDP §8(7)).
   * The job row survives as an audit record; only the file goes.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async sweepExpiredArtefacts(): Promise<void> {
    try {
      const expired = await this.db
        .select({ id: schema.exportJobs.id, storageKey: schema.exportJobs.storageKey })
        .from(schema.exportJobs)
        .where(
          and(
            isNotNull(schema.exportJobs.storageKey),
            lte(schema.exportJobs.expiresAt, new Date()),
          ),
        )
        .limit(200);

      for (const job of expired) {
        if (job.storageKey) await this.storage.deleteObject(job.storageKey);
        await this.db
          .update(schema.exportJobs)
          .set({ storageKey: null })
          .where(eq(schema.exportJobs.id, job.id));
      }

      if (expired.length > 0) {
        this.logger.log(`Swept ${expired.length} expired export artefact(s)`);
      }
    } catch (error: unknown) {
      this.logger.error(
        `Export sweep failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

function contentTypeFor(format: ExportFormat): string {
  switch (format) {
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'pdf':
      return 'application/pdf';
    default:
      return 'text/csv; charset=utf-8';
  }
}
