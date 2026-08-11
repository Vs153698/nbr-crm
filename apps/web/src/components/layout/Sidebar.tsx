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
}

const PRIMARY_NAV: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: Icons.LayoutDashboard, permission: 'dashboard:view' },
  { to: '/applicants', label: 'Applicants', icon: Icons.Users, permission: 'applicants:view' },
  // Sits beside Applicants rather than inside it: these holders have no
  // application, and none of the pipeline's work applies to them.
  {
    to: '/imported-records',
    label: 'Imported Records',
    icon: Icons.BookOpen,
    permission: 'integrations:view',
  },
];

/**
 * One list per pipeline stage, in the order a record passes through them.
 *
 * New Applications → Verification → Approval Pending → Selection Sent →
 * Fees & Payments → Certificates → Dispatch → Publications.
 *
 * Every stage gets its own screen deliberately. The nav is how staff find the
 * work that is theirs, and a stage with no list is a stage whose backlog nobody
 * sees — New Applications and Selection Sent were both missing, which are the
 * two most likely to accumulate quietly: one is the front door, and the other
 * looks finished because the record has been approved while the letter and the
 * invoice are still outstanding.
 *
 * The nav reading as the process, rather than as an alphabetised list of
 * screens, is the point.
 */
const PIPELINE_NAV: NavItem[] = [
  { to: '/new-applications', label: 'New Applications', icon: Icons.FilePlus2, permission: 'verification:view' },
  { to: '/verification', label: 'Verification', icon: Icons.ShieldCheck, permission: 'verification:view' },
  { to: '/approvals', label: 'Approval Pending', icon: Icons.ClipboardCheck, permission: 'verification:view' },
  { to: '/selection-sent', label: 'Selection Sent', icon: Icons.MailCheck, permission: 'communications:view' },
  { to: '/payments', label: 'Fees & Payments', icon: Icons.IndianRupee, permission: 'payments:view' },
  { to: '/certificates', label: 'Certificates', icon: Icons.Award, permission: 'certificates:view' },
  { to: '/dispatch', label: 'Dispatch', icon: Icons.Truck, permission: 'dispatch:view' },
  { to: '/publications', label: 'Publications', icon: Icons.Newspaper, permission: 'publications:view' },
];

const SALES_NAV: NavItem[] = [
  { to: '/sales', label: 'Sales Dashboard', icon: Icons.TrendingUp, permission: 'leads:view' },
  { to: '/leads', label: 'Leads', icon: Icons.PhoneCall, permission: 'leads:view' },
];

const WORK_NAV: NavItem[] = [
  { to: '/tasks', label: 'Tasks & Follow-ups', icon: Icons.ClipboardCheck, permission: 'tasks:view' },
  { to: '/blacklist', label: 'Blacklist', icon: Icons.Ban, permission: 'blacklist:view' },
  { to: '/reports', label: 'Reports', icon: Icons.TrendingUp, permission: 'reports:view' },
];

const ADMIN_NAV: NavItem[] = [
  { to: '/employees', label: 'Employees', icon: Icons.Users, permission: 'employees:view' },
  { to: '/admin/users', label: 'Users & Roles', icon: Icons.Shield, permission: 'users:view' },
  { to: '/admin/templates', label: 'Templates', icon: Icons.Mail, permission: 'templates:view' },
  { to: '/admin/settings', label: 'Settings', icon: Icons.Settings, permission: 'settings:view' },
  { to: '/admin/audit', label: 'Audit Logs', icon: Icons.FileText, permission: 'audit:view' },
];

/**
 * One navigation group.
 *
 * The whole group disappears when the role can see none of its items, rather
 * than leaving a heading over empty space — a Finance user should not be shown
 * that an "Administration" section exists.
 */
function NavSection({
  title,
  items,
  onNavigate,
}: {
  title?: string;
  items: NavItem[];
  onNavigate?: () => void;
}) {
  const { can } = useAuth();
  const visible = items.filter((item) => !item.permission || can(item.permission));

  if (visible.length === 0) return null;

  return (
    <div className="mb-1 px-3 py-2">
      {title ? (
        <p className="mb-1.5 px-2.5 text-[10px] font-bold uppercase tracking-[0.15em] text-nbr-text-4">
          {title}
        </p>
      ) : null}

      <ul className="space-y-0.5">
        {visible.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'group relative flex items-center gap-2.5 rounded-lg py-2 pl-3 pr-2.5',
                  'text-[13px] transition-colors duration-150',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-nbr-orange-ring',
                  isActive
                    ? 'bg-nbr-orange/10 font-semibold text-white'
                    : 'text-nbr-text-2 hover:bg-white/[0.055] hover:text-white',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {/* Active marker. A filled bar reads at a glance from the
                      corner of the eye; a background tint alone does not. */}
                  <span
                    aria-hidden
                    className={cn(
                      'absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full transition-colors',
                      isActive ? 'bg-nbr-orange' : 'bg-transparent',
                    )}
                  />
                  <item.icon
                    size={ICON_SIZE.md}
                    strokeWidth={isActive ? 2.3 : ICON_STROKE}
                    className={cn(
                      'shrink-0 transition-colors',
                      isActive ? 'text-nbr-orange' : 'text-nbr-text-3 group-hover:text-nbr-text-2',
                    )}
                  />
                  <span className="truncate">{item.label}</span>
                </>
              )}
            </NavLink>
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
      className="flex h-full w-[248px] shrink-0 flex-col border-r border-nbr-line bg-nbr-bg text-white"
    >
      {/* Brand */}
      <div className="flex shrink-0 items-center gap-2.5 border-b border-nbr-line px-4 py-3.5">
        <img
          src="/nbr-logo.png"
          alt=""
          width={34}
          height={34}
          className="h-[34px] w-[34px] shrink-0"
        />
        <div className="min-w-0">
          <p className="truncate text-[11px] font-bold uppercase leading-tight tracking-[0.11em] text-white">
            National Book
            <br />
            of Records
          </p>
        </div>
      </div>

      <div className="scrollbar-slim flex-1 overflow-y-auto py-2">
        <NavSection items={PRIMARY_NAV} onNavigate={onNavigate} />
        <SectionRule />
        <NavSection title="Pipeline" items={PIPELINE_NAV} onNavigate={onNavigate} />
        <NavSection title="Sales" items={SALES_NAV} onNavigate={onNavigate} />
        <SectionRule />
        <NavSection title="Workspace" items={WORK_NAV} onNavigate={onNavigate} />
        <SectionRule />
        <NavSection title="Administration" items={ADMIN_NAV} onNavigate={onNavigate} />
      </div>

      <div className="shrink-0 border-t border-nbr-line px-4 py-3">
        <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-nbr-text-4">
          <Icons.Lock size={11} strokeWidth={ICON_STROKE} className="mt-px shrink-0" />
          Internal system. All activity is logged.
        </p>
      </div>
    </nav>
  );
}

/** Hairline between groups. Inset so it reads as a divider, not a page edge. */
function SectionRule() {
  return <div aria-hidden className="mx-5 h-px bg-nbr-line" />;
}
