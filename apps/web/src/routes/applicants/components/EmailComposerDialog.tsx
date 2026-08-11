import { EMAIL_TEMPLATE_CODES, TEMPLATE_CHANNEL } from '@nbr/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input, Select, Textarea } from '@/components/ui/Field';
import { api, ApiError } from '@/lib/api-client';
import { humanise } from '@/lib/format';
import { Icons } from '@/lib/icons';
import type { RenderedMessage } from '../types';

/**
 * Sentinel for "no template" in the picker.
 *
 * An empty string rather than `null` because a `<select>` value is always a
 * string; the send maps it back to `undefined`, which is what the API means by
 * a message that belongs to no template.
 */
const CUSTOM = '';

/**
 * M-07 Email composer (§22).
 *
 * One dialog behind every way of writing to an applicant — the Communication
 * tab, the Smart Action panel's `email:<template>` shortcuts, and the Email
 * button in the profile header. They differ only in which template they open
 * on, so they share a body rather than drifting into three composers that
 * gradually disagree about what "send" means.
 *
 * Four things it has to get right:
 *
 *  • **The address is filled in, and still editable.** It comes from the
 *    applicant's profile, because that is who this is about. It stays editable
 *    because a real message sometimes goes to a parent, a school, or the second
 *    address someone actually reads.
 *  • **A template is a starting point, not a cage.** Pick one and the subject
 *    and body arrive filled with this applicant's data; edit either and your
 *    words are what goes out.
 *  • **A blank message is a first-class option.** Most of what an operator
 *    needs to say has no template, and forcing them to start from the nearest
 *    wrong one is how a "Payment Reminder" ends up carrying a note about a
 *    misspelt name.
 *  • **Everything sent is recorded.** The server writes a `communications` row
 *    before it touches SMTP, so the history holds the message as sent — the
 *    rendered text, not a template reference — and survives that template being
 *    reworded later.
 */
