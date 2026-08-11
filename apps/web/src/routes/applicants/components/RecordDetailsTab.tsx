import {
  RECOGNITION_TYPE,
  RECOGNITION_TYPE_LABELS,
  type RecognitionType,
} from '@nbr/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { CardHeader, DetailRow } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Input, Select, Textarea } from '@/components/ui/Field';
import { useAuth } from '@/hooks/useAuth';
import { api, ApiError } from '@/lib/api-client';
import { formatDate, humanise } from '@/lib/format';
import { ICON_SIZE, ICON_STROKE, Icons } from '@/lib/icons';
import { queryKeys } from '@/lib/query-client';
import type { ApplicantRecord } from '../types';

/** Shown where NBR has written nothing of its own yet. */
const NOT_SET = 'Not set';

/**
 * Title Type, at the top of the profile.
 *
 * Its own badge rather than a line in a details table because it changes how
 * everything else on the page is read — a National Record and an Achiever award
 * print differently, verify differently and mean different things. An
 * undecided record shows as *unset* rather than showing nothing: a blank space
 * reads as "no such field", and an operator needs to see that the decision is
 * outstanding.
 */
export function RecognitionTypeBadge({
  recognitionType,
  onEdit,
}: {
  recognitionType: string | null;
  onEdit?: () => void;
}) {
  const type = recognitionType as RecognitionType | null;

  const content = (
    <>
      <Icons.Award size={12} strokeWidth={ICON_STROKE} className="shrink-0" />
      <span className="opacity-70">Title type</span>
      <span>{type ? RECOGNITION_TYPE_LABELS[type] : 'Not set'}</span>
    </>
  );

  const className = [
    'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-2xs font-semibold',
    type === RECOGNITION_TYPE.NATIONAL_RECORD
      ? 'border-brand-ring bg-brand-tint text-brand'
      : type === RECOGNITION_TYPE.ACHIEVER
        ? 'border-gold-ring bg-gold-tint text-gold'
        : 'border-dashed border-line bg-canvas text-ink-3',
    onEdit ? 'transition-colors hover:brightness-95' : '',
  ].join(' ');

  if (!onEdit) return <span className={className}>{content}</span>;

  return (
    <button
      type="button"
      onClick={onEdit}
      title="Set in Record Details"
      className={className}
    >
      {content}
    </button>
  );
}

/**
 * W-08 Record Details (§Record Details).
 *
 * Two sides, deliberately kept apart:
 *
 *  • **Applicant-Provided** — what was typed into the application form. Read
 *    only, here and in the API. It is the evidence of what was actually
 *    claimed, and the moment staff can edit it the record stops being able to
 *    answer the question a challenge turns on.
 *  • **NBR Official** — what NBR recognised and what goes on the certificate,
 *    the public entry and the magazine. Editable by the team.
 *
 * Showing them side by side rather than as one merged set is the point. A
 * single "Record title" field that staff have rewritten reads as the
 * applicant's words, and nobody can tell how far it has drifted from them.
 */
