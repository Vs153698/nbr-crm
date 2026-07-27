import type { PermissionCode } from '@nbr/shared';
import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { ICON_SIZE, ICON_STROKE, Icons, type LucideIcon } from '@/lib/icons';
import { useAuth } from '@/hooks/useAuth';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Hidden unless the user holds this permission. */
  permission?: PermissionCode;
  /** Phase 2 surfaces are shown disabled so the shape of the product is
   *  visible without pretending the screens exist yet. */
  comingSoon?: boolean;
}

const PRIMARY_NAV: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: Icons.LayoutDashboard, permission: 'dashboard:view' },
  { to: '/applicants', label: 'Applicants', icon: Icons.Users, permission: 'applicants:view' },
  { to: '/verification', label: 'Verification', icon: Icons.ShieldCheck, permission: 'verification:view', comingSoon: true },
  { to: '/payments', label: 'Payments', icon: Icons.IndianRupee, permission: 'payments:view', comingSoon: true },
  { to: '/certificates', label: 'Certificates', icon: Icons.Award, permission: 'certificates:view', comingSoon: true },
  { to: '/publications', label: 'Publications', icon: Icons.Newspaper, permission: 'publications:view', comingSoon: true },
  { to: '/dispatch', label: 'Dispatch', icon: Icons.Truck, permission: 'dispatch:view', comingSoon: true },
  { to: '/tasks', label: 'Tasks & Follow-ups', icon: Icons.ClipboardCheck, permission: 'tasks:view', comingSoon: true },
  { to: '/blacklist', label: 'Blacklist', icon: Icons.Ban, permission: 'blacklist:view', comingSoon: true },
  { to: '/reports', label: 'Reports', icon: Icons.TrendingUp, permission: 'reports:view', comingSoon: true },
];

const ADMIN_NAV: NavItem[] = [
  { to: '/admin/users', label: 'Users & Roles', icon: Icons.Shield, permission: 'users:view' },
  { to: '/admin/settings', label: 'Settings', icon: Icons.Settings, permission: 'settings:view', comingSoon: true },
  { to: '/admin/audit', label: 'Audit Logs', icon: Icons.FileText, permission: 'audit:view', comingSoon: true },
];

function NavSection({ title, items, onNavigate }: { title?: string; items: NavItem[]; onNavigate?: () => void }) {
  const { can } = useAuth();
  const visible = items.filter((item) => !item.permission || can(item.permission));

  if (visible.length === 0) return null;

  return (
    <div className="mb-5">
      {title ? (
        <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">
          {title}
        </p>
      ) : null}

      <ul className="space-y-0.5">
        {visible.map((item) => (
          <li key={item.to}>
            {item.comingSoon ? (
              <span
                title="Phase 2 — not built yet"
                className="flex cursor-not-allowed items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-white/25"
              >
                <item.icon size={ICON_SIZE.md} strokeWidth={ICON_STROKE} className="shrink-0" />
                <span className="truncate">{item.label}</span>
                <span className="ml-auto rounded bg-white/8 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white/40">
                  Soon
                </span>
              </span>
            ) : (
              <NavLink
                to={item.to}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors duration-150',
                    isActive
                      ? 'bg-brand font-semibold text-white shadow-sm'
                      : 'text-white/70 hover:bg-white/8 hover:text-white',
                  )
                }
              >
                <item.icon size={ICON_SIZE.md} strokeWidth={ICON_STROKE} className="shrink-0" />
                <span className="truncate">{item.label}</span>
              </NavLink>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav
      aria-label="Main navigation"
      className="flex h-full w-[236px] shrink-0 flex-col bg-navy text-white"
    >
      <div className="flex items-center gap-2.5 px-4 py-4">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-[#F0C64E] to-gold text-lg font-bold text-navy shadow-[0_3px_12px_rgba(192,138,46,.4)]">
          ★
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs font-bold uppercase tracking-[0.12em]">National Book</p>
          <p className="truncate text-[10px] uppercase tracking-[0.14em] text-white/45">of Records</p>
        </div>
      </div>

      <div className="scrollbar-slim flex-1 overflow-y-auto px-2.5 py-2">
        <NavSection items={PRIMARY_NAV} onNavigate={onNavigate} />
        <NavSection title="Administration" items={ADMIN_NAV} onNavigate={onNavigate} />
      </div>

      <div className="border-t border-white/10 px-4 py-3">
        <p className="text-[10px] leading-relaxed text-white/35">
          Internal system. All activity is logged.
        </p>
      </div>
    </nav>
  );
}
