import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  SELECTION_KIND,
  SELECTION_KIND_META,
  type SelectionKind,
} from '@nbr/shared';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { FilePreviewSheet } from '@/components/ui/FilePreviewSheet';
import { Input, Textarea } from '@/components/ui/Field';
import { ApiError, api } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { ICON_STROKE, Icons } from '@/lib/icons';
import { queryKeys } from '@/lib/query-client';

interface Prefill {
  fields: {
    holderName: string;
    toEmail: string;
    applicationId: string;
    title: string;
    description: string;
    dateOfBirth: string;
    city: string;
    state: string;
    confirmedOn: string;
    signatoryName: string;
    signatoryTitle: string;
  };
  attachmentName: string;
}

/**
 * Sending the selection letter.
 *
 * Two steps, deliberately. A record and an appreciation are different awards
 * whose letters differ in three separate places, so the choice is made *before*
 * the letter opens rather than being one more field to remember among a dozen —
 * getting it wrong means telling someone they hold a record they do not.
 *
 * The second step edits facts only. The letter's terms — the selectivity figure,
 * the refusal to amend title or category, the correction window, the payment
 * details — are settled wording and not an operator's decision on the day, so
 * they are not on screen to be changed. What is on screen arrives prefilled from
 * the record, because a name or date of birth retyped by hand is how a wrong
 * spelling reaches a printed certificate.
 */
