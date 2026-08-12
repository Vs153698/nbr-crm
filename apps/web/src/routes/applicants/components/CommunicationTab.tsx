import {
  COMMUNICATION_CHANNEL,
  EMAIL_TEMPLATE_CODES,
  TEMPLATE_CHANNEL,
  WHATSAPP_TEMPLATE_CODES,
} from '@nbr/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Chip } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmailComposerDialog } from './EmailComposerDialog';
import { MessageDetailSheet } from './MessageDetailSheet';
import { SelectionLetterDialog } from './SelectionLetterDialog';
import { CardHeader, EmptyState } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Input, Select, Textarea } from '@/components/ui/Field';
import { useAuth } from '@/hooks/useAuth';
import { api, ApiError } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { formatDateTime, formatRelative, humanise } from '@/lib/format';
import { ICON_SIZE, ICON_STROKE, Icons } from '@/lib/icons';
import { queryKeys } from '@/lib/query-client';
import type { CommunicationRow, RenderedMessage } from '../types';
import { useAutoOpen } from '@/hooks/useAutoOpen';

const CHANNEL_STYLE: Record<string, { icon: keyof typeof Icons; tone: string }> = {
  email: { icon: 'Mail', tone: 'bg-purple-tint text-purple' },
  whatsapp: { icon: 'MessageCircle', tone: 'bg-ok-tint text-ok' },
  call: { icon: 'Phone', tone: 'bg-info-tint text-info' },
  sms: { icon: 'MessageCircle', tone: 'bg-slate2-tint text-slate2' },
};

/**
 * W-17 Communication tab (§22).
 *
 * Shows what was actually sent — the stored rendered body, not a template
 * reference — so the history stays truthful after a template is reworded.
 */