export function RecordDetailsTab({
  record,
  applicantId,
}: {
  record: ApplicantRecord;
  applicantId: string;
}) {
  const { can } = useAuth();
  const [editOpen, setEditOpen] = useState(false);

  const recognition = record.recognitionType as RecognitionType | null;

  return (
    <div className="space-y-4">
      <CardHeader
        title="Record details"
        subtitle="What the applicant submitted, and what NBR has officially recognised."
        icon={Icons.Award}
        action={
          can('records:edit') ? (
            <Button size="sm" variant="secondary" icon={Icons.PenLine} onClick={() => setEditOpen(true)}>
              Edit official details
            </Button>
          ) : null
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── The applicant's own words ─────────────────────────────────── */}
        <section className="rounded-card border border-line p-3.5">
          <div className="mb-2.5 flex items-center gap-2">
            <Icons.User size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} className="text-ink-3" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-ink-2">
              Applicant-provided
            </h4>
          </div>

          <p className="mb-3 text-[11px] leading-relaxed text-ink-3">
            Straight from the application form. Never edited — this is the record of what was
            claimed.
          </p>

          <dl>
            <DetailRow label="Record title" value={record.recordTitle} />
            <DetailRow label="Record description" value={record.description} />
            <DetailRow label="Type" value={humanise(record.recordType ?? '')} />
            <DetailRow label="Date of achievement" value={formatDate(record.achievementDate)} />
            <DetailRow label="Location" value={record.location} />
            <DetailRow label="Participants" value={record.participantCount} />
          </dl>
        </section>

        {/* ── NBR's wording ─────────────────────────────────────────────── */}
        <section className="rounded-card border border-brand-ring bg-brand-tint/30 p-3.5">
          <div className="mb-2.5 flex items-center gap-2">
            <Icons.ShieldCheck size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} className="text-brand" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-brand">
              NBR official
            </h4>
          </div>

          <p className="mb-3 text-[11px] leading-relaxed text-ink-3">
            What goes on the certificate, the public entry and the magazine.
          </p>

          <dl>
            <DetailRow
              label="Official record title"
              value={record.officialRecordTitle ?? NOT_SET}
            />
            <DetailRow
              label="Official record description"
              value={record.approvedDescription ?? NOT_SET}
            />
            <DetailRow
              label="Recognition type"
              value={recognition ? RECOGNITION_TYPE_LABELS[recognition] : NOT_SET}
            />
          </dl>

          {!record.officialRecordTitle && !record.approvedDescription && !recognition ? (
            <p className="mt-3 flex gap-2 rounded-md border border-line bg-white px-2.5 py-2 text-[11px] text-ink-3">
              <Icons.Info
                size={ICON_SIZE.sm}
                strokeWidth={ICON_STROKE}
                className="mt-px shrink-0"
              />
              <span>
                Nothing official has been written yet. Until it is, the applicant's own wording is
                what appears elsewhere.
              </span>
            </p>
          ) : null}
        </section>
      </div>

      {editOpen ? (
        <OfficialDetailsDialog
          record={record}
          applicantId={applicantId}
          onClose={() => setEditOpen(false)}
        />
      ) : null}
    </div>
  );
}

/**
 * Editing NBR's side, and only NBR's side.
 *
 * The applicant's title and description are shown here as read-only reference,
 * because writing an official title without the claim in front of you is how
 * the two end up describing different achievements. They are displayed, not
 * bound to any field — the endpoint could not accept them anyway.
 */
function OfficialDetailsDialog({
  record,
  applicantId,
  onClose,
}: {
  record: ApplicantRecord;
  applicantId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const [title, setTitle] = useState(record.officialRecordTitle ?? '');
  const [description, setDescription] = useState(record.approvedDescription ?? '');
  const [recognitionType, setRecognitionType] = useState(record.recognitionType ?? '');

  useEffect(() => {
    setTitle(record.officialRecordTitle ?? '');
    setDescription(record.approvedDescription ?? '');
    setRecognitionType(record.recognitionType ?? '');
  }, [record]);

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/records/${record.id}/official-details`, {
        // Empty means cleared, which the API distinguishes from "not sent".
        officialRecordTitle: title.trim() || null,
        approvedDescription: description.trim() || null,
        recognitionType: recognitionType || null,
      }),
    onSuccess: () => {
      toast.success('Official record details saved');
      void queryClient.invalidateQueries({ queryKey: queryKeys.applicant(applicantId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.recordTimeline(record.id) });
      onClose();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not save the details'),
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="NBR official record details"
      description="The applicant's own wording is left untouched."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={mutation.isPending} onClick={() => mutation.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* The claim, in front of the person writing the official version. */}
        <section className="rounded-card border border-line bg-canvas p-3">
          <h4 className="mb-2 text-2xs font-bold uppercase tracking-wider text-ink-3">
            What the applicant submitted
          </h4>
          <p className="text-xs font-medium text-ink">{record.recordTitle}</p>
          {record.description ? (
            <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-ink-2">
              {record.description}
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-ink-3">No description was submitted.</p>
          )}
        </section>

        <Select
          label="Recognition type"
          hint="What NBR is awarding. Leave unset until the decision is taken."
          value={recognitionType}
          onChange={(event) => setRecognitionType(event.target.value)}
          options={[
            { value: '', label: 'Not set' },
            ...Object.values(RECOGNITION_TYPE).map((code) => ({
              value: code,
              label: RECOGNITION_TYPE_LABELS[code],
            })),
          ]}
        />

        <Input
          label="Official record title"
          hint="Leave blank to use the applicant's title."
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={record.recordTitle ?? undefined}
        />

        <Textarea
          label="Official record description"
          hint="What gets printed. Leave blank to use the applicant's description."
          rows={5}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder={record.description ?? undefined}
        />
      </div>
    </Dialog>
  );
}