export function SelectionLetterDialog({
  recordId,
  applicantId,
  onClose,
}: {
  recordId: string;
  applicantId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<SelectionKind | null>(null);
  const [fields, setFields] = useState<Prefill['fields'] | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['communications', recordId, 'selection-letter'],
    queryFn: ({ signal }) =>
      api.get<Prefill>(`/communications/selection-letter/${recordId}`, undefined, signal),
  });

  /**
   * Seed the form from whatever the query has, once.
   *
   * Deliberately an effect on the *data* rather than work done inside
   * `queryFn`: a cached read never calls `queryFn`, so seeding there left the
   * form stuck on its skeleton for anyone who had opened this dialog before —
   * an empty grey box with a Send button under it.
   */
  useEffect(() => {
    if (fields || !data) return;
    setFields(data.fields);
  }, [data, fields]);

  const send = useMutation({
    mutationFn: () =>
      api.post(`/communications/selection-letter/${recordId}`, { ...fields, kind }),
    onSuccess: () => {
      toast.success('Selection letter queued', {
        description: `Sent with ${data?.attachmentName ?? 'the Achiever Pack'} attached.`,
      });
      onClose();
      void queryClient.invalidateQueries({ queryKey: queryKeys.communications(applicantId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.record(recordId) });
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not send the letter'),
  });

  /**
   * Save the letter as a PDF, without sending it.
   *
   * Generated from the record by `GET /records/:id/documents/selection-letter`,
   * which is the same document the applicant receives — not a second renderer
   * that would drift from it. Fetched and opened in one gesture because the
   * signed URL is short-lived.
   */
  async function downloadLetter() {
    setDownloading(true);
    try {
      const doc = await api.get<{ url: string }>(
        `/records/${recordId}/documents/selection-letter`,
      );
      window.open(doc.url, '_blank', 'noopener,noreferrer');
    } catch (error: unknown) {
      toast.error(
        error instanceof ApiError ? error.message : 'Could not generate the selection letter',
      );
    } finally {
      setDownloading(false);
    }
  }

  const set = (key: keyof Prefill['fields']) => (value: string) =>
    setFields((current) => (current ? { ...current, [key]: value } : current));

  // ── Step one: which award is this? ─────────────────────────────────────────
  if (!kind) {
    return (
      <Dialog
        open
        onOpenChange={onClose}
        title="Send selection letter"
        description="Which recognition has been approved?"
        footer={
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        }
      >
        <div className="space-y-2">
          {(Object.values(SELECTION_KIND) as SelectionKind[]).map((value) => {
            const meta = SELECTION_KIND_META[value];
            return (
              <button
                key={value}
                type="button"
                onClick={() => setKind(value)}
                className={cn(
                  'flex w-full items-start gap-3 rounded-card border border-line bg-white p-3 text-left',
                  'transition-colors hover:border-brand-ring hover:bg-brand-tint/40',
                )}
              >
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-tint text-brand">
                  <Icons.Award size={15} strokeWidth={ICON_STROKE} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink">{meta.label}</span>
                  <span className="mt-0.5 block text-xs text-ink-3">{meta.description}</span>
                  <span className="mt-1 block text-[11px] text-ink-4">
                    Letter reads “{meta.designation}” and “{meta.verb} …”
                  </span>
                </span>
              </button>
            );
          })}

          <p className="pt-1 text-[11px] leading-relaxed text-ink-3">
            This decides the titled designation, the section heading and how the holder is
            described. It cannot be changed once the letter is sent.
          </p>
        </div>
      </Dialog>
    );
  }

  // ── Step two: check the facts ─────────────────────────────────────────────
  const meta = SELECTION_KIND_META[kind];
  const incomplete =
    !fields?.holderName.trim() ||
    !fields?.toEmail.trim() ||
    !fields?.applicationId.trim() ||
    !fields?.title.trim() ||
    !fields?.description.trim() ||
    !fields?.confirmedOn.trim() ||
    !fields?.signatoryName.trim();

  return (
    <Dialog
      open
      onOpenChange={onClose}
      title={`Selection letter — ${meta.label}`}
      description="The wording is fixed. Check the facts below, which the applicant will see printed."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => setKind(null)}>
            Back
          </Button>

          {/*
            Look at it, and keep a copy, without sending it.

            Emailing was the only way to produce this letter, which meant the
            only way to check the layout and the printed facts was to send it to
            somebody — and the only way to get a PDF for a file or a courier was
            to ask the applicant to forward theirs. Preview renders it in place;
            Download saves the same PDF, generated from the same record.
          */}
          <Button
            variant="secondary"
            icon={Icons.Eye}
            onClick={() => setPreviewOpen(true)}
          >
            Preview
          </Button>
          <Button
            variant="secondary"
            icon={Icons.Download}
            loading={downloading}
            onClick={() => void downloadLetter()}
          >
            Download
          </Button>

          <Button
            variant="primary"
            icon={Icons.Mail}
            loading={send.isPending}
            disabled={incomplete}
            onClick={() => send.mutate()}
          >
            Send letter
          </Button>
        </>
      }
    >
      {isLoading || !fields ? (
        <div className="skeleton h-72" />
      ) : (
        <div className="space-y-4">
          <div className="flex gap-2 rounded-lg border border-info-ring bg-info-tint p-2.5 text-[11px] leading-relaxed text-ink-2">
            <Icons.FileText
              size={14}
              strokeWidth={ICON_STROKE}
              className="mt-0.5 shrink-0 text-brand"
              aria-hidden
            />
            <span>
              <b>{data?.attachmentName}</b> is attached automatically — the letter tells the
              applicant to choose a package from it, so it always goes.
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Holder name"
              required
              value={fields.holderName}
              onChange={(event) => set('holderName')(event.target.value)}
              hint="Printed on the certificate exactly as typed."
            />
            <Input
              label="Application ID"
              required
              value={fields.applicationId}
              onChange={(event) => set('applicationId')(event.target.value)}
              className="tabular font-mono"
            />
            <Input
              label="To"
              type="email"
              required
              value={fields.toEmail}
              onChange={(event) => set('toEmail')(event.target.value)}
            />
            <Input
              label="Date of birth"
              value={fields.dateOfBirth}
              onChange={(event) => set('dateOfBirth')(event.target.value)}
              placeholder="28 May 2002"
              hint="Left blank, it is omitted from the description."
            />
            <Input
              label="City"
              value={fields.city}
              onChange={(event) => set('city')(event.target.value)}
            />
            <Input
              label="State"
              value={fields.state}
              onChange={(event) => set('state')(event.target.value)}
            />
          </div>

          <Input
            label={`${meta.label} title`}
            required
            value={fields.title}
            onChange={(event) => set('title')(event.target.value)}
            hint="Shown underlined above the description. Cannot be amended after sending."
          />

          <Textarea
            label={`${meta.label} description`}
            required
            rows={6}
            value={fields.description}
            onChange={(event) => set('description')(event.target.value)}
            hint={`Reads: "${fields.holderName || 'Name'} … ${meta.verb} <your text>, as confirmed on ${fields.confirmedOn || 'date'}."`}
          />

          <div className="grid gap-3 sm:grid-cols-3">
            <Input
              label="Confirmed on"
              required
              value={fields.confirmedOn}
              onChange={(event) => set('confirmedOn')(event.target.value)}
            />
            <Input
              label="Signed by"
              required
              value={fields.signatoryName}
              onChange={(event) => set('signatoryName')(event.target.value)}
            />
            <Input
              label="Designation"
              required
              value={fields.signatoryTitle}
              onChange={(event) => set('signatoryTitle')(event.target.value)}
            />
          </div>
        </div>
      )}

      {/* The letter as a PDF, in the same sheet that previews every other
          document here — so it behaves the way an operator already expects. */}
      {previewOpen ? (
        <FilePreviewSheet
          downloadPath={`/records/${recordId}/documents/selection-letter`}
          fileName={`selection-letter-${fields?.applicationId ?? recordId}.pdf`}
          subtitle="Check the wording and the printed facts before this goes to the applicant."
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}
    </Dialog>
  );
}
