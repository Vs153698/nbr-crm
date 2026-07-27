import type { PermissionCode } from '@nbr/shared';
import { lazy, Suspense, type ReactNode } from 'react';
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

          <Route
            path="/dashboard"
            element={
              <RequirePermission permission="dashboard:view">
                <Suspense fallback={<RouteFallback />}>
                  <DashboardPage />
                </Suspense>
              </RequirePermission>
            }
          />

          <Route
            path="/applicants"
            element={
              <RequirePermission permission="applicants:view">
                <Suspense fallback={<RouteFallback />}>
                  <ApplicantListPage />
                </Suspense>
              </RequirePermission>
            }
          />

          <Route
            path="/applicants/new"
            element={
              <RequirePermission permission="applicants:create">
                <Suspense fallback={<RouteFallback />}>
                  <ApplicantFormPage />
                </Suspense>
              </RequirePermission>
            }
          />

          <Route
            path="/applicants/:id"
            element={
              <RequirePermission permission="applicants:view">
                <Suspense fallback={<RouteFallback />}>
                  <ApplicantProfilePage />
                </Suspense>
              </RequirePermission>
            }
          />

          <Route
            path="/admin/users"
            element={
              <RequirePermission permission="users:view">
                <Suspense fallback={<RouteFallback />}>
                  <UsersRolesPage />
                </Suspense>
              </RequirePermission>
            }
          />
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