export function EmailComposerDialog({
  recordId,
  defaultTo,
  initialTemplateCode,
  onClose,
  onSent,
}: {
  recordId: string;
  /** The applicant's address, prefilled. Editable once the dialog is open. */
  defaultTo?: string | null;
  /**
   * Template to open on. `null` opens a blank message — which is what the
   * header's Email button wants, since it carries no workflow intent.
   */
  initialTemplateCode?: string | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const [templateCode, setTemplateCode] = useState<string>(initialTemplateCode ?? CUSTOM);
  const [edited, setEdited] = useState(false);
  const [to, setTo] = useState(defaultTo ?? '');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const usingTemplate = templateCode !== CUSTOM;

  // The applicant's address arrives with the profile, but the Communication tab
  // opens without it — the preview carries it there. Whichever lands first wins,
  // and neither overwrites an address the operator has typed.
  useEffect(() => {
    if (defaultTo) setTo((current) => current || defaultTo);
  }, [defaultTo]);

  const { data: preview, isFetching } = useQuery({
    queryKey: ['comm-preview', recordId, templateCode, 'email'],
    queryFn: async ({ signal }) => {
      const result = await api.get<RenderedMessage>(
        '/communications/preview',
        { recordId, templateCode, channel: TEMPLATE_CHANNEL.EMAIL },
        signal,
      );
      // Only overwrite the editor while the user hasn't taken it over.
      if (!edited) {
        setSubject(result.subject ?? '');
        setBody(result.body);
      }
      if (result.to) setTo((current) => current || result.to!);
      return result;
    },
    // A custom message has no template to render, and asking for one would 404.
    enabled: usingTemplate,
  });

  const sendMutation = useMutation({
    mutationFn: () =>
      api.post('/communications/email', {
        recordId,
        // Omitted for a custom message, so the history records it as belonging
        // to no template rather than misattributing it to one.
        templateCode: usingTemplate ? templateCode : undefined,
        to: to.trim(),
        subject,
        body,
        // Untouched, the server re-renders the template's own areas. Rewritten
        // — or written from scratch — these words are what goes out.
        bodyEdited: edited || !usingTemplate,
      }),
    onSuccess: () => {
      toast.success('Email queued', {
        description: 'It sends in the background and appears in the communication history.',
      });
      onClose();
      onSent();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not queue the email'),
  });

  const addressLooksValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim());
  const ready = addressLooksValid && subject.trim().length > 0 && body.trim().length > 0;

  return (
    <Dialog
      open
      onOpenChange={onClose}
      title="Send email"
      description={
        usingTemplate
          ? 'Pick a template, edit anything you like, then send.'
          : 'A blank message. Write the subject and body yourself.'
      }
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={Icons.Mail}
            loading={sendMutation.isPending}
            disabled={!ready}
            onClick={() => sendMutation.mutate()}
          >
            Send email
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Select
          label="Template"
          hint="Choose a template to start from, or write the message yourself."
          value={templateCode}
          onChange={(event) => {
            setTemplateCode(event.target.value);
            // A different template means different words. Handing back the
            // editor is right; silently keeping the old text under a new
            // template's name would be the surprising thing.
            setEdited(false);
            if (event.target.value === CUSTOM) {
              setSubject('');
              setBody('');
            }
          }}
          options={[
            { value: CUSTOM, label: 'Custom message (blank)' },
            ...EMAIL_TEMPLATE_CODES.map((code) => ({ value: code, label: humanise(code) })),
          ]}
        />

        <Input
          label="To"
          required
          type="email"
          hint="Filled in from the applicant's profile. Change it if this needs to go elsewhere."
          value={to}
          onChange={(event) => setTo(event.target.value)}
          error={
            to.trim().length > 0 && !addressLooksValid ? 'That is not a valid address.' : undefined
          }
        />

        {/* Warn before sending, not after — a blank certificate number in a
            live email is embarrassing and hard to retract. */}
        {preview && preview.missing.length > 0 ? (
          <div className="flex gap-2 rounded-lg border border-warn-ring bg-warn-tint p-2.5">
            <Icons.ShieldAlert size={14} strokeWidth={2} className="mt-0.5 shrink-0 text-warn" />
            <p className="text-[11px] leading-relaxed text-warn">
              These fields have no value yet and will appear blank:{' '}
              <b>{preview.missing.join(', ')}</b>
            </p>
          </div>
        ) : null}

        <Input
          label="Subject"
          required
          value={subject}
          onChange={(event) => {
            setSubject(event.target.value);
            setEdited(true);
          }}
          placeholder={usingTemplate ? undefined : 'About your NBR application'}
          suffix={isFetching ? <Icons.Loader2 size={14} className="animate-spin" /> : undefined}
        />

        <Textarea
          label="Message"
          required
          value={body}
          onChange={(event) => {
            setBody(event.target.value);
            setEdited(true);
          }}
          rows={edited || !usingTemplate ? 12 : 6}
          placeholder={usingTemplate ? undefined : 'Write your message here.'}
          hint={
            usingTemplate
              ? "Placeholders are already filled with this applicant's data. Edit freely before sending."
              : 'Sent in the standard NBR email layout, with your words in it.'
          }
        />

        {/* The message as the applicant will see it. Shown for the template's
            own layout only: once the text is rewritten, what goes out is those
            words in the standard shell, and the ornate preview would be a
            picture of something else. */}
        {preview?.html && !edited ? (
          <div>
            <p className="mb-1.5 text-xs font-semibold text-ink-2">
              What {to || 'the applicant'} receives
            </p>
            <div className="h-[420px] overflow-hidden rounded-lg border border-line">
              <iframe
                title="Email preview"
                srcDoc={preview.html}
                sandbox=""
                className="h-full w-full border-0 bg-[#f1f5f9]"
              />
            </div>
          </div>
        ) : null}

        {edited && usingTemplate ? (
          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-3">
            <Icons.Info size={13} strokeWidth={2} className="mt-px shrink-0" />
            You've rewritten this message, so your words are sent in the standard layout rather
            than the template's. Reselect the template above to go back.
          </p>
        ) : null}

        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-3">
          <Icons.Info size={13} strokeWidth={2} className="mt-px shrink-0" />
          Every email is recorded in this applicant's Communication history, with the message as
          sent, who sent it and whether it was delivered.
        </p>
      </div>
    </Dialog>
  );
}
