import { useQuery } from '@tanstack/react-query';
import { Chip } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { QueryError } from '@/components/ui/Card';
import { Sheet } from '@/components/ui/Sheet';
import { api } from '@/lib/api-client';
import { formatDateTime, humanise } from '@/lib/format';
import { ICON_SIZE, ICON_STROKE, Icons } from '@/lib/icons';

export interface MessageDetail {
  id: string;
  channel: string;
  direction: string;
  templateCode: string | null;
  templateName: string | null;
  to: string | null;
  from: string | null;
  cc: string[];
  subject: string | null;
  body: string;
  status: string;
  attemptCount: number;
  failureReason: string | null;
  providerMessageId: string | null;
  queuedAt: string | null;
  sentAt: string | null;
  failedAt: string | null;
  createdAt: string;
  sentByName: string | null;
  callDurationMinutes: number | null;
  callOutcome: string | null;
  attachments: Array<{ key: string; fileName: string; url: string }>;
}

/**
 * One message, opened from the communication log (§22 Email History).
 *
 * The list is a scannable index — subject, who, when, whether it went — and
 * three lines of body. This is the thing an operator actually needs when a
 * customer says "you never told me": every header, the complete body as sent,
 * the delivery outcome and the files that went with it.
 *
 * The body is rendered as stored text rather than as HTML. What is kept is the
 * plain-text rendering of the message, and injecting the ornate email shell
 * here would show a reconstruction rather than the record — worse, it would put
 * unsanitised stored markup into the page.
 */
export function MessageDetailSheet({
  communicationId,
  onClose,
}: {
  communicationId: string;
  onClose: () => void;
}) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['communications', 'detail', communicationId],
    queryFn: ({ signal }) =>
      api.get<MessageDetail>(`/communications/${communicationId}`, undefined, signal),
  });

  const failed = data?.status === 'failed';

  return (
    <Sheet
      open
      onOpenChange={onClose}
      size="lg"
      title={data?.subject ?? (data ? humanise(data.channel) : 'Message')}
      description={
        data ? (
          <span className="flex flex-wrap items-center gap-2">
            <Chip tone={failed ? 'red' : data.status === 'queued' ? 'orange' : 'green'}>
              {humanise(data.status)}
            </Chip>
            <span className="text-[11px] text-ink-3">{humanise(data.channel)}</span>
            {data.templateCode ? (
              <span className="text-[11px] text-ink-3">
                · Template: {data.templateName ?? humanise(data.templateCode)}
              </span>
            ) : (
              <span className="text-[11px] text-ink-3">· No template — written by hand</span>
            )}
          </span>
        ) : undefined
      }
      footer={
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="space-y-4 p-4">
        {isLoading ? (
          <div className="space-y-2">
            <div className="skeleton h-24" />
            <div className="skeleton h-48" />
          </div>
        ) : isError || !data ? (
          <QueryError title="Couldn't load this message" onRetry={() => void refetch()} />
        ) : (
          <>
            {/* ── Headers ─────────────────────────────────────────────── */}
            <dl className="rounded-card border border-line bg-white">
              <Header label="From" value={data.from} />
              <Header label="To" value={data.to} />
              {data.cc.length > 0 ? <Header label="CC" value={data.cc.join(', ')} /> : null}
              <Header label="Subject" value={data.subject} />
              <Header
                label="Date & time"
                value={formatDateTime(data.sentAt ?? data.queuedAt ?? data.createdAt)}
              />
              <Header label="Sent by" value={data.sentByName} />
              <Header
                label="Status"
                value={
                  <span className="flex flex-wrap items-center gap-2">
                    <span>{humanise(data.status)}</span>
                    {data.attemptCount > 1 ? (
                      <span className="text-[11px] text-ink-3">
                        after {data.attemptCount} attempts
                      </span>
                    ) : null}
                  </span>
                }
              />
              {data.callDurationMinutes ? (
                <Header label="Call duration" value={`${data.callDurationMinutes} min`} />
              ) : null}
              {data.callOutcome ? <Header label="Outcome" value={data.callOutcome} /> : null}
            </dl>

            {failed && data.failureReason ? (
              <p className="flex gap-2 rounded-card border border-danger-ring bg-danger-tint px-3 py-2.5 text-[11px] text-ink-2">
                <Icons.XCircle
                  size={ICON_SIZE.sm}
                  strokeWidth={ICON_STROKE}
                  className="mt-px shrink-0 text-danger"
                />
                <span>
                  <span className="font-semibold text-danger">This did not reach them.</span>{' '}
                  {data.failureReason}
                </span>
              </p>
            ) : null}

            {/* ── The message itself ──────────────────────────────────── */}
            <section>
              <h4 className="mb-1.5 text-xs font-bold uppercase tracking-wider text-ink-2">
                Message
              </h4>
              <div className="whitespace-pre-wrap rounded-card border border-line bg-white p-3.5 text-xs leading-relaxed text-ink">
                {data.body}
              </div>
              <p className="mt-1.5 text-[10px] text-ink-3">
                Stored as sent. Rewording the template later does not change this.
              </p>
            </section>

            {/* ── Attachments ─────────────────────────────────────────── */}
            {data.attachments.length > 0 ? (
              <section>
                <h4 className="mb-1.5 text-xs font-bold uppercase tracking-wider text-ink-2">
                  Attachments ({data.attachments.length})
                </h4>
                <ul className="space-y-1.5">
                  {data.attachments.map((file) => (
                    <li
                      key={file.key}
                      className="flex items-center gap-2.5 rounded-lg border border-line bg-white p-2.5"
                    >
                      <Icons.FileText
                        size={ICON_SIZE.md}
                        strokeWidth={ICON_STROKE}
                        className="shrink-0 text-ink-3"
                      />
                      <span className="min-w-0 flex-1 truncate text-xs text-ink">
                        {file.fileName}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={Icons.Download}
                        onClick={() => window.open(file.url, '_blank', 'noopener,noreferrer')}
                      >
                        Download
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}
      </div>
    </Sheet>
  );
}

function Header({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-3 border-b border-line px-3 py-2 last:border-b-0">
      <dt className="w-24 shrink-0 text-[11px] font-semibold text-ink-3">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-xs text-ink">{value || '—'}</dd>
    </div>
  );
}
