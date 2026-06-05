import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ServerNotConfiguredError, type ApiError } from './api';

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
