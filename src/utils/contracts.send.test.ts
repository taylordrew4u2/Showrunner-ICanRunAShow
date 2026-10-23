import { beforeEach, describe, expect, it, vi } from 'vitest';

// Chunks left behind by a send that never finished count against the
// producer's storage for links, under a token no request they can see names.
const put = vi.fn();
const del = vi.fn();
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  api: { put: (...a: unknown[]) => put(...a), del: (...a: unknown[]) => del(...a) },
}));
vi.mock('./mediaStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./mediaStore')>()),
  resolveMediaUrl: async () => `data:application/pdf;base64,${'A'.repeat(3_200_000)}`,
}));
vi.mock('./encryption', () => ({
  encryptWithKey: (v: unknown) => JSON.stringify(v),
  decryptWithKey: (v: string) => JSON.parse(v),
}));

import type { Contract } from '../types';
import { sendForSignature } from './contracts';

const contract = { id: 'c1', name: 'Agreement', fileRef: 'media:agreement', fileName: 'agreement.pdf' } as Contract;
const creds = { userId: 'producer', authHash: 'h' } as never;
const full = () => Object.assign(new Error('link_storage_full'), { status: 413, code: 'link_storage_full' });

beforeEach(() => {
  put.mockReset();
  del.mockReset().mockResolvedValue({ ok: true });
});

describe('sending a contract that does not finish', () => {
  it('takes back the chunks that did land, and still reports the failure', async () => {
    // Three chunks; the allowance runs out on the third.
    put.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: true }).mockRejectedValueOnce(full());
    await expect(sendForSignature(contract, { name: 'Mona' }, 'Basement', creds)).rejects.toMatchObject({ code: 'link_storage_full' });

    const token = (put.mock.calls[0][1] as { token: string }).token;
    expect(del).toHaveBeenCalledWith(`/api/sign?token=${encodeURIComponent(token)}`, { authUserId: 'producer', authHash: 'h' });
  });

  it('reports the failure, not the tidy-up, when the tidy-up fails too', async () => {
    put.mockRejectedValue(new Error('Failed to fetch'));
    del.mockRejectedValue(new Error('Failed to fetch'));
    await expect(sendForSignature(contract, { name: 'Mona' }, 'Basement', creds)).rejects.toThrow('Failed to fetch');
  });

  it('leaves a send that went through alone', async () => {
    put.mockResolvedValue({ ok: true });
    await sendForSignature(contract, { name: 'Mona' }, 'Basement', creds);
    expect(del).not.toHaveBeenCalled();
    expect(put.mock.calls.map((c) => c[0])).toEqual(['/api/sign-doc', '/api/sign-doc', '/api/sign-doc', '/api/sign']);
  });
});
