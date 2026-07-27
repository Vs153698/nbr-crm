import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api-client';

/**
 * TanStack Query configuration (§5 "stale-while-revalidate client caching").
 *
 * `staleTime: 30s` is what makes returning to a profile feel instant: the
 * cached copy renders immediately while a background refetch confirms it.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: (failureCount, error) => {
        // Retrying a 4xx just repeats the same rejection. Only transient
        // server and network failures are worth a second attempt.
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
        return failureCount < 2;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    },
    mutations: {
      // A mutation that failed did something (or didn't) — replaying it blindly
      // could double-record a payment. The user retries deliberately instead.
      retry: false,
    },
  },
});

/**
 * Query keys in one place.
 *
 * Centralised so an invalidation after a mutation can never miss a key through
 * a typo — `queryKeys.applicant(id)` is the same array everywhere.
 */
export const queryKeys = {
  session: ['session'] as const,
  dashboard: ['dashboard'] as const,
  applicantList: (params: Record<string, unknown>) => ['applicants', 'list', params] as const,
  applicant: (id: string) => ['applicants', id] as const,
  applicantTimeline: (id: string) => ['applicants', id, 'timeline'] as const,
  recordActions: (id: string) => ['records', id, 'actions'] as const,
  recordTimeline: (id: string) => ['records', id, 'timeline'] as const,
  evidence: (recordId: string) => ['evidence', recordId] as const,
  attachments: (applicantId: string) => ['attachments', applicantId] as const,
  notes: (applicantId: string, recordId?: string) => ['notes', applicantId, recordId ?? 'all'] as const,
  search: (query: string) => ['search', query] as const,
  users: ['users'] as const,
  roles: ['roles'] as const,
  permissionCatalogue: ['roles', 'catalogue'] as const,
  categories: ['categories'] as const,
} as const;
