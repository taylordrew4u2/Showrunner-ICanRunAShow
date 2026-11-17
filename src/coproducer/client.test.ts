import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCoproducerClient, onLinkEnded, reviewMediaSource } from './client';

const TOKEN = 'T'.repeat(43);

function answer(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => answer(200, {}));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  onLinkEnded(null);
  vi.unstubAllGlobals();
});

function call(i = 0): { url: string; method: string; headers: Record<string, string>; body: unknown } {
  const [url, init] = fetchMock.mock.calls[i] as [string, RequestInit];
  return {
    url,
    method: init.method ?? 'GET',
    headers: init.headers as Record<string, string>,
    body: init.body === undefined ? undefined : JSON.parse(init.body as string),
  };
}

describe('createCoproducerClient', () => {
  it('sends the link token as a bearer and never the owner’s headers', async () => {
    const client = createCoproducerClient(TOKEN);
    fetchMock.mockResolvedValueOnce(answer(200, { link: { id: 'l1', label: 'Sam', expiresAt: 'x' }, producerLocked: false }));
    await client.session();
    const sent = call();
    expect(sent.url).toBe('/api/coproducer?route=session');
    expect(sent.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(sent.headers['x-auth']).toBeUndefined();
    expect(sent.headers['x-user-id']).toBeUndefined();
  });

  it('builds every route', async () => {
    const client = createCoproducerClient(TOKEN);
    fetchMock.mockImplementation(async () => answer(200, { request: { id: 'r' }, requests: [], shows: [], next: null, unreadable: 0 }));
    await client.showsPage();
    await client.showsPage('a/b');
    await client.showsByIds(['s1', 's 2']);
    await client.revisions();
    await client.settings();
    await client.mediaChunk('abcd-1234', 2);
    await client.profilePhotoChunk('req1', 0);
    await client.stageChunk({ id: 'm1', seq: 0, total: 1, data: 'data:image/png;base64,AA' });
    await client.createRequest({ kind: 'download', payload: { kind: 'download', action: { type: 'backup' } }, mediaIds: [] });
    await client.listRequests();
    await client.getRequest('r1');
    await client.withdraw('r1');
    await client.markUsed('r1');
    const seen = fetchMock.mock.calls.map((_, i) => `${call(i).method} ${call(i).url}`);
    expect(seen).toEqual([
      'GET /api/coproducer?route=shows',
      'GET /api/coproducer?route=shows&after=a%2Fb',
      'GET /api/coproducer?route=shows&ids=s1,s%202',
      'GET /api/coproducer?route=revisions',
      'GET /api/coproducer?route=settings',
      'GET /api/coproducer?route=media&id=abcd-1234&seq=2',
      'GET /api/coproducer?route=profile-photo&request=req1&seq=0',
      'PUT /api/coproducer?route=stage',
      'POST /api/coproducer?route=requests',
      'GET /api/coproducer?route=requests',
      'GET /api/coproducer?route=requests&id=r1',
      'DELETE /api/coproducer?route=requests&id=r1',
      'POST /api/coproducer?route=use',
    ]);
    expect(call(7).body).toEqual({ id: 'm1', seq: 0, total: 1, data: 'data:image/png;base64,AA' });
    expect(call(12).body).toEqual({ id: 'r1' });
    for (let i = 0; i < fetchMock.mock.calls.length; i++) {
      expect(call(i).headers.authorization).toBe(`Bearer ${TOKEN}`);
      expect(call(i).headers['x-auth']).toBeUndefined();
    }
  });

  it('asks for at most fifty shows by id, and nothing for none', async () => {
    const client = createCoproducerClient(TOKEN);
    expect(await client.showsByIds([])).toEqual({ shows: [], next: null, unreadable: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(client.showsByIds(Array.from({ length: 51 }, (_, i) => `s${i}`))).rejects.toThrow();
  });

  it('says once that the link has ended, with the reason', async () => {
    const ended = vi.fn();
    onLinkEnded(ended);
    const client = createCoproducerClient(TOKEN);
    fetchMock.mockImplementation(async () => answer(410, { error: 'link_unreadable' }));
    await expect(client.revisions()).rejects.toMatchObject({ status: 410, code: 'link_unreadable' });
    await expect(client.listRequests()).rejects.toMatchObject({ status: 410 });
    expect(ended).toHaveBeenCalledTimes(1);
    expect(ended).toHaveBeenCalledWith('link_unreadable');
  });

  it('does not take other failures for an ended link', async () => {
    const ended = vi.fn();
    onLinkEnded(ended);
    fetchMock.mockImplementation(async () => answer(401, { error: 'unauthorized' }));
    await expect(createCoproducerClient(TOKEN).settings()).rejects.toMatchObject({ status: 401 });
    expect(ended).not.toHaveBeenCalled();
  });
});

describe('reviewMediaSource', () => {
  it('reads plaintext slices and stages through the client', async () => {
    const client = createCoproducerClient(TOKEN);
    fetchMock.mockResolvedValueOnce(answer(200, { data: 'data:image/png;base64,', total: 2 }));
    const source = reviewMediaSource(client);
    expect(await source.chunk('abcd-1234', 0)).toBe('data:image/png;base64,');
    await source.stage({ id: 'm1', seq: 0, total: 1, data: 'x' });
    expect(call(1).method).toBe('PUT');
  });
});
