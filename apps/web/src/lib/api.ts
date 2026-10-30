const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

const TOKEN_KEY = 'tt_token';

// Their 401 means wrong credentials or a dead refresh token, not an expired access token
const NO_REFRESH_PATHS = ['/auth/login', '/auth/refresh'];
// Pages that work signed out: a dead session is cleared there without a redirect
const PUBLIC_PAGES = ['/login', '/register', '/forgot-password', '/reset-password'];

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

let refreshing: Promise<boolean> | null = null;
let redirecting = false;

// Tabs share the refresh cookie, and a token works only once: without the lock
// two tabs refreshing together would look like a stolen token and sign the user out.
async function withTabLock(fn: () => Promise<boolean>): Promise<boolean> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  return locks ? await locks.request('tt_refresh', fn) : fn();
}

function refreshSession(usedToken: string | null): Promise<boolean> {
  // Requests that fail together share one refresh
  refreshing ??= withTabLock(async () => {
    // Another tab or an earlier refresh may have renewed the token meanwhile
    const current = getToken();
    if (current && current !== usedToken) return true;

    const res = await fetch(`${API_BASE}/auth/refresh`, { method: 'POST', credentials: 'include' });
    if (!res.ok) return false;
    const { access_token } = (await res.json()) as { access_token: string };
    localStorage.setItem(TOKEN_KEY, access_token);
    return true;
  })
    .catch(() => false)
    .finally(() => { refreshing = null; });
  return refreshing;
}

function endSession(hadToken: boolean): void {
  localStorage.removeItem(TOKEN_KEY);
  const { pathname, search } = window.location;
  if (redirecting || PUBLIC_PAGES.includes(pathname)) return;
  redirecting = true;
  const reason = hadToken ? 'reason=expired&' : '';
  window.location.assign(`/login?${reason}next=${encodeURIComponent(pathname + search)}`);
}

// Where the login page goes next: only a path of this site, never an outside URL
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return '/catalogue';
  return next;
}

function send(path: string, init: RequestInit, token: string | null): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
}

// One refresh and one retry on a 401; if that fails too, the session is over
async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const res = await send(path, init, token);
  if (res.status !== 401 || NO_REFRESH_PATHS.includes(path) || path.startsWith('/auth/refresh/')) return res;

  if (await refreshSession(token)) {
    const retried = await send(path, init, getToken());
    if (retried.status !== 401) return retried;
  }
  endSession(token !== null);
  return res;
}

async function failure(res: Response): Promise<ApiError> {
  const body = await res.json().catch(() => ({}));
  const msg = Array.isArray(body?.message)
    ? body.message.join(', ')
    : body?.message ?? `HTTP ${res.status}`;
  return new ApiError(res.status, msg);
}

async function req<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await authedFetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });

  if (!res.ok) {
    if (res.status === 429) {
      const retryAfter = res.headers.get('Retry-After');
      const wait = retryAfter ? ` Try again in ${formatWait(retryAfter)}.` : ' Please try again shortly.';
      throw new ApiError(429, `Too many attempts.${wait}`);
    }
    throw await failure(res);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

function formatWait(retryAfterSeconds: string): string {
  const seconds = parseInt(retryAfterSeconds, 10);
  if (isNaN(seconds)) return 'a moment';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.ceil(seconds / 60);
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

export const api = {
  get: <T = unknown>(path: string) => req<T>(path),
  post: <T = unknown>(path: string, body?: unknown) =>
    req<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined }),
  patch: <T = unknown>(path: string, body: unknown) =>
    req<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T = unknown>(path: string) => req<T>(path, { method: 'DELETE' }),
  upload: async <T = unknown>(path: string, formData: FormData): Promise<T> => {
    const res = await authedFetch(path, { method: 'POST', body: formData });
    if (!res.ok) throw await failure(res);
    return res.json() as Promise<T>;
  },
  download: async (path: string, filename: string): Promise<void> => {
    const res = await authedFetch(path);
    if (!res.ok) throw await failure(res);
    const url = URL.createObjectURL(await res.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  },
};
