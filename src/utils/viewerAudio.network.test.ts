import { beforeEach, describe, expect, it, vi } from 'vitest';

// The screen wired to the PA downloads each walk-on in ~2MB chunks over the
// venue's wifi, and the board uploads them over the same. The media store
// gave its own chunks long enough to arrive and a retry for a dropped
// connection; the viewer's copies had neither.
const get = vi.fn();
const put = vi.fn();
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  api: { get: (...a: unknown[]) => get(...a), put: (...a: unknown[]) => put(...a), del: vi.fn() },
}));
vi.mock('./mediaStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./mediaStore')>()),
  resolveMediaUrl: async () => 'data:audio/mp3;base64,AAAA',
}));
vi.mock('./encryption', () => ({
  encryptWithKey: (v: unknown) => JSON.stringify(v),
  decryptWithKey: (v: string) => JSON.parse(v),
}));

import { MEDIA_CHUNK_TIMEOUT_MS } from './mediaStore';
import { fetchViewerTrack, publishTrack } from './viewerAudio';

beforeEach(() => {
  get.mockReset();
  put.mockReset();
});

describe('viewer audio on venue wifi', () => {
  it('gives every downloaded chunk as long as the media store gives its own', async () => {
    get.mockResolvedValue({ data: JSON.stringify('data:audio/mp3;base64,AAAA') });
    const url = await fetchViewerTrack('token-123', 'key', { key: 'performer:a', mediaId: 't-performer-a', total: 1 });
    expect(url).toBe('data:audio/mp3;base64,AAAA');
    expect((get.mock.calls[0][1] as { timeoutMs?: number } | undefined)?.timeoutMs).toBe(MEDIA_CHUNK_TIMEOUT_MS);
  });

  it('sends an upload chunk again when the connection drops, rather than failing the track', async () => {
    put.mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValue({ ok: true });
    const creds = { userId: 'u', authHash: 'h' } as never;
    await expect(publishTrack('token-123', 'key', 'media:walk-on', 't-performer-a', creds)).resolves.toBe(1);
    expect(put).toHaveBeenCalledTimes(2);
    expect((put.mock.calls[1][2] as { timeoutMs?: number }).timeoutMs).toBe(MEDIA_CHUNK_TIMEOUT_MS);
  });
});