export function CommunicationTab({
  recordId,
  applicantId,
  applicantEmail,
  doNotContact,
  autoOpen,
  onAutoOpened,
}: {
  recordId: string;
  applicantId: string;
  /** Prefills the composer's To field without waiting on a template preview. */
  applicantEmail?: string | null;
  doNotContact: boolean;
  autoOpen?: string | null;
  onAutoOpened?: () => void;
}) {
  const queryClient = useQueryClient();
  const { can } = useAuth();

  const [channelFilter, setChannelFilter] = useState<string>('');
  const [emailOpen, setEmailOpen] = useState(false);
  const [selectionOpen, setSelectionOpen] = useState(false);
  const [whatsappOpen, setWhatsappOpen] = useState(false);
  const [callOpen, setCallOpen] = useState(false);
  /** Message opened from the log, or null. */
  const [openMessageId, setOpenMessageId] = useState<string | null>(null);
  /**
   * Template the Smart Action panel asked for, e.g. `email:selection`.
   * Carried separately so the dialog opens on the right message rather than on
   * whichever template happens to sort first.
   */
  const [presetTemplate, setPresetTemplate] = useState<string | null>(null);

  useAutoOpen(
    autoOpen,
    {
      email: () => { setPresetTemplate(null); setEmailOpen(true); },
      'call-note': () => setCallOpen(true),
      // The selection letter is its own composer — fixed wording, an attached
      // Achiever Pack and a preview — rather than a template in the generic one.
      'selection-letter': () => setSelectionOpen(true),
      ...Object.fromEntries(
        EMAIL_TEMPLATE_CODES.map((code) => [
          `email:${code}`,
          () => { setPresetTemplate(code); setEmailOpen(true); },
        ]),
      ),
      ...Object.fromEntries(
        WHATSAPP_TEMPLATE_CODES.map((code) => [
          `whatsapp:${code}`,
          () => { setPresetTemplate(code); setWhatsappOpen(true); },
        ]),
      ),
    },
    onAutoOpened,
  );

  const { data: history, isLoading } = useQuery({
    queryKey: queryKeys.communications(applicantId, channelFilter),
    queryFn: ({ signal }) =>
      api.get<CommunicationRow[]>(
        '/communications',
        { applicantId, channel: channelFilter || undefined },
        signal,
      ),
  });

  const retryMutation = useMutation({
    mutationFn: (id: string) => api.post(`/communications/${id}/retry`),
    onSuccess: () => {
      toast.success('Retrying the send');
      invalidate();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not retry'),
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['communications', applicantId] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.record(recordId) });
  }

  const canSend = can('communications:send');

  return (
    <div className="space-y-4">
      {selectionOpen ? (
        <SelectionLetterDialog
          recordId={recordId}
          applicantId={applicantId}
          onClose={() => setSelectionOpen(false)}
        />
      ) : null}

      <CardHeader
        title="Communication"
        subtitle="Every email, WhatsApp message and call note, in one place."
        icon={Icons.Mail}
        action={
          canSend && !doNotContact ? (
            <div className="flex flex-wrap gap-2">
              {/* Its own action rather than one template among many: the letter
                  has a fixed structure and asks which award it is first, so it
                  cannot be composed through the generic email dialog. */}
              <Button
                size="sm"
                variant="primary"
                icon={Icons.Award}
                onClick={() => setSelectionOpen(true)}
              >
                Selection letter
              </Button>
              <Button size="sm" variant="secondary" icon={Icons.Mail} onClick={() => setEmailOpen(true)}>
                Email
              </Button>
              <Button
                size="sm"
                variant="whatsapp"
                icon={Icons.MessageCircle}
                onClick={() => setWhatsappOpen(true)}
              >
                WhatsApp
              </Button>
              <Button size="sm" variant="secondary" icon={Icons.Phone} onClick={() => setCallOpen(true)}>
                Log call
              </Button>
            </div>
          ) : canSend ? (
            <Button size="sm" variant="secondary" icon={Icons.Phone} onClick={() => setCallOpen(true)}>
              Log call
            </Button>
          ) : null
        }
      />

      {doNotContact ? (
        <div className="flex gap-2.5 rounded-lg border border-slate2-ring bg-slate2-tint p-3">
          <Icons.BellOff size={ICON_SIZE.md} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0 text-slate2" />
          <p className="text-xs leading-relaxed text-ink-2">
            This applicant is flagged <b>Do Not Contact</b>. Outbound email and WhatsApp are
            disabled, and the server refuses them even if the request is made directly. Call notes
            can still be recorded.
          </p>
        </div>
      ) : null}

      {/* Channel filter */}
      <div className="flex flex-wrap gap-1.5">
        {[{ value: '', label: 'All' }, ...Object.values(COMMUNICATION_CHANNEL).map((value) => ({ value, label: humanise(value) }))].map(
          (option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setChannelFilter(option.value)}
              aria-pressed={channelFilter === option.value}
              className={cn(
                'rounded-full border px-2.5 py-1 text-2xs font-medium transition-colors',
                channelFilter === option.value
                  ? 'border-brand bg-brand text-white'
                  : 'border-line bg-white text-ink-2 hover:bg-canvas',
              )}
            >
              {option.label}
            </button>
          ),
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((index) => (
            <div key={index} className="skeleton h-16" />
          ))}
        </div>
      ) : (history?.length ?? 0) === 0 ? (
        <EmptyState icon={Icons.Mail} title="Nothing sent yet" />
      ) : (
        <ul className="space-y-2">
          {history?.map((message) => {
            const style = CHANNEL_STYLE[message.channel] ?? CHANNEL_STYLE.email!;
            const Icon = Icons[style.icon];
            const failed = message.status === 'failed';

            return (
              <li
                key={message.id}
                className={cn(
                  'rounded-lg border p-3 transition-colors',
                  failed
                    ? 'border-danger-ring bg-danger-tint/40 hover:bg-danger-tint/60'
                    : 'border-line hover:bg-canvas',
                )}
              >
                {/*
                  The whole row opens the message.

                  A button wrapping the content rather than an "Open" affordance
                  in the corner: the list is an index, and the natural gesture
                  on an index entry is to click the entry. `text-left` because a
                  button centres its content by default and this is a paragraph.

                  The Retry control below lives inside this row and stops its
                  own click from bubbling, so retrying does not also open the
                  message.
                */}
                <button
                  type="button"
                  onClick={() => setOpenMessageId(message.id)}
                  className="flex w-full items-start gap-2.5 text-left"
                  title="Open this message"
                >
                  <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-md', style.tone)}>
                    <Icon size={14} strokeWidth={2} />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="min-w-0 flex-1 truncate text-xs font-medium text-ink">
                        {message.subject ??
                          (message.templateCode ? humanise(message.templateCode) : humanise(message.channel))}
                      </p>
                      <Chip
                        tone={
                          message.status === 'sent' || message.status === 'marked_sent'
                            ? 'green'
                            : failed
                              ? 'red'
                              : 'orange'
                        }
                      >
                        {humanise(message.status)}
                      </Chip>
                    </div>

                    <p className="text-[10px] text-ink-3">
                      {message.toAddress ? `${message.toAddress} · ` : ''}
                      {message.sentByName} ·{' '}
                      <span title={formatDateTime(message.createdAt)}>
                        {formatRelative(message.sentAt ?? message.createdAt)}
                      </span>
                      {message.callDurationMinutes ? ` · ${message.callDurationMinutes} min` : ''}
                    </p>

                    <p className="mt-1.5 whitespace-pre-wrap text-[11px] leading-relaxed text-ink-2 line-clamp-3">
                      {message.body}
                    </p>
                  </div>

                  <Icons.ChevronRight
                    size={14}
                    strokeWidth={ICON_STROKE}
                    className="mt-0.5 shrink-0 text-ink-4"
                  />
                </button>

                {/* Outside the row button — a button inside a button is invalid
                    markup, and the browser resolves it by dropping one of them. */}
                {failed ? (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-[2.375rem]">
                    <p className="text-[10px] text-danger">
                      Failed after {message.attemptCount} attempt
                      {message.attemptCount === 1 ? '' : 's'}: {message.failureReason}
                    </p>
                    {canSend ? (
                      <button
                        type="button"
                        onClick={() => retryMutation.mutate(message.id)}
                        className="text-[10px] font-semibold text-brand hover:underline"
                      >
                        Retry
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {openMessageId ? (
        <MessageDetailSheet
          communicationId={openMessageId}
          onClose={() => setOpenMessageId(null)}
        />
      ) : null}

      {emailOpen ? (
        <EmailComposerDialog
          recordId={recordId}
          defaultTo={applicantEmail}
          initialTemplateCode={presetTemplate}
          onClose={() => setEmailOpen(false)}
          onSent={invalidate}
        />
      ) : null}
      {whatsappOpen ? (
        <WhatsAppDialog
          recordId={recordId}
          initialTemplateCode={presetTemplate}
          onClose={() => setWhatsappOpen(false)}
          onSent={invalidate}
        />
      ) : null}
      {callOpen ? (
        <CallNoteDialog
          applicantId={applicantId}
          recordId={recordId}
          onClose={() => setCallOpen(false)}
          onSaved={invalidate}
        />
      ) : null}
    </div>
  );
}

/** M-08 WhatsApp click-to-chat with an explicit "mark as sent". */
function WhatsAppDialog({
  recordId,
  initialTemplateCode,
  onClose,
  onSent,
}: {
  recordId: string;
  /** Preselected by the Smart Action panel; null when opened from the tab. */
  initialTemplateCode?: string | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const [templateCode, setTemplateCode] = useState<string>(
    initialTemplateCode ?? WHATSAPP_TEMPLATE_CODES[0] ?? 'selection',
  );
  const [link, setLink] = useState<{ communicationId: string; link: string; body: string } | null>(
    null,
  );

  const { data: preview } = useQuery({
    queryKey: ['comm-preview', recordId, templateCode, 'whatsapp'],
    queryFn: ({ signal }) =>
      api.get<RenderedMessage>(
        '/communications/preview',
        { recordId, templateCode, channel: TEMPLATE_CHANNEL.WHATSAPP },
        signal,
      ),
  });

  const linkMutation = useMutation({
    mutationFn: () =>
      api.post<{ communicationId: string; link: string; body: string }>(
        '/communications/whatsapp-link',
        { recordId, templateCode },
      ),
    onSuccess: (result) => {
      setLink(result);
      window.open(result.link, '_blank', 'noopener,noreferrer');
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not build the link'),
  });

  const confirmMutation = useMutation({
    mutationFn: () =>
      api.post('/communications/whatsapp-sent', { communicationId: link?.communicationId }),
    onSuccess: () => {
      toast.success('Recorded as sent');
      onClose();
      onSent();
    },
  });

  return (
    <Dialog
      open
      onOpenChange={onClose}
      title="Send WhatsApp"
      description={preview?.to ? `To ${preview.to}` : undefined}
      footer={
        link ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Not sent
            </Button>
            <Button
              variant="success"
              icon={Icons.Check}
              loading={confirmMutation.isPending}
              onClick={() => confirmMutation.mutate()}
            >
              I sent it
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="whatsapp"
              icon={Icons.MessageCircle}
              loading={linkMutation.isPending}
              onClick={() => linkMutation.mutate()}
            >
              Open WhatsApp
            </Button>
          </>
        )
      }
    >
      <div className="space-y-3">
        <Select
          label="Template"
          value={templateCode}
          onChange={(event) => {
            setTemplateCode(event.target.value);
            setLink(null);
          }}
          options={WHATSAPP_TEMPLATE_CODES.map((code) => ({ value: code, label: humanise(code) }))}
        />

        <div>
          <p className="mb-1.5 text-xs font-semibold text-ink-2">Message preview</p>
          <pre className="whitespace-pre-wrap rounded-lg border border-line bg-canvas p-3 font-sans text-[11px] leading-relaxed text-ink">
            {link?.body ?? preview?.body ?? '…'}
          </pre>
        </div>

        {link ? (
          <p className="flex items-start gap-1.5 rounded-lg bg-warn-tint p-2.5 text-[11px] text-warn">
            <Icons.Info size={13} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0" />
            WhatsApp opened in a new tab with the message prefilled. Confirm below once you've
            actually sent it — the history records what you confirm, not what we assume.
          </p>
        ) : (
          <p className="flex items-start gap-1.5 text-[11px] text-ink-3">
            <Icons.Info size={13} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0" />
            Phase 1–2 uses click-to-chat. WhatsApp Business API automation is a future phase.
          </p>
        )}
      </div>
    </Dialog>
  );
}

function CallNoteDialog({
  applicantId,
  recordId,
  onClose,
  onSaved,
}: {
  applicantId: string;
  recordId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [summary, setSummary] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('');
  const [outcome, setOutcome] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');

  const saveMutation = useMutation({
    mutationFn: () =>
      api.post('/communications/call-note', {
        applicantId,
        recordId,
        summary,
        durationMinutes: durationMinutes ? Number(durationMinutes) : undefined,
        outcome: outcome || undefined,
        followUpDate: followUpDate || undefined,
      }),
    onSuccess: () => {
      toast.success('Call logged', {
        description: followUpDate ? 'A follow-up task has been created for you.' : undefined,
      });
      onClose();
      onSaved();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not log the call'),
  });

  return (
    <Dialog
      open
      onOpenChange={onClose}
      title="Log a call"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={saveMutation.isPending}
            disabled={!summary.trim()}
            onClick={() => saveMutation.mutate()}
          >
            Save call note
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Textarea
          label="What was discussed"
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          rows={5}
          autoFocus
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Duration (minutes)"
            type="number"
            min={0}
            value={durationMinutes}
            onChange={(event) => setDurationMinutes(event.target.value)}
          />
          <Input
            label="Outcome"
            value={outcome}
            onChange={(event) => setOutcome(event.target.value)}
            placeholder="e.g. Will pay by Friday"
          />
        </div>
        <Input
          type="date"
          label="Follow up on"
          hint="Creates a task assigned to you, so the callback is not lost when this dialog closes."
          value={followUpDate}
          onChange={(event) => setFollowUpDate(event.target.value)}
        />
      </div>
    </Dialog>
  );
}
