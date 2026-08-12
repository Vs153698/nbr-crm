import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  LEGACY_APPLICATION_ACTION_META,
  type LegacyApplicationAction,
} from '@nbr/shared';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Input, Textarea } from '@/components/ui/Field';
import { useAuth } from '@/hooks/useAuth';
import { ApiError, api } from '@/lib/api-client';
import { ICON_STROKE, Icons } from '@/lib/icons';
import { queryKeys } from '@/lib/query-client';

interface Availability {
  mirrored: boolean;
  externalId: string | null;
  externalUrl: string | null;
  appCode: string | null;
  actions: LegacyApplicationAction[];
}

/** Which button variant each action's tone maps onto. */
const TONE_VARIANT = {
  primary: 'primary',
  danger: 'danger',
  warning: 'warning',
  secondary: 'secondary',
} as const;

/**
 * The review decisions that belong to the NBR website.
 *
 * Applications filed on the public site are mirrored here from the moment they
 * are submitted, so the evaluation is run from this screen — but the decision
 * itself is applied over there. The website owns the applicant's portal login,
 * the address they applied with, the WhatsApp thread and the mail templates, so
 * approving from here sends exactly the letter approving from its own admin
 * panel would.
 *
 * That is worth saying on screen rather than leaving as an implementation
 * detail: an operator clicking Reject is sending a real person a real email,
 * and the panel tells them what it says before they click.
 *
 * Renders nothing at all for a record created in the CRM — those have no
 * counterpart on the website and no decision to take there.
 */
export function WebsiteReviewPanel({
  recordId,
  applicantId,
}: {
  recordId: string;
  applicantId: string;
}) {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const [pending, setPending] = useState<LegacyApplicationAction | null>(null);

  const { data } = useQuery({
    queryKey: queryKeys.legacyActions(recordId),
    queryFn: ({ signal }) =>
      api.get<Availability>(`/records/${recordId}/legacy-actions`, undefined, signal),
  });

  // Nothing to show: CRM-native record, no actions left, or no permission.
  if (!data?.mirrored || data.actions.length === 0) return null;
  if (!can('records:change_status')) return null;

  return (
    <Card>
      <CardHeader
        title="Website review"
        subtitle="Applied on nationalbookofrecords.org, which writes to the applicant."
        icon={Icons.Globe}
        action={
          data.externalUrl ? (
            <a
              href={data.externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand hover:underline"
            >
              {data.appCode ?? 'Open there'}
              <Icons.ExternalLink size={12} strokeWidth={ICON_STROKE} />
            </a>
          ) : null
        }
      />

      <div className="flex flex-wrap gap-2">
        {data.actions.map((action) => {
          const meta = LEGACY_APPLICATION_ACTION_META[action];
          return (
            <Button
              key={action}
              size="sm"
              variant={TONE_VARIANT[meta.tone]}
              onClick={() => setPending(action)}
            >
              {meta.label}
            </Button>
          );
        })}
      </div>

      <p className="mt-3 flex items-start gap-1.5 border-t border-line pt-2.5 text-[11px] leading-relaxed text-ink-3">
        <Icons.Info size={12} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden />
        Each of these emails the applicant from the website, using its templates. The record here
        updates when the website confirms.
      </p>

      {pending ? (
        <ActionDialog
          recordId={recordId}
          action={pending}
          onClose={() => setPending(null)}
          onDone={() => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.legacyActions(recordId) });
            void queryClient.invalidateQueries({ queryKey: queryKeys.applicant(applicantId) });
            // One prefix: the action panel, timeline and client-progress badge all
            // hang off it, so none of them can be left stale.
            void queryClient.invalidateQueries({ queryKey: queryKeys.record(recordId) });
          }}
        />
      ) : null}
    </Card>
  );
}

function ActionDialog({
  recordId,
  action,
  onClose,
  onDone,
}: {
  recordId: string;
  action: LegacyApplicationAction;
  onClose: () => void;
  onDone: () => void;
}) {
  const meta = LEGACY_APPLICATION_ACTION_META[action];
  const [text, setText] = useState('');
  const [deadlineHours, setDeadlineHours] = useState('');

  const run = useMutation({
    mutationFn: () =>
      api.post(`/records/${recordId}/legacy-action`, {
        action,
        ...(meta.field ? { [meta.field]: text.trim() || undefined } : {}),
        ...(deadlineHours ? { deadlineHours: Number(deadlineHours) } : {}),
      }),
    onSuccess: () => {
      toast.success(`${meta.label} sent — the applicant has been emailed`);
      onClose();
      onDone();
    },
    onError: (error: unknown) =>
      toast.error(
        error instanceof ApiError ? error.message : `Could not ${meta.label.toLowerCase()}`,
      ),
  });

  const unsatisfied = meta.required && text.trim().length === 0;

  return (
    <Dialog
      open
      onOpenChange={onClose}
      title={meta.label}
      description="Applied on the NBR website, which emails the applicant."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={TONE_VARIANT[meta.tone]}
            loading={run.isPending}
            disabled={unsatisfied}
            onClick={() => run.mutate()}
          >
            {meta.label}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {/* What the applicant receives, before the click rather than after. */}
        <div className="flex gap-2 rounded-lg border border-info-ring bg-info-tint p-2.5 text-[11px] leading-relaxed text-ink-2">
          <Icons.Mail size={14} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0 text-brand" aria-hidden />
          <span>{meta.effect}</span>
        </div>

        {meta.field ? (
          <Textarea
            label={
              meta.field === 'message'
                ? 'What do you need from the applicant?'
                : meta.field === 'reason'
                  ? 'Reason'
                  : 'Note'
            }
            required={meta.required}
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={4}
            hint={
              meta.field === 'note' && !meta.required
                ? 'Recorded on the application. Not shown to the applicant.'
                : 'The applicant reads this in the email.'
            }
          />
        ) : null}

        {action === 'approve' || action === 'reopen' ? (
          <Input
            type="number"
            label="Payment window (hours)"
            value={deadlineHours}
            onChange={(event) => setDeadlineHours(event.target.value)}
            placeholder={action === 'approve' ? '48' : '72'}
            hint="Leave blank to use the website's configured default."
            min={1}
            max={720}
          />
        ) : null}
      </div>
    </Dialog>
  );
}
