import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// An upload is a dozen ~2MB chunks going uphill from a basement. A connection
// that drops under one of them used to fail the whole file, and every retry
// by the producer started again from chunk zero.
const put = vi.fn();
const del = vi.fn();
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  api: { get: vi.fn(), put: (...a: unknown[]) => put(...a), del: (...a: unknown[]) => del(...a) },
}));
vi.mock('./encryption', () => ({
  encryptWithKey: (v: unknown) => JSON.stringify(v),
  decryptWithKey: (v: string) => JSON.parse(v),
  decryptWithKeys: (v: string) => JSON.parse(v),
}));
// Three slices' worth, read without a FileReader (there is none in node).
vi.mock('./media', () => ({ readFileAsDataURL: async () => 'data:audio/wav;base64,' + 'x'.repeat(3_200_000) }));

import { clearMediaStore, initMediaStore, uploadMedia } from './mediaStore';

const dropped = () => Object.assign(new Error('Failed to fetch'), {});
const chunkOf = (call: unknown[]) => call[1] as { id: string; seq: number };

beforeEach(() => {
  put.mockReset();
  del.mockReset();
  del.mockResolvedValue({ ok: true });
  initMediaStore({ username: 'u', userId: 'u', authHash: 'h', key: 'k' } as never);
});
afterEach(() => clearMediaStore());

describe('uploading a track on venue wifi', () => {
  it('sends a chunk again when the connection drops under it, and the upload still lands', async () => {
    put.mockImplementation(async (_path: string, body: { seq: number }) => {
      // The second chunk dies once before the server answers.
      if (body.seq === 1 && put.mock.calls.filter((c) => chunkOf(c).seq === 1).length === 1) throw dropped();
      return { ok: true };
    });

    const ref = await uploadMedia(new File(['x'], 'walkon.wav'));

    expect(ref).toMatch(/^media:[^#]+#3$/);
    expect(put).toHaveBeenCalledTimes(4);
    const seqs = put.mock.calls.map((c) => chunkOf(c).seq);
    expect(seqs).toEqual([0, 1, 1, 2]);
    // The repeat is the same chunk of the same file, so the upsert lands once.
    expect(new Set(put.mock.calls.map((c) => chunkOf(c).id)).size).toBe(1);
    expect(del).not.toHaveBeenCalled();
  });

  it('takes the server at its word when it refuses a chunk, rather than asking again', async () => {
    put.mockRejectedValue(Object.assign(new Error('too_large'), { status: 413 }));
    await expect(uploadMedia(new File(['x'], 'walkon.wav'))).rejects.toThrow('too_large');
    expect(put).toHaveBeenCalledTimes(1);
  });

  it('clears out the chunks of an upload that could not finish', async () => {
    put.mockImplementation(async (_path: string, body: { seq: number }) => {
      if (body.seq === 2) throw dropped();
      return { ok: true };
    });
    await expect(uploadMedia(new File(['x'], 'walkon.wav'))).rejects.toThrow('Failed to fetch');
    // Chunks 0 and 1 landed; nothing will ever point at them.
    const id = chunkOf(put.mock.calls[0]).id;
    expect(del).toHaveBeenCalledTimes(1);
    expect(String(del.mock.calls[0][0])).toContain(encodeURIComponent(id));
  });
});
