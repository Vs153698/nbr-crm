import * as Popover from '@radix-ui/react-popover';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Card';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { formatRelative } from '@/lib/format';
import { ICON_SIZE, ICON_STROKE, Icons, type LucideIcon } from '@/lib/icons';

interface NotificationRow {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  severity: string;
  link: string | null;
  applicantId: string | null;
  recordId: string | null;
  readAt: string | null;
  createdAt: string;
}

const SEVERITY_STYLE: Record<string, { dot: string; icon: LucideIcon }> = {
  critical: { dot: 'bg-danger', icon: Icons.ShieldAlert },
  warning: { dot: 'bg-warn', icon: Icons.Clock },
  info: { dot: 'bg-brand', icon: Icons.Info },
};

/**
 * W-31 Notifications panel (§25).
 *
 * The badge polls a dedicated count endpoint every minute; the list itself is
 * only fetched when the panel opens. Polling the full list to render a number
 * would be the same request forty times an hour for one integer.
 */
export function NotificationsBell() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [open, setOpen] = useState(false);

  const allowed = can('notifications:view');

  const { data: count } = useQuery({
    queryKey: ['notifications', 'count'],
    queryFn: ({ signal }) => api.get<{ unread: number }>('/notifications/count', undefined, signal),
    enabled: allowed,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const { data: items, isLoading } = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: ({ signal }) => api.get<NotificationRow[]>('/notifications', undefined, signal),
    // Only when the panel is actually on screen.
    enabled: allowed && open,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };

  const readMutation = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: invalidate,
  });

  const readAllMutation = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: invalidate,
  });

  const dismissMutation = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/dismiss`),
    onSuccess: invalidate,
  });

  if (!allowed) return null;

  const unread = count?.unread ?? 0;

  function openNotification(notification: NotificationRow) {
    if (!notification.readAt) readMutation.mutate(notification.id);

    const target =
      notification.link ??
      (notification.applicantId ? `/applicants/${notification.applicantId}` : null);

    if (target) {
      setOpen(false);
      navigate(target);
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
          className="relative grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-canvas hover:text-ink"
        >
          <Icons.BellRing size={ICON_SIZE.md} strokeWidth={ICON_STROKE} />
          {unread > 0 ? (
            <span className="tabular absolute right-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[9px] font-bold text-white ring-2 ring-white">
              {unread > 99 ? '99+' : unread}
            </span>
          ) : null}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 w-[360px] max-w-[calc(100vw-1rem)] rounded-card border border-line bg-white shadow-pop animate-scale-in"
        >
          <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
            <h2 className="text-xs font-semibold text-ink">Notifications</h2>
            {unread > 0 ? (
              <Button
                size="sm"
                variant="ghost"
                loading={readAllMutation.isPending}
                onClick={() => readAllMutation.mutate()}
              >
                Mark all read
              </Button>
            ) : null}
          </div>

          <div className="scrollbar-slim max-h-[420px] overflow-y-auto">
            {isLoading ? (
              <div className="space-y-2 p-3">
                {[0, 1, 2].map((index) => (
                  <div key={index} className="skeleton h-12" />
                ))}
              </div>
            ) : (items?.length ?? 0) === 0 ? (
              <EmptyState
                icon={Icons.BellRing}
                title="You're all caught up"
                description="Alerts about overdue payments, stalled queues and due tasks appear here."
              />
            ) : (
              <ul className="divide-y divide-line">
                {items?.map((notification) => {
                  const style = SEVERITY_STYLE[notification.severity] ?? SEVERITY_STYLE.info!;
                  const Icon = style.icon;

                  return (
                    <li key={notification.id} className="group relative">
                      <button
                        type="button"
                        onClick={() => openNotification(notification)}
                        className={cn(
                          'flex w-full gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-canvas',
                          notification.readAt ? 'opacity-60' : '',
                        )}
                      >
                        <span
                          className={cn(
                            'mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-white',
                            style.dot,
                          )}
                        >
                          <Icon size={12} strokeWidth={2.2} />
                        </span>

                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-semibold text-ink">
                            {notification.title}
                          </span>
                          {notification.body ? (
                            <span className="block text-[11px] leading-relaxed text-ink-2">
                              {notification.body}
                            </span>
                          ) : null}
                          <span className="mt-0.5 block text-[10px] text-ink-3">
                            {formatRelative(notification.createdAt)}
                          </span>
                        </span>

                        {!notification.readAt ? (
                          <span
                            className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand"
                            aria-hidden
                          />
                        ) : null}
                      </button>

                      <button
                        type="button"
                        aria-label="Dismiss"
                        onClick={() => dismissMutation.mutate(notification.id)}
                        className="absolute right-1.5 top-1.5 hidden h-6 w-6 place-items-center rounded text-ink-4 hover:bg-slate2-tint hover:text-ink-2 group-hover:grid"
                      >
                        <Icons.X size={12} strokeWidth={2.2} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
