import type { CookieOptions, Request, Response } from 'express';

export const REFRESH_COOKIE = 'tt_refresh';
export const REFRESH_TOKEN_TTL_MS = 14 * 24 * 60 * 60_000; // 14 days

// The browser sends the cookie to this path and below it only: the refresh
// and logout endpoints, never to the rest of the API.
const REFRESH_COOKIE_PATH = '/api/auth/refresh';

// Read per call: main.ts loads the env file after this module is imported
export function refreshCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' || (process.env.FRONTEND_URL ?? '').startsWith('https:'),
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
  };
}

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, { ...refreshCookieOptions(), maxAge: REFRESH_TOKEN_TTL_MS });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
}

export function readRefreshCookie(req: Request): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq).trim() === REFRESH_COOKIE) {
      return part.slice(eq + 1).trim() || null;
    }
  }
  return null;
}
