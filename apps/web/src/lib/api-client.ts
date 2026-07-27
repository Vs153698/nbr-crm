import type { ApiResponse } from '@nbr/shared';

const API_BASE = '/api/v1';
const CSRF_COOKIE = 'nbr_csrf';
const CSRF_HEADER = 'x-csrf-token';

/**
 * Typed error carrying the server's machine-readable code.
 * Screens branch on `code`, never on the message — messages get reworded,
 * codes are a contract.
 */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly fields?: Record<string, string[]>,
    readonly meta?: Record<string, unknown>,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Field errors in the shape react-hook-form's `setError` expects. */
  get fieldErrors(): Array<{ name: string; message: string }> {
    if (!this.fields) return [];
    return Object.entries(this.fields).map(([name, messages]) => ({
      name,
      message: messages[0] ?? 'Invalid value',
    }));
  }
}

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

/**
 * Single-flight refresh.
 *
 * When an access token expires, several queries usually 401 at the same
 * moment. Without this, each would fire its own refresh, and because refresh
 * tokens rotate, the second one would present an already-rotated token — which
 * the server correctly treats as theft and responds to by killing the whole
 * session. One shared promise means exactly one refresh.
 */
let refreshPromise: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  refreshPromise ??= (async () => {
    try {
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: buildCsrfHeaders(),
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      // Cleared on the next tick so concurrent callers all observe the same
      // in-flight promise rather than starting a second refresh.
      queueMicrotask(() => {
        refreshPromise = null;
      });
    }
  })();

  return refreshPromise;
}

function buildCsrfHeaders(): Record<string, string> {
  const token = readCookie(CSRF_COOKIE);
  return token ? { [CSRF_HEADER]: token } : {};
}

/** Notified when the session is definitively gone, so the app can redirect. */
type SessionExpiredHandler = () => void;
let onSessionExpired: SessionExpiredHandler = () => undefined;

export function setSessionExpiredHandler(handler: SessionExpiredHandler): void {
  onSessionExpired = handler;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Serialised with repeated keys for arrays: `?status=a&status=b`. */
  query?: Record<string, unknown>;
  signal?: AbortSignal;
  /** Internal: prevents an infinite refresh→retry→refresh loop. */
  _isRetry?: boolean;
}

function buildQueryString(query: Record<string, unknown> | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;

    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null && item !== '') params.append(key, String(item));
      }
    } else if (value instanceof Date) {
      params.append(key, value.toISOString());
    } else {
      params.append(key, String(value));
    }
  }

  const serialised = params.toString();
  return serialised ? `?${serialised}` : '';
}

/**
 * The one place the app talks to the API.
 *
 * Handles the envelope, CSRF header, cookie credentials, and transparent token
 * refresh. Callers get unwrapped data or a typed `ApiError` — they never see
 * `{ success, data, error }`.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, signal, _isRetry = false } = options;

  const headers: Record<string, string> = { ...buildCsrfHeaders() };
  if (body !== undefined) headers['content-type'] = 'application/json';

  const response = await fetch(`${API_BASE}${path}${buildQueryString(query)}`, {
    method,
    headers,
    // Auth is an HttpOnly cookie; it must be sent, and the dev server proxies
    // /api so this stays same-origin in every environment.
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });

  // 401 on a non-auth route means the short-lived access token lapsed. Refresh
  // once and replay; if that fails, the session is genuinely over.
  if (response.status === 401 && !_isRetry && !path.startsWith('/auth/')) {
    const refreshed = await refreshSession();
    if (refreshed) {
      return request<T>(path, { ...options, _isRetry: true });
    }
    onSessionExpired();
  }

  let payload: ApiResponse<T>;
  try {
    payload = (await response.json()) as ApiResponse<T>;
  } catch {
    throw new ApiError(
      'NETWORK_ERROR',
      response.ok
        ? 'The server returned an unreadable response.'
        : `Request failed (${response.status}).`,
      response.status,
    );
  }

  if (!response.ok || !payload.success) {
    const error = payload.error;
    throw new ApiError(
      error?.code ?? 'UNKNOWN',
      error?.message ?? 'Something went wrong.',
      response.status,
      error?.fields,
      payload.meta as Record<string, unknown> | undefined,
      error?.requestId,
    );
  }

  return payload.data as T;
}

/** Like `request`, but also returns the envelope's `meta` (cursors, totals). */
export async function requestWithMeta<T>(
  path: string,
  options: RequestOptions = {},
): Promise<{ data: T; meta: Record<string, unknown> }> {
  const { method = 'GET', body, query, signal, _isRetry = false } = options;

  const headers: Record<string, string> = { ...buildCsrfHeaders() };
  if (body !== undefined) headers['content-type'] = 'application/json';

  const response = await fetch(`${API_BASE}${path}${buildQueryString(query)}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });

  if (response.status === 401 && !_isRetry && !path.startsWith('/auth/')) {
    const refreshed = await refreshSession();
    if (refreshed) return requestWithMeta<T>(path, { ...options, _isRetry: true });
    onSessionExpired();
  }

  const payload = (await response.json()) as ApiResponse<T>;

  if (!response.ok || !payload.success) {
    throw new ApiError(
      payload.error?.code ?? 'UNKNOWN',
      payload.error?.message ?? 'Something went wrong.',
      response.status,
      payload.error?.fields,
      payload.meta as Record<string, unknown> | undefined,
      payload.error?.requestId,
    );
  }

  return { data: payload.data as T, meta: (payload.meta ?? {}) as Record<string, unknown> };
}

export const api = {
  get: <T>(path: string, query?: Record<string, unknown>, signal?: AbortSignal) =>
    request<T>(path, { method: 'GET', query, signal }),

  getWithMeta: <T>(path: string, query?: Record<string, unknown>, signal?: AbortSignal) =>
    requestWithMeta<T>(path, { method: 'GET', query, signal }),

  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),

  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),

  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/**
 * Upload a file straight to object storage using a presigned URL.
 *
 * The bytes bypass the API entirely (§7) — a 200 MB record video would
 * otherwise occupy an app worker for the whole transfer.
 */
export async function uploadToStorage(
  uploadUrl: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    // XMLHttpRequest rather than fetch: fetch still has no upload progress
    // events, and a multi-minute video upload with no progress bar is unusable.
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl, true);
    xhr.setRequestHeader('content-type', file.type);

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new ApiError('UPLOAD_FAILED', `Upload failed (${xhr.status}).`, xhr.status));
    });

    xhr.addEventListener('error', () =>
      reject(new ApiError('UPLOAD_FAILED', 'Upload failed. Check your connection.', 0)),
    );
    xhr.addEventListener('abort', () =>
      reject(new ApiError('UPLOAD_ABORTED', 'Upload cancelled.', 0)),
    );

    xhr.send(file);
  });
}

/** SHA-256 of a file, so a re-upload of identical bytes is idempotent. */
export async function hashFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
