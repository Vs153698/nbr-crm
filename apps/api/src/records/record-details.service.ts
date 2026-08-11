import { Inject, Injectable } from '@nestjs/common';
import {
  RECOGNITION_TYPE_LABELS,
  TIMELINE_EVENT,
  type OfficialRecordDetailsInput,
  type RecognitionType,
} from '@nbr/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { AUDIT, AuditService } from '../audit/audit.service';
import { NotFoundError } from '../common/errors';
import type { Database } from '../database/client';
import { DB } from '../database/database.tokens';
import * as schema from '../database/schema';
import { CacheService, CacheTag } from '../redis/cache.service';
import { TimelineService } from '../timeline/timeline.service';

/**
 * NBR's official wording for a record (§Record Details).
 *
 * The whole point of this service is what it *cannot* do: it writes three
 * columns — the official title, the approved description and the recognition
 * type — and has no access to the applicant's own `record_title` or
 * `description`. Those are the evidence of what was actually claimed, and the
 * separation the client asked for is enforced by the shape of this code rather
 * than by everyone remembering to be careful.
 *
 * Every change is written to the timeline with both the old and new value.
 * Changing what a certificate will say is a decision someone should be able to
 * account for later, and "the title used to be different" is not a question the
 * record can answer if the column is simply overwritten.
 */
@Injectable()
export class RecordDetailsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly timeline: TimelineService,
    private readonly audit: AuditService,
    private readonly cache: CacheService,
  ) {}

  async updateOfficial(
    recordId: string,
    input: OfficialRecordDetailsInput,
  ): Promise<{ ok: true }> {
    const [record] = await this.db
      .select({
        id: schema.records.id,
        recordCode: schema.records.recordCode,
        applicantId: schema.records.applicantId,
      })
      .from(schema.records)
      .where(and(eq(schema.records.id, recordId), isNull(schema.records.deletedAt)))
      .limit(1);

    if (!record) throw new NotFoundError('Record');

    const [achievement] = await this.db
      .select({
        id: schema.achievements.id,
        officialRecordTitle: schema.achievements.officialRecordTitle,
        approvedDescription: schema.achievements.approvedDescription,
        recognitionType: schema.achievements.recognitionType,
      })
      .from(schema.achievements)
      .where(eq(schema.achievements.recordId, recordId))
      .limit(1);

    if (!achievement) throw new NotFoundError('Record details');

    /**
     * Only the keys the caller actually sent.
     *
     * `undefined` means "leave it alone" and `null` means "clear it" — a
     * distinction worth keeping, because an official title written in error
     * should be removable and not merely overwritable. Spreading the whole
     * input would turn every partial save into a wipe of the fields the form
     * did not happen to include.
     */
    const changes: Partial<{
      officialRecordTitle: string | null;
      approvedDescription: string | null;
      recognitionType: string | null;
    }> = {};

    if (input.officialRecordTitle !== undefined) {
      changes.officialRecordTitle = input.officialRecordTitle ?? null;
    }
    if (input.approvedDescription !== undefined) {
      changes.approvedDescription = input.approvedDescription ?? null;
    }
    if (input.recognitionType !== undefined) {
      changes.recognitionType = input.recognitionType ?? null;
    }

    if (Object.keys(changes).length === 0) return { ok: true };

    await this.db
      .update(schema.achievements)
      .set(changes)
      .where(eq(schema.achievements.id, achievement.id));

    const summary = this.describe(achievement, changes);

    // Nothing changed in substance — the form was saved without an edit. A
    // timeline entry for that is noise in the one place that must stay
    // readable.
    if (summary) {
      await this.timeline.write({
        applicantId: record.applicantId,
        recordId,
        eventType: TIMELINE_EVENT.RECORD_UPDATED,
        summary,
        meta: {
          before: {
            officialRecordTitle: achievement.officialRecordTitle,
            approvedDescription: achievement.approvedDescription,
            recognitionType: achievement.recognitionType,
          },
          after: changes,
        },
      });

      await this.audit.record({
        action: AUDIT.RECORD_UPDATED,
        entityType: 'record',
        entityId: recordId,
        entityLabel: record.recordCode,
        changes: Object.fromEntries(
          Object.entries(changes).map(([key, value]) => [
            key,
            { from: achievement[key as keyof typeof achievement] ?? null, to: value },
          ]),
        ),
      });
    }

    await this.cache.invalidateTags(
      CacheTag.record(recordId),
      CacheTag.applicant(record.applicantId),
      CacheTag.applicantList(),
    );

    return { ok: true };
  }

  /**
   * One sentence naming what actually changed.
   *
   * Recognition type is called out by name because it is the headline on the
   * profile — "Recognition set to National Record" is the line someone
   * scanning the timeline is looking for, and burying it in "details updated"
   * would hide the only field with a visible consequence.
   */
  private describe(
    before: {
      officialRecordTitle: string | null;
      approvedDescription: string | null;
      recognitionType: string | null;
    },
    after: Partial<{
      officialRecordTitle: string | null;
      approvedDescription: string | null;
      recognitionType: string | null;
    }>,
  ): string | null {
    const parts: string[] = [];

    if (
      after.recognitionType !== undefined &&
      after.recognitionType !== before.recognitionType
    ) {
      parts.push(
        after.recognitionType
          ? `Recognition set to ${RECOGNITION_TYPE_LABELS[after.recognitionType as RecognitionType] ?? after.recognitionType}`
          : 'Recognition cleared',
      );
    }

    if (
      after.officialRecordTitle !== undefined &&
      after.officialRecordTitle !== before.officialRecordTitle
    ) {
      parts.push(after.officialRecordTitle ? 'Official title updated' : 'Official title cleared');
    }

    if (
      after.approvedDescription !== undefined &&
      after.approvedDescription !== before.approvedDescription
    ) {
      parts.push(
        after.approvedDescription
          ? 'Official description updated'
          : 'Official description cleared',
      );
    }

    return parts.length > 0 ? parts.join(' · ') : null;
  }
}
