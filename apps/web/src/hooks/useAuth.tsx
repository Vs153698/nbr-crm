import type { PermissionCode, SessionUser } from '@nbr/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError, setSessionExpiredHandler } from '@/lib/api-client';

interface AuthContextValue {
  user: SessionUser | null;
  status: 'loading' | 'authenticated' | 'anonymous';
  /** True when the caller holds the permission, or is Super Admin. */
  can: (permission: PermissionCode) => boolean;
  canAny: (...permissions: PermissionCode[]) => boolean;
  login: (identifier: string, password: string, rememberMe: boolean) => Promise<SessionUser>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Session state for the whole app.
 *
 * The permission set drives which menu items, buttons and tabs render — but it
 * is only ever a *convenience*. Every one of those actions is independently
 * enforced server-side, so a user who edits their own permission list in devtools
 * gains nothing but a button that returns 403.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [status, setStatus] = useState<'loading' | 'authenticated' | 'anonymous'>('loading');
  const queryClient = useQueryClient();

  const loadSession = useCallback(async () => {
    try {
      const session = await api.get<SessionUser>('/auth/me');
      setUser(session);
      setStatus('authenticated');
    } catch {
      setUser(null);
      setStatus('anonymous');
    }
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  // When the API client gives up on refreshing, drop straight to anonymous so
  // the router sends the user to /login instead of rendering a broken shell.
  useEffect(() => {
    setSessionExpiredHandler(() => {
      setUser(null);
      setStatus('anonymous');
      queryClient.clear();
    });
  }, [queryClient]);

  const login = useCallback(
    async (identifier: string, password: string, rememberMe: boolean) => {
      const result = await api.post<{ user: SessionUser }>('/auth/login', {
        identifier,
        password,
        rememberMe,
      });
      setUser(result.user);
      setStatus('authenticated');
      return result.user;
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch (error: unknown) {
      // A failed logout call still ends the session locally — leaving the user
      // apparently signed in because the network hiccuped would be worse.
      if (!(error instanceof ApiError)) throw error;
    } finally {
      setUser(null);
      setStatus('anonymous');
      // Personal data must not survive in the cache for the next person at
      // this machine.
      queryClient.clear();
    }
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(() => {
    const permissions = new Set(user?.permissions ?? []);
    const isSuperAdmin = user?.role.isSuperAdmin ?? false;

    return {
      user,
      status,
      can: (permission) => isSuperAdmin || permissions.has(permission),
      canAny: (...list) => isSuperAdmin || list.some((p) => permissions.has(p)),
      login,
      logout,
      refreshUser: loadSession,
    };
  }, [user, status, login, logout, loadSession]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}

/** Convenience for conditional rendering: `const canEdit = usePermission('applicants:edit')`. */
export function usePermission(permission: PermissionCode): boolean {
  return useAuth().can(permission);
}
