import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, onCredentialRefused, ServerNotConfiguredError, setReviewFloor, withNetworkRetry, type ApiError } from './api';

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('api request', () => {
  it('returns parsed JSON on success', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { ok: true }));
    await expect(api.post('/api/auth', { action: 'login' })).resolves.toEqual({ ok: true });
  });

  it('maps a 503 to ServerNotConfiguredError', async () => {
    vi.stubGlobal('fetch', mockFetch(503, { error: 'server_not_configured', message: 'no db' }));
    await expect(api.get('/api/shows')).rejects.toBeInstanceOf(ServerNotConfiguredError);
  });

  it('throws an ApiError carrying the status and code on other failures', async () => {
    vi.stubGlobal('fetch', mockFetch(409, { error: 'account_exists' }));
    await expect(api.post('/api/auth', {})).rejects.toMatchObject({
      status: 409,
      code: 'account_exists',
    } satisfies Partial<ApiError>);
  });

  it('sends auth headers when provided', async () => {
    const fetchMock = mockFetch(200, { shows: [] });
    vi.stubGlobal('fetch', fetchMock);
    await api.get('/api/shows', { authUserId: 'u1', authHash: 'h1' });
    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>)['x-user-id']).toBe('u1');
    expect((init.headers as Record<string, string>)['x-auth']).toBe('h1');
  });
});

describe('a refused credential', () => {
  afterEach(() => onCredentialRefused(null));

  // A session whose account moved to the new credential somewhere else is
  // refused on every route. The app has to hear that once, with the
  // credential that was refused, rather than retry saves that cannot land.
  it('is reported with the credential the request carried, and still throws', async () => {
    const refused = vi.fn();
    onCredentialRefused(refused);
    vi.stubGlobal('fetch', mockFetch(401, { error: 'unauthorized' }));
    await expect(api.put('/api/shows', { changes: [] }, { authUserId: 'u1', authHash: 'old' }))
      .rejects.toMatchObject({ status: 401 });
    expect(refused).toHaveBeenCalledExactlyOnceWith('old');
  });

  it('is not reported for a request that carried no credential, or for another failure', async () => {
    const refused = vi.fn();
    onCredentialRefused(refused);
    vi.stubGlobal('fetch', mockFetch(401, { error: 'unauthorized' }));
    await expect(api.get('/api/live')).rejects.toMatchObject({ status: 401 });
    vi.stubGlobal('fetch', mockFetch(409, { error: 'save_conflict' }));
    await expect(api.put('/api/shows', {}, { authUserId: 'u1', authHash: 'h1' })).rejects.toMatchObject({ status: 409 });
    expect(refused).not.toHaveBeenCalled();
  });
});

describe('a co-producer link’s bearer token', () => {
  afterEach(() => onCredentialRefused(null));

  it('is sent as Authorization, and its 401 is not the account’s credential refused', async () => {
    const refused = vi.fn();
    onCredentialRefused(refused);
    const fetchMock = mockFetch(401, { error: 'unauthorized' });
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.get('/api/coproducer?route=session', { bearer: 'tok', authHash: 'h' })).rejects.toMatchObject({ status: 401 });
    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(refused).not.toHaveBeenCalled();
  });

  it('carries a refusal’s reason', async () => {
    vi.stubGlobal('fetch', mockFetch(413, { error: 'coproducer_storage_full', reason: 'account_full' }));
    await expect(api.post('/api/coproducer?route=requests', {}, { bearer: 'tok' })).rejects.toMatchObject({
      status: 413, code: 'coproducer_storage_full', reason: 'account_full',
    });
  });
});

describe('the co-producer floor', () => {
  afterEach(() => {
    setReviewFloor(false);
    vi.unstubAllGlobals();
  });

  it('refuses every write but the co-producer route on this origin, before fetch', async () => {
    vi.stubGlobal('location', { origin: 'https://showrunner-theta.vercel.app' });
    const fetchMock = mockFetch(200, { ok: true });
    vi.stubGlobal('fetch', fetchMock);
    setReviewFloor(true);
    for (const method of ['put', 'post', 'patch'] as const) {
      for (const path of ['/api/shows', '/api/coproducerX', '/api/coproducer/../shows', 'https://elsewhere.example/api/coproducer']) {
        await expect(api[method](path, {})).rejects.toMatchObject({ status: 0, code: 'review_mode' });
      }
    }
    await expect(api.del('/api/media?id=x')).rejects.toMatchObject({ code: 'review_mode' });
    expect(fetchMock).not.toHaveBeenCalled();
    await api.get('/api/shows');
    await api.post('/api/coproducer?route=requests', {});
    await api.del('/api/coproducer?route=requests&id=r');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('is not retried', async () => {
    vi.stubGlobal('location', { origin: 'https://showrunner-theta.vercel.app' });
    vi.stubGlobal('fetch', mockFetch(200, {}));
    setReviewFloor(true);
    const attempt = vi.fn(() => api.put('/api/media', {}));
    await expect(withNetworkRetry(attempt)).rejects.toMatchObject({ code: 'review_mode' });
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('is off in the owner’s app', async () => {
    const fetchMock = mockFetch(200, { ok: true });
    vi.stubGlobal('fetch', fetchMock);
    await api.put('/api/shows', {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
