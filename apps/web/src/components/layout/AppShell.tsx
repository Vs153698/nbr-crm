import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useState } from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { initials } from '@/lib/format';
import { ICON_SIZE, ICON_STROKE, Icons } from '@/lib/icons';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';
import { GlobalSearch } from './GlobalSearch';
import { Sidebar } from './Sidebar';

/**
 * P1-05 App shell.
 *
 * Fixed navy sidebar with the topbar's global search, notification bell and
 * profile menu. Below `lg` the sidebar becomes a slide-over — the plan asks for
 * responsive down to tablet, and a verifier reviewing evidence on an iPad is a
 * real use case.
 */
export function AppShell() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { user, can, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      {/* Desktop sidebar */}
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      {/* Tablet / mobile slide-over */}
      {mobileNavOpen ? (
        <div
          className="fixed inset-0 z-40 bg-navy/50 backdrop-blur-[2px] animate-fade-in lg:hidden"
          onClick={() => setMobileNavOpen(false)}
          role="presentation"
        >
          <div
            className="h-full w-[236px] shadow-pop animate-slide-up"
            onClick={(event) => event.stopPropagation()}
          >
            <Sidebar onNavigate={() => setMobileNavOpen(false)} />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-white px-3 sm:px-4">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-canvas lg:hidden"
          >
            <Icons.SlidersHorizontal size={ICON_SIZE.md} strokeWidth={ICON_STROKE} />
          </button>

          <div className="min-w-0 flex-1">
            <GlobalSearch />
          </div>

          {can('applicants:create') ? (
            <Button
              variant="primary"
              icon={Icons.Plus}
              onClick={() => navigate('/applicants/new')}
              className="hidden sm:inline-flex"
            >
              New Applicant
            </Button>
          ) : null}

          <button
            type="button"
            aria-label="Notifications"
            title="Notifications — Phase 2"
            className="relative grid h-9 w-9 shrink-0 cursor-not-allowed place-items-center rounded-lg text-ink-4"
          >
            <Icons.BellRing size={ICON_SIZE.md} strokeWidth={ICON_STROKE} />
          </button>

          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                className="flex shrink-0 items-center gap-2 rounded-lg py-1 pl-1 pr-1.5 transition-colors hover:bg-canvas"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-navy text-2xs font-bold text-white">
                  {initials(user?.fullName ?? '?')}
                </span>
                <span className="hidden min-w-0 text-left md:block">
                  <span className="block truncate text-xs font-semibold text-ink">
                    {user?.fullName}
                  </span>
                  <span className="block truncate text-[10px] text-ink-3">{user?.role.name}</span>
                </span>
                <Icons.ChevronDown size={14} strokeWidth={ICON_STROKE} className="hidden text-ink-3 md:block" />
              </button>
            </DropdownMenu.Trigger>

            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={6}
                className="z-50 w-56 rounded-card border border-line bg-white p-1 shadow-pop animate-scale-in"
              >
                <div className="border-b border-line px-3 py-2">
                  <p className="truncate text-xs font-semibold text-ink">{user?.fullName}</p>
                  <p className="truncate text-[10px] text-ink-3">{user?.email}</p>
                </div>

                <DropdownMenu.Item asChild>
                  <Link
                    to="/change-password"
                    className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-xs text-ink-2 outline-none transition-colors hover:bg-canvas data-[highlighted]:bg-canvas"
                  >
                    <Icons.Lock size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />
                    Change password
                  </Link>
                </DropdownMenu.Item>

                <DropdownMenu.Separator className="my-1 h-px bg-line" />

                <DropdownMenu.Item
                  onSelect={() => void handleLogout()}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-xs text-danger outline-none transition-colors hover:bg-danger-tint data-[highlighted]:bg-danger-tint"
                >
                  <Icons.LogOut size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />
                  Sign out
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </header>

        <main className={cn('scrollbar-slim min-h-0 flex-1 overflow-y-auto')}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/** Consistent page header used by every screen inside the shell. */
export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  back?: { to: string; label: string };
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {back ? (
          <Link
            to={back.to}
            className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-ink-3 transition-colors hover:text-brand"
          >
            <Icons.ChevronLeft size={14} strokeWidth={ICON_STROKE} />
            {back.label}
          </Link>
        ) : null}
        <h1 className="truncate text-xl font-bold tracking-tight text-ink">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-xs text-ink-3">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
