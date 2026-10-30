type Api = typeof import('./api');

const json = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('api session handling', () => {
  let store: Map<string, string>;
  let assign: jest.Mock;
  let fetchMock: jest.Mock;
  let refreshCalls: () => number;
  let client: Api;

  // Answers by route; a request with an old token gets 401 from any data route
  function backend(opts: { refresh: () => Response; validToken?: string }) {
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.endsWith('/auth/refresh')) return opts.refresh();
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === `Bearer ${opts.validToken ?? 'fresh'}` ? json(200, { ok: true }) : json(401);
    });
  }

  beforeEach(() => {
    jest.resetModules();
    store = new Map([['tt_token', 'stale']]);
    assign = jest.fn();
    fetchMock = jest.fn();
    refreshCalls = () => fetchMock.mock.calls.filter(([url]) => url.endsWith('/auth/refresh')).length;

    Object.assign(globalThis, {
      fetch: fetchMock,
      window: { location: { pathname: '/deals', search: '?tab=1', assign } },
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, v),
        removeItem: (k: string) => store.delete(k),
      },
    });
    client = require('./api');
  });

  it('refreshes on a 401 and retries the request with the new token', async () => {
    backend({ refresh: () => json(200, { access_token: 'fresh' }) });

    await expect(client.api.get('/deals')).resolves.toEqual({ ok: true });

    expect(store.get('tt_token')).toBe('fresh');
    expect(refreshCalls()).toBe(1);
    expect(assign).not.toHaveBeenCalled();
  });

  it('sends the refresh with the cookie', async () => {
    backend({ refresh: () => json(200, { access_token: 'fresh' }) });
    await client.api.get('/deals');

    const [, init] = fetchMock.mock.calls.find(([url]) => url.endsWith('/auth/refresh'));
    expect(init).toMatchObject({ method: 'POST', credentials: 'include' });
  });

  it('runs a single refresh for parallel requests', async () => {
    backend({ refresh: () => json(200, { access_token: 'fresh' }) });

    await Promise.all([client.api.get('/a'), client.api.get('/b'), client.api.get('/c')]);

    expect(refreshCalls()).toBe(1);
  });

  it('redirects to /login with the message and return path when the refresh fails', async () => {
    backend({ refresh: () => json(401) });

    await expect(client.api.get('/deals')).rejects.toMatchObject({ status: 401 });

    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('/login?reason=expired&next=%2Fdeals%3Ftab%3D1');
    expect(store.has('tt_token')).toBe(false);
  });

  it('redirects once for parallel requests when the refresh fails', async () => {
    backend({ refresh: () => json(401) });

    await Promise.allSettled([client.api.get('/a'), client.api.get('/b')]);

    expect(refreshCalls()).toBe(1);
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it('gives up after one retry when the new token gets a 401 too', async () => {
    backend({ refresh: () => json(200, { access_token: 'also-rejected' }) });

    await expect(client.api.get('/deals')).rejects.toMatchObject({ status: 401 });

    expect(refreshCalls()).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it('treats a network failure of the refresh as a failed refresh', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/auth/refresh')) throw new TypeError('network');
      return json(401);
    });

    await expect(client.api.get('/deals')).rejects.toMatchObject({ status: 401 });

    expect(assign).toHaveBeenCalledTimes(1);
  });

  it('uses the token another tab renewed instead of refreshing again', async () => {
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>).Authorization;
      if (auth === 'Bearer stale') {
        store.set('tt_token', 'from-other-tab');
        return json(401);
      }
      return json(200, { ok: true });
    });

    await expect(client.api.get('/deals')).resolves.toEqual({ ok: true });

    expect(refreshCalls()).toBe(0);
  });

  it('does not refresh when the login itself is rejected', async () => {
    fetchMock.mockResolvedValue(json(401, { message: 'Invalid credentials' }));

    await expect(client.api.post('/auth/login', {})).rejects.toThrow('Invalid credentials');

    expect(refreshCalls()).toBe(0);
    expect(assign).not.toHaveBeenCalled();
  });

  it('clears a dead session on a public page without redirecting', async () => {
    (globalThis as unknown as { window: { location: { pathname: string } } }).window.location.pathname = '/login';
    backend({ refresh: () => json(401) });

    await expect(client.api.get('/auth/me')).rejects.toMatchObject({ status: 401 });

    expect(store.has('tt_token')).toBe(false);
    expect(assign).not.toHaveBeenCalled();
  });

  it('shows no expiry message to someone who was never signed in', async () => {
    store.clear();
    backend({ refresh: () => json(401) });

    await expect(client.api.get('/deals')).rejects.toMatchObject({ status: 401 });

    expect(assign).toHaveBeenCalledWith('/login?next=%2Fdeals%3Ftab%3D1');
  });

  it('accepts only paths of this site as the return target', () => {
    expect(client.safeNext('/deals?tab=1')).toBe('/deals?tab=1');
    expect(client.safeNext(null)).toBe('/catalogue');
    expect(client.safeNext('https://evil.example')).toBe('/catalogue');
    expect(client.safeNext('//evil.example')).toBe('/catalogue');
    expect(client.safeNext('/\\evil.example')).toBe('/catalogue');
  });
});
