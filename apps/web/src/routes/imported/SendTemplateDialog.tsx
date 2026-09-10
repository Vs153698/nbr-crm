import { WHATSAPP_PARAM_SOURCE, WHATSAPP_PROVIDER, type WhatsAppTemplate } from '@nbr/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input, Select } from '@/components/ui/Field';
import { ApiError, api } from '@/lib/api-client';
import { ICON_STROKE, Icons } from '@/lib/icons';

/**
 * Send an approved WhatsApp template to a certificate holder.
 *
 * The click-to-chat action beside this one hands the operator a prefilled
 * WhatsApp link to send from their own phone, which is the only route when no
 * provider is configured and still the right one for a message they want to
 * word themselves. This is for the other case: a business-initiated message to
 * a holder who has never written in, which WhatsApp carries only as a template
 * approved in advance.
 */
export function SendTemplateDialog({
  importedRecordId,
  holderName,
  phone,
  onClose,
  onSent,
}: {
  importedRecordId: string;
  holderName: string;
  phone: string | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const [templateId, setTemplateId] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [phoneOverride, setPhoneOverride] = useState(phone ?? '');

  const { data: status } = useQuery({
    queryKey: ['whatsapp-status'],
    queryFn: ({ signal }) =>
      api.get<{ configured: boolean; provider: string; templateCount: number }>(
        '/communications/whatsapp-status',
        undefined,
        signal,
      ),
    staleTime: 60_000,
  });

  const onAisensy = status?.provider === WHATSAPP_PROVIDER.AISENSY;

  const { data: templates } = useQuery({
    queryKey: ['whatsapp-registered-templates'],
    queryFn: ({ signal }) =>
      api.get<WhatsAppTemplate[]>('/communications/whatsapp-templates', undefined, signal),
    enabled: onAisensy,
    staleTime: 60_000,
  });

  const chosen = templates?.find((template) => template.id === templateId) ?? null;

  // Reset the fields when the template changes: each one asks for a different
  // set of values, and leaving the previous answers behind would put them in
  // fields that no longer mean the same thing.
  useEffect(() => setValues({}), [templateId]);

  const sendMutation = useMutation({
    mutationFn: () =>
      api.post<{ id: string; status: string }>(
        `/imported-records/${importedRecordId}/whatsapp-template`,
        {
          templateId,
          // Blank fields are omitted so the server fills them from the record;
          // sending "" would override a real value with nothing.
          values: Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim())),
          ...(phoneOverride.trim() && phoneOverride.trim() !== phone
            ? { phoneOverride: phoneOverride.trim() }
            : {}),
        },
      ),
    onSuccess: () => {
      toast.success('WhatsApp sent', { description: `Logged against ${holderName}.` });
      onSent();
      onClose();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not send the message'),
  });

  return (
    <Dialog
      open
      onOpenChange={onClose}
      title="Send WhatsApp template"
      description={`To ${holderName}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="whatsapp"
            icon={Icons.MessageCircle}
            disabled={!templateId || !phoneOverride.trim()}
            loading={sendMutation.isPending}
            onClick={() => sendMutation.mutate()}
          >
            Send
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {!onAisensy ? (
          <p className="flex items-start gap-1.5 rounded-lg bg-warn-tint p-2.5 text-[11px] text-warn">
            <Icons.Info size={13} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0" />
            Approved templates need the AiSensy provider. Set it under Settings → WhatsApp, or use
            the WhatsApp button to send from your own phone instead.
          </p>
        ) : null}

        {onAisensy && templates && templates.length === 0 ? (
          <p className="flex items-start gap-1.5 rounded-lg bg-warn-tint p-2.5 text-[11px] text-warn">
            <Icons.Info size={13} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0" />
            No templates are registered yet. Add them under Settings → WhatsApp using the campaign
            names from your AiSensy account.
          </p>
        ) : null}

        {onAisensy ? (
          <>
            <Select
              label="Template"
              value={templateId}
              onChange={(event) => setTemplateId(event.target.value)}
              options={[
                { value: '', label: '— Choose a template —' },
                ...(templates ?? []).map((template) => ({
                  value: template.id,
                  label: template.label,
                })),
              ]}
            />

            <Input
              label="Send to"
              value={phoneOverride}
              onChange={(event) => setPhoneOverride(event.target.value)}
              placeholder="9876543210"
              hint={phone ? undefined : 'This record has no number on file — enter one to send.'}
            />

            {chosen && chosen.params.length > 0 ? (
              <div className="space-y-2 rounded-lg border border-line bg-canvas p-3">
                <p className="text-2xs font-semibold uppercase tracking-wider text-ink-3">
                  Message details
                </p>
                {chosen.params.map((param, index) => (
                  <Input
                    key={param.key}
                    label={`${index + 1}. ${param.label || param.key}`}
                    placeholder={
                      param.source === WHATSAPP_PARAM_SOURCE.MANUAL
                        ? 'Type a value'
                        : 'Filled from this record — type to override'
                    }
                    value={values[param.key] ?? ''}
                    onChange={(event) =>
                      setValues((prev) => ({ ...prev, [param.key]: event.target.value }))
                    }
                  />
                ))}
              </div>
            ) : null}

            {chosen ? (
              <p className="flex items-start gap-1.5 text-[11px] text-ink-3">
                <Icons.Info size={13} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0" />
                The wording comes from the template approved in your WhatsApp account, so it cannot
                be previewed or edited here.
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
