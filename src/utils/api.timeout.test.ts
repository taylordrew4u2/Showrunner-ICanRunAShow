import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, SUBMIT_TIMEOUT_MS, timeoutForBody } from './api';

// A producer's show save batches up to ~4MB of ciphertext into one PUT and the
// settings blob travels whole. Neither asked for a longer deadline, so on a
// slow uplink the wrapper aborted every one of them at twenty seconds — before
// the body had finished leaving the phone — and the sync pill said "retrying"
// forever with nothing the producer could do about it.

/** A fetch that never answers, but does honour the abort signal. */
function hangingFetch() {
  return vi.fn((_: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      const err = new Error('The operation was aborted.');
      err.name = 'AbortError';
      reject(err);
    });
  }));
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('saving a big show or settings blob on a slow connection', () => {
  it('gives a multi-megabyte save longer than a small request gets', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    let settled: 'pending' | 'rejected' = 'pending';
    const save = api.put('/api/shows', { changes: [{ encryptedData: 'x'.repeat(4_000_000) }] })
      .catch(() => { settled = 'rejected'; });

    // The old deadline: a small request would be given up on here.
    await vi.advanceTimersByTimeAsync(20_001);
    expect(settled).toBe('pending');

    await vi.advanceTimersByTimeAsync(SUBMIT_TIMEOUT_MS);
    await save;
    expect(settled).toBe('rejected');
  });

  it('still gives up on a small request after twenty seconds', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    let settled: 'pending' | 'rejected' = 'pending';
    const ping = api.post('/api/auth', { action: 'login' }).catch(() => { settled = 'rejected'; });
    await vi.advanceTimersByTimeAsync(20_001);
    await ping;
    expect(settled).toBe('rejected');
  });

  it('keeps a deadline the caller chose', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    let settled: 'pending' | 'rejected' = 'pending';
    const save = api.put('/api/settings', { encryptedData: 'x'.repeat(3_000_000) }, { timeoutMs: 5_000 })
      .catch(() => { settled = 'rejected'; });
    await vi.advanceTimersByTimeAsync(5_001);
    await save;
    expect(settled).toBe('rejected');
  });

  it('scales the deadline with the body and caps it where a signature upload is capped', () => {
    expect(timeoutForBody(0)).toBe(20_000);
    expect(timeoutForBody(200_000)).toBe(20_000);
    // ~1MB at a basement's 20KB/s is fifty seconds.
    expect(timeoutForBody(1_000_000)).toBe(50_000);
    expect(timeoutForBody(4_300_000)).toBe(SUBMIT_TIMEOUT_MS);
  });
});

// The load is the other direction. GET /api/shows answers with every show's
// ciphertext and GET /api/settings with the whole blob — megabytes for a big
// or older account — and a GET has no body of its own, so it got twenty
// seconds for the lot. At a basement's 20KB/s that is about 400KB, so a big
// account aborted on every launch and every retry and never loaded at all.

/** A server that answers at once and then sends its answer very slowly. */
function tricklingFetch() {
  return vi.fn((_: string, init?: RequestInit) => Promise.resolve({
    ok: true,
    status: 200,
    json: () => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const err = new Error('The operation was aborted.');
        err.name = 'AbortError';
        reject(err);
      });
    }),
  } as Response));
}

describe('loading a big account on a slow connection', () => {
  it('gives the answer longer to arrive than a small request gets', async () => {
    vi.stubGlobal('fetch', tricklingFetch());
    let settled: 'pending' | 'rejected' = 'pending';
    const load = api.get('/api/shows').catch(() => { settled = 'rejected'; });

    await vi.advanceTimersByTimeAsync(20_001);
    expect(settled).toBe('pending');

    // Not forever: past this the account is too big for the connection.
    await vi.advanceTimersByTimeAsync(SUBMIT_TIMEOUT_MS);
    await load;
    expect(settled).toBe('rejected');
  });

  it('still gives up after twenty seconds on a server that never answers', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    let settled: 'pending' | 'rejected' = 'pending';
    const load = api.get('/api/shows').catch(() => { settled = 'rejected'; });
    await vi.advanceTimersByTimeAsync(20_001);
    await load;
    expect(settled).toBe('rejected');
  });
});
