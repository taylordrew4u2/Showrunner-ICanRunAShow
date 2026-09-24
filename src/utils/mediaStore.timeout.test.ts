import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// A chunk is ~2MB of ciphertext. The fetch wrapper's default deadline suits a
// small request; on venue wifi a big track's chunks all ran out of time
// together and the soundboard called the file broken.
const get = vi.fn();
vi.mock('./api', () => ({ api: { get: (...a: unknown[]) => get(...a), put: vi.fn(), del: vi.fn() } }));
vi.mock('./encryption', () => ({
  encryptWithKey: (v: unknown) => JSON.stringify(v),
  decryptWithKey: (v: string) => JSON.parse(v),
  decryptWithKeys: (v: string) => JSON.parse(v),
}));

import { clearMediaStore, initMediaStore, MEDIA_CHUNK_TIMEOUT_MS, resolveMediaUrl } from './mediaStore';

beforeEach(() => {
  get.mockReset();
  initMediaStore({ username: 'u', key: 'k' } as never);
});
afterEach(() => clearMediaStore());

describe('downloading a big track on venue wifi', () => {
  it('gives every chunk long enough to arrive on a slow connection', async () => {
    get.mockResolvedValue({ data: JSON.stringify('x') });
    await resolveMediaUrl('media:slow#3');
    expect(get).toHaveBeenCalledTimes(3);
    for (const call of get.mock.calls) {
      expect((call[1] as { timeoutMs?: number }).timeoutMs).toBe(MEDIA_CHUNK_TIMEOUT_MS);
    }
    // Two minutes: a 2MB chunk at a few hundred kbps, with room to spare.
    expect(MEDIA_CHUNK_TIMEOUT_MS).toBeGreaterThanOrEqual(120_000);
  });
});
