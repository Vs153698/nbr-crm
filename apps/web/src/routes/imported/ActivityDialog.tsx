import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input, Textarea } from '@/components/ui/Field';
import { ApiError, api } from '@/lib/api-client';
import { Icons, type LucideIcon } from '@/lib/icons';
import { queryKeys } from '@/lib/query-client';
import type { ActivityKind, ActivityResult, ImportedRecord } from './types';

interface KindMeta {
  title: string;
  description: string;
  icon: LucideIcon;
  submitLabel: string;
  variant: 'primary' | 'whatsapp' | 'secondary';
  bodyLabel: string;
  placeholder: string;
  /** Email and WhatsApp need somewhere to send to; notes and tasks never do. */
  requires?: 'email' | 'phone';
}

export const ACTIVITY_META: Record<ActivityKind, KindMeta> = {
  email: {
    title: 'Send an email',
    description: 'Sent over the same mail server the rest of the CRM uses.',
    icon: Icons.Mail,
    submitLabel: 'Send email',
    variant: 'primary',
    bodyLabel: 'Message',
    placeholder: 'Write the message…',
    requires: 'email',
  },
  whatsapp: {
    title: 'Send a WhatsApp message',
    description: 'Opens WhatsApp with the message ready — you send it from your own account.',
    icon: Icons.MessageCircle,
    submitLabel: 'Open WhatsApp',
    variant: 'whatsapp',
    bodyLabel: 'Message',
    placeholder: 'Write the message…',
    requires: 'phone',
  },
  note: {
    title: 'Add a note',
    description: 'Internal only. The holder never sees this.',
    icon: Icons.StickyNote,
    submitLabel: 'Save note',
    variant: 'secondary',
    bodyLabel: 'Note',
    placeholder: 'What should the next person to open this record know?',
  },
  task: {
    title: 'Add a task',
    description: 'A reminder to come back to this record.',
    icon: Icons.ClipboardCheck,
    submitLabel: 'Add task',
    variant: 'secondary',
    bodyLabel: 'What needs doing',
    placeholder: 'Call to confirm the postal address…',
  },
};

/**
 * The one dialog behind all four permitted actions.
 *
 * They differ only in their copy, one extra field each, and what they do on
 * submit — four near-identical components would drift apart the first time one
 * of them got a fix.
 */
export function ActivityDialog({
  kind,
  record,
  open,
  onOpenChange,
}: {
  kind: ActivityKind;
  record: ImportedRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const meta = ACTIVITY_META[kind];
  const queryClient = useQueryClient();

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [dueAt, setDueAt] = useState('');

  // Reopening must not show the last message still sitting in the box — it is
  // too easy to send it to the wrong person a second time.
  useEffect(() => {
    if (open) {
      setSubject('');
      setBody('');
      setDueAt('');
    }
  }, [open]);

  const submit = useMutation({
    mutationFn: () =>
      api.post<ActivityResult>(`/imported-records/${record.id}/activity`, {
        kind,
        subject: kind === 'email' ? subject.trim() || undefined : undefined,
        body: body.trim(),
        dueAt: kind === 'task' && dueAt ? new Date(dueAt).toISOString() : undefined,
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.importedRecord(record.id) });
      onOpenChange(false);

      if (kind === 'whatsapp' && result.whatsappUrl) {
        // Opened after the row is safely recorded, so a blocked popup never
        // costs the log entry.
        window.open(result.whatsappUrl, '_blank', 'noopener,noreferrer');
        toast.success('Logged — WhatsApp opened in a new tab', {
          description: 'Send it there, then it is on this record either way.',
        });
        return;
      }

      const confirmation: Record<ActivityKind, string> = {
        email: `Email sent to ${record.email}`,
        whatsapp: 'WhatsApp message logged',
        note: 'Note added',
        task: 'Task added',
      };
      toast.success(confirmation[kind]);
    },
    onError: (error) =>
      toast.error(
        error instanceof ApiError ? error.message : `Could not ${meta.submitLabel.toLowerCase()}`,
      ),
  });

  const missingContact =
    (meta.requires === 'email' && !record.email) || (meta.requires === 'phone' && !record.phone);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={meta.title}
      description={meta.description}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submit.isPending}>
            Cancel
          </Button>
          <Button
            variant={meta.variant}
            icon={meta.icon}
            loading={submit.isPending}
            disabled={!body.trim() || missingContact}
            onClick={() => submit.mutate()}
          >
            {meta.submitLabel}
          </Button>
        </>
      }
    >
      {missingContact ? (
        <p className="mb-4 flex items-start gap-2 rounded-lg bg-warn-tint px-3 py-2.5 text-xs text-warn">
          <Icons.AlertCircle size={15} strokeWidth={2} className="mt-px shrink-0" />
          This record has no {meta.requires === 'email' ? 'email address' : 'phone number'} on the
          website, so there is nowhere to send it. Add one on the website, then sync again.
        </p>
      ) : (
        <p className="mb-4 text-xs text-ink-3">
          To <span className="font-medium text-ink-2">{record.holderName}</span>
          {meta.requires === 'email' ? ` · ${record.email}` : null}
          {meta.requires === 'phone' ? ` · ${record.phone}` : null}
        </p>
      )}

      <div className="flex flex-col gap-3">
        {kind === 'email' ? (
          <Input
            label="Subject"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder={`Regarding your record — ${record.certificateNumber}`}
            hint="Left blank, the certificate number is used."
            maxLength={300}
          />
        ) : null}

        <Textarea
          label={meta.bodyLabel}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder={meta.placeholder}
          rows={kind === 'note' || kind === 'task' ? 4 : 7}
          maxLength={5000}
          required
        />

        {kind === 'task' ? (
          <Input
            label="Due"
            type="datetime-local"
            value={dueAt}
            onChange={(event) => setDueAt(event.target.value)}
            hint="Optional. A task with no due date is just a reminder on the record."
          />
        ) : null}
      </div>
    </Dialog>
  );
}
