import type { Request } from 'express';
import { readRefreshCookie, refreshCookieOptions, REFRESH_COOKIE } from './refresh-cookie';

describe('refresh cookie', () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; });

  it('is httpOnly, Lax and limited to the refresh path', () => {
    expect(refreshCookieOptions()).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      path: '/api/auth/refresh',
    });
  });

  it('is Secure in production and over https, but not on local http', () => {
    process.env.NODE_ENV = 'production';
    process.env.FRONTEND_URL = 'http://localhost:3000';
    expect(refreshCookieOptions().secure).toBe(true);

    process.env.NODE_ENV = 'development';
    expect(refreshCookieOptions().secure).toBe(false);

    process.env.FRONTEND_URL = 'https://example.com';
    expect(refreshCookieOptions().secure).toBe(true);
  });

  it('finds its value among other cookies', () => {
    const req = (cookie?: string) => ({ headers: { cookie } }) as Request;
    expect(readRefreshCookie(req(`a=1; ${REFRESH_COOKIE}=abc; b=2`))).toBe('abc');
    expect(readRefreshCookie(req('a=1'))).toBeNull();
    expect(readRefreshCookie(req())).toBeNull();
  });
});
