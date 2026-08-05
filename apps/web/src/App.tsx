import type { PermissionCode } from '@nbr/shared';
import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { EmptyState } from '@/components/ui/Card';
import { useAuth } from '@/hooks/useAuth';
import { Icons } from '@/lib/icons';

// Route-level code splitting keeps the initial bundle inside the plan's
// < 150 KB budget — the login screen must not ship the dashboard's charts.
const LoginPage = lazy(() => import('@/routes/auth/LoginPage'));
const ForgotPasswordPage = lazy(() => import('@/routes/auth/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('@/routes/auth/ResetPasswordPage'));
const ChangePasswordPage = lazy(() => import('@/routes/auth/ChangePasswordPage'));
const DashboardPage = lazy(() => import('@/routes/dashboard/DashboardPage'));
const ApplicantListPage = lazy(() => import('@/routes/applicants/ApplicantListPage'));
const ApplicantFormPage = lazy(() => import('@/routes/applicants/ApplicantFormPage'));
const ApplicantProfilePage = lazy(() => import('@/routes/applicants/ApplicantProfilePage'));
const UsersRolesPage = lazy(() => import('@/routes/admin/UsersRolesPage'));
const TasksBoardPage = lazy(() => import('@/routes/modules/TasksBoardPage'));
const ReportsPage = lazy(() => import('@/routes/modules/ReportsPage'));
const SalesDashboardPage = lazy(() => import('@/routes/sales/SalesDashboardPage'));
const LeadsPage = lazy(() => import('@/routes/sales/LeadsPage'));
const EmployeesPage = lazy(() => import('@/routes/sales/EmployeesPage'));

// The five queues share one module chunk — they are the same component with
// different props, so splitting them further would only add round-trips.
const queues = () => import('@/routes/modules/QueuePage');
const VerificationQueuePage = lazy(async () => ({ default: (await queues()).VerificationQueuePage }));
const PaymentsQueuePage = lazy(async () => ({ default: (await queues()).PaymentsQueuePage }));
const CertificatesQueuePage = lazy(async () => ({ default: (await queues()).CertificatesQueuePage }));
const PublicationsQueuePage = lazy(async () => ({ default: (await queues()).PublicationsQueuePage }));
const DispatchQueuePage = lazy(async () => ({ default: (await queues()).DispatchQueuePage }));

const admin = () => import('@/routes/modules/AdminPages');
const BlacklistPage = lazy(async () => ({ default: (await admin()).BlacklistPage }));
const TemplatesPage = lazy(async () => ({ default: (await admin()).TemplatesPage }));
const SettingsPage = lazy(async () => ({ default: (await admin()).SettingsPage }));
const AuditLogPage = lazy(async () => ({ default: (await admin()).AuditLogPage }));

function FullPageSpinner() {
  return (
    <div className="grid h-screen place-items-center bg-canvas">
      <Icons.Loader2 size={26} className="animate-spin text-brand" />
    </div>
  );
}

function RouteFallback() {
  return (
    <div className="grid min-h-[50vh] place-items-center">
      <Icons.Loader2 size={22} className="animate-spin text-brand" />
    </div>
  );
}

/**
 * Gate for authenticated routes.
 *
 * Also enforces the forced password change: a user carrying
 * `mustChangePassword` is redirected to the change screen from anywhere,
 * mirroring the API guard that blocks every other endpoint for them. Without
 * the client half, they would land on a dashboard where every request 403s.
 */
function RequireAuth({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <FullPageSpinner />;

  if (status === 'anonymous') {
    // Remember where they were headed so login can send them back.
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  if (user?.mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }

  return <>{children}</>;
}

/** Renders children only when the permission is held; otherwise explains why. */
function RequirePermission({
  permission,
  children,
}: {
  permission: PermissionCode;
  children: ReactNode;
}) {
  const { can } = useAuth();

  if (!can(permission)) {
    return (
      <div className="p-6">
        <EmptyState
          icon={Icons.Lock}
          title="You don't have access to this screen"
          description="Ask an administrator to grant your role the required permission."
        />
      </div>
    );
  }

  return <>{children}</>;
}

/**
 * Wraps a lazily-loaded screen in its permission gate and suspense boundary.
 *
 * Every authenticated route needs exactly this pair, and there are eighteen of
 * them — spelling it out per route made it easy to ship one without a gate.
 */
function guarded(permission: PermissionCode, Screen: ComponentType) {
  return (
    <RequirePermission permission={permission}>
      <Suspense fallback={<RouteFallback />}>
        <Screen />
      </Suspense>
    </RequirePermission>
  );
}

/** Sends an already-signed-in user away from the login screen. */
function RedirectIfAuthenticated({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();

  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'authenticated') {
    return <Navigate to={user?.mustChangePassword ? '/change-password' : '/dashboard'} replace />;
  }
  return <>{children}</>;
}

export function App() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <Routes>
        {/* Public */}
        <Route
          path="/login"
          element={
            <RedirectIfAuthenticated>
              <LoginPage />
            </RedirectIfAuthenticated>
          }
        />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />

        {/* Change password lives outside the shell — a user who must rotate
            their password has no working navigation yet. */}
        <Route
          path="/change-password"
          element={
            <RequireAuth>
              <ChangePasswordPage />
            </RequireAuth>
          }
        />

        {/* Authenticated app */}
        <Route
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route path="/" element={<Navigate to="/dashboard" replace />} />

          <Route path="/dashboard" element={guarded('dashboard:view', DashboardPage)} />

          <Route path="/applicants" element={guarded('applicants:view', ApplicantListPage)} />
          <Route path="/applicants/new" element={guarded('applicants:create', ApplicantFormPage)} />
          <Route path="/applicants/:id" element={guarded('applicants:view', ApplicantProfilePage)} />

          {/* Operational queues (§7, §12, §16, §17, §18) */}
          <Route path="/verification" element={guarded('verification:view', VerificationQueuePage)} />
          <Route path="/payments" element={guarded('payments:view', PaymentsQueuePage)} />
          <Route path="/certificates" element={guarded('certificates:view', CertificatesQueuePage)} />
          <Route path="/publications" element={guarded('publications:view', PublicationsQueuePage)} />
          <Route path="/dispatch" element={guarded('dispatch:view', DispatchQueuePage)} />

          <Route path="/tasks" element={guarded('tasks:view', TasksBoardPage)} />
          <Route path="/blacklist" element={guarded('blacklist:view', BlacklistPage)} />
          <Route path="/reports" element={guarded('reports:view', ReportsPage)} />

          <Route path="/sales" element={guarded('leads:view', SalesDashboardPage)} />
          <Route path="/leads" element={guarded('leads:view', LeadsPage)} />
          <Route path="/employees" element={guarded('employees:view', EmployeesPage)} />

          <Route path="/admin/users" element={guarded('users:view', UsersRolesPage)} />
          <Route path="/admin/templates" element={guarded('templates:view', TemplatesPage)} />
          <Route path="/admin/settings" element={guarded('settings:view', SettingsPage)} />
          <Route path="/admin/audit" element={guarded('audit:view', AuditLogPage)} />
        </Route>

        <Route
          path="*"
          element={
            <div className="grid h-screen place-items-center bg-canvas">
              <EmptyState
                icon={Icons.Search}
                title="Page not found"
                description="The screen you're looking for doesn't exist."
              />
            </div>
          }
        />
      </Routes>
    </Suspense>
  );
}
