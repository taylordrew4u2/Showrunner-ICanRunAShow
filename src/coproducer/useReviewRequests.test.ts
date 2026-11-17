import { describe, expect, it, vi } from 'vitest';
import { countPending, createRequestsTracker, needsDetail, type RequestsSnapshot } from './useReviewRequests';
import type { CoproducerClient, CoproducerRequestDetail, CoproducerRequestView, RequestPayload } from './types';

const edit: RequestPayload = { kind: 'edit', shows: [], settings: null };
const flyer: RequestPayload = { kind: 'download', action: { type: 'flyer', showId: 'show1' } };

function view(id: string, over: Partial<CoproducerRequestView> = {}): CoproducerRequestView {
  return {
    id,
    kind: 'edit',
    status: 'pending',
    createdAt: '2026-11-01T10:00:00.000Z',
    decidedAt: null,
    usedAt: null,
    outline: { kind: 'edit' },
    result: null,
    ...over,
  };
}

/** A client whose list is whatever `listed` holds when it is asked. */
function fakeClient(listed: { current: CoproducerRequestView[] }) {
  const getRequest = vi.fn(async (id: string): Promise<CoproducerRequestDetail> => {
    const row = listed.current.find((r) => r.id === id);
    if (!row) throw new Error('not found');
    return { ...row, payload: row.kind === 'edit' ? edit : flyer };
  });
  const listRequests = vi.fn(async () => listed.current);
  const client = { listRequests, getRequest } as unknown as CoproducerClient;
  return { client, listRequests, getRequest };
}

function track(client: CoproducerClient) {
  const seen: RequestsSnapshot[] = [];
  const tracker = createRequestsTracker(client, (snapshot) => seen.push(snapshot));
  return { tracker, seen, last: () => seen[seen.length - 1] };
}

describe('keeping the co-producer’s requests', () => {
  it('fetches each open request’s payload once, one at a time', async () => {
    const listed = { current: [view('a'), view('b', { status: 'stale' }), view('c', { status: 'rejected' })] };
    const { client, getRequest } = fakeClient(listed);
    let inFlight = 0;
    let most = 0;
    getRequest.mockImplementation(async (id: string) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return { ...listed.current.find((r) => r.id === id)!, payload: edit };
    });
    const { tracker, last } = track(client);

    await tracker.refresh();
    await tracker.refresh();
    await tracker.refresh();

    expect(getRequest.mock.calls.map(([id]) => id)).toEqual(['a', 'b']);
    expect(most).toBe(1);
    expect([...last().details.keys()]).toEqual(['a', 'b']);
    expect(last().requests.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('also fetches an approved share or download still to be handed over, and nothing decided otherwise', async () => {
    const listed = {
      current: [
        view('dl', { kind: 'download', status: 'approved' }),
        view('used', { kind: 'download', status: 'approved', usedAt: '2026-11-02T10:00:00.000Z' }),
        view('done', { status: 'approved' }),
      ],
    };
    const { client, getRequest } = fakeClient(listed);
    await track(client).tracker.refresh();
    expect(getRequest.mock.calls.map(([id]) => id)).toEqual(['dl']);
  });

  it('keeps a payload once fetched, with the status the list gives it now', async () => {
    const listed = { current: [view('a')] };
    const { client, getRequest } = fakeClient(listed);
    const { tracker, last } = track(client);
    await tracker.refresh();

    listed.current = [view('a', { status: 'approved', decidedAt: '2026-11-03T10:00:00.000Z' })];
    await tracker.refresh();

    expect(getRequest).toHaveBeenCalledTimes(1);
    expect(last().details.get('a')).toMatchObject({ status: 'approved', decidedAt: '2026-11-03T10:00:00.000Z', payload: edit });
  });

  it('lets a request that leaves the list take its payload with it', async () => {
    const listed = { current: [view('a'), view('b')] };
    const { client } = fakeClient(listed);
    const { tracker, last } = track(client);
    await tracker.refresh();
    listed.current = [view('b')];
    await tracker.refresh();
    expect([...last().details.keys()]).toEqual(['b']);
  });

  it('keeps what it had when a fetch fails, and tries the payload again next time', async () => {
    const listed = { current: [view('a')] };
    const { client, listRequests, getRequest } = fakeClient(listed);
    const { tracker, last, seen } = track(client);
    getRequest.mockRejectedValueOnce(new Error('offline'));
    await tracker.refresh();
    expect(last().details.size).toBe(0);

    listRequests.mockRejectedValueOnce(new Error('offline'));
    const before = seen.length;
    await tracker.refresh();
    expect(seen.length).toBe(before);

    await tracker.refresh();
    expect(getRequest).toHaveBeenCalledTimes(2);
    expect(last().details.has('a')).toBe(true);
  });

  it('runs one look at a time, and once more for calls made during it', async () => {
    const listed = { current: [view('a', { status: 'approved' })] };
    const { client, listRequests } = fakeClient(listed);
    const { tracker } = track(client);
    await Promise.all([tracker.refresh(), tracker.refresh(), tracker.refresh()]);
    expect(listRequests).toHaveBeenCalledTimes(2);
  });

  it('leaves the screens alone when the list has not changed', async () => {
    const listed = { current: [view('a', { status: 'rejected' })] };
    const { client } = fakeClient(listed);
    const { tracker, seen } = track(client);
    await tracker.refresh();
    expect(seen).toHaveLength(1);
    listed.current = [view('a', { status: 'rejected' })];
    await tracker.refresh();
    expect(seen).toHaveLength(1);
    listed.current = [view('a', { status: 'rejected', decidedAt: '2026-11-03T10:00:00.000Z' })];
    await tracker.refresh();
    expect(seen).toHaveLength(2);
  });

  it('reports nothing once disposed', async () => {
    const listed = { current: [view('a')] };
    const { client } = fakeClient(listed);
    const { tracker, seen } = track(client);
    tracker.dispose();
    await tracker.refresh();
    expect(seen).toEqual([]);
  });

  it('counts pending and stale as waiting', () => {
    expect(countPending([view('a'), view('b', { status: 'stale' }), view('c', { status: 'approved' }), view('d', { status: 'rejected' })])).toBe(2);
    expect(needsDetail(view('e', { kind: 'share', status: 'rejected' }))).toBe(false);
  });
});
