import { describe, expect, it, vi, beforeEach } from 'vitest';

// The sweep judges "unused" against the account's saved data. A file that was
// uploaded moments ago has no saved data pointing at it yet: the chunks land
// first and the show that references them is saved afterwards — from another
// tab, or from the phone, or after the producer finishes the form. Seen from a
// sweep running at that moment, it looks exactly like an orphan.
const get = vi.fn();
const del = vi.fn();
vi.mock('./api', () => ({
  api: { get: (...a: unknown[]) => get(...a), del: (...a: unknown[]) => del(...a), put: vi.fn() },
}));

import { UPLOAD_GRACE_SECONDS, sweepUnusedMedia, unreferencedMedia } from './mediaCleanup';
import { DEFAULT_SETTINGS } from '../types';
import type { SessionCredentials } from './session-vault';

const creds = { userId: 'u', authHash: 'h' } as SessionCredentials;

beforeEach(() => {
  get.mockReset();
  del.mockReset();
  del.mockResolvedValue({ ok: true });
});

describe('a file uploaded a moment ago', () => {
  it('is not called unused, because the show pointing at it may not be saved yet', () => {
    const stored = [
      { id: 'fresh', chunks: 4, bytes: 4000, ageSeconds: 90 },
      { id: 'old', chunks: 1, bytes: 100, ageSeconds: UPLOAD_GRACE_SECONDS * 10 },
    ];
    expect(unreferencedMedia(stored, [], DEFAULT_SETTINGS).map((m) => m.id)).toEqual(['old']);
  });

  it('is still counted as scanned, but never deleted', async () => {
    get.mockResolvedValue({
      items: [
        { id: 'fresh', chunks: 4, bytes: 4000, ageSeconds: 30 },
        { id: 'old', chunks: 1, bytes: 100, ageSeconds: UPLOAD_GRACE_SECONDS * 10 },
      ],
    });
    const report = await sweepUnusedMedia([], DEFAULT_SETTINGS, creds);
    expect(report).toEqual({ scanned: 2, removed: 1, bytes: 100, failed: 0 });
    expect(del).toHaveBeenCalledTimes(1);
    expect(del.mock.calls[0][0]).toContain('id=old');
  });

  it('gets long enough for a slow upload and the save that follows it', () => {
    // A 25MB track over venue wifi is many minutes of chunks, and the show is
    // saved only once the producer is done with the form. Hours, not minutes.
    expect(UPLOAD_GRACE_SECONDS).toBeGreaterThanOrEqual(6 * 60 * 60);
  });
});

describe('a file the server did not date', () => {
  it('is judged on its references alone, as before', () => {
    // Older rows, or a listing from before ages were reported: nothing to
    // wait for, so an unreferenced one is the orphan it looks like.
    const stored = [{ id: 'undated', chunks: 1, bytes: 10 }];
    expect(unreferencedMedia(stored, [], DEFAULT_SETTINGS).map((m) => m.id)).toEqual(['undated']);
  });
});
