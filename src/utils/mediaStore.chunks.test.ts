import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// The chunk fetch is the whole reason a soundboard press used to wait: one
// round trip per 1.5M-character slice, stacked end to end.
const get = vi.fn();
vi.mock('./api', () => ({ api: { get: (...a: unknown[]) => get(...a), put: vi.fn(), del: vi.fn() } }));
vi.mock('./encryption', () => ({
  encryptWithKey: (v: unknown) => JSON.stringify(v),
  decryptWithKey: (v: string) => JSON.parse(v),
  decryptWithKeys: (v: string) => JSON.parse(v),
}));

import { clearMediaStore, initMediaStore, resolveMediaUrl } from './mediaStore';

const RTT = 50; // ms per request, as on a phone network

beforeEach(() => {
  get.mockReset();
  initMediaStore({ username: 'u', key: 'k' } as never);
});
afterEach(() => clearMediaStore());

describe('resolveMediaUrl chunk fetching', () => {
  it('fetches every chunk of a track at once, not one after another', async () => {
    let inFlight = 0;
    let peak = 0;
    get.mockImplementation(async (url: string) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, RTT));
      inFlight--;
      const seq = Number(new URL(url, 'http://x').searchParams.get('seq'));
      return { data: JSON.stringify(`part${seq}`) };
    });

    const started = Date.now();
    const out = await resolveMediaUrl('media:abc#6');
    const elapsed = Date.now() - started;

    // Correctness first: the parts must still land in order.
    expect(out).toBe('part0part1part2part3part4part5');
    expect(get).toHaveBeenCalledTimes(6);
    // Six chunks were in the air together rather than queued behind each other.
    expect(peak).toBe(6);
    // Sequentially this is 6 × RTT; in parallel it is one. Generous bound so
    // the assertion is about the shape, not the machine it runs on.
    expect(elapsed).toBeLessThan(RTT * 3);
  });

  it('caches, so a second press never re-fetches', async () => {
    get.mockResolvedValue({ data: JSON.stringify('x') });
    await resolveMediaUrl('media:cached#2');
    expect(get).toHaveBeenCalledTimes(2);
    await resolveMediaUrl('media:cached#2');
    expect(get).toHaveBeenCalledTimes(2);
  });
});
