import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProfileRequest } from '../types';
import { api, SUBMIT_TIMEOUT_MS } from './api';
import { encryptWithKey } from './encryption';
import { fetchProfilePhoto, uploadProfilePhoto } from './profileLink';

// A headshot at flyer size is around a megabyte of ciphertext, and it moves
// over venue wifi in both directions: up from the performer's phone, and later
// down to the producer's. The answers themselves got the two-minute deadline;
// the photo — the reason the deadline is two minutes — was left on the default.

const key = 'key-0123456789abcdef';
const creds = { username: 'basement', userId: 'u1', authHash: 'h1', key: 'k2', legacyKey: 'k1' };
const request = (over: Partial<ProfileRequest> = {}): ProfileRequest => ({
  id: 'r1',
  token: 'tok-0123456789abcdef',
  key,
  personName: 'Mona Sable',
  sentAt: '2026-09-10T00:00:00.000Z',
  ...over,
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('a headshot sent through a profile link', () => {
  it('is given the same two minutes the answers get, not the default deadline', async () => {
    const put = vi.spyOn(api, 'put').mockResolvedValue({ ok: true } as never);

    await uploadProfilePhoto('tok', key, 'data:image/jpeg;base64,AAAA');

    expect(put).toHaveBeenCalledOnce();
    expect(put.mock.calls[0][2]).toMatchObject({ timeoutMs: SUBMIT_TIMEOUT_MS });
  });

  it('sends a chunk again when the connection dropped before the server answered', async () => {
    // The route upserts by (token, seq), so a repeat either lands or replaces
    // the copy that already did — never a second photo.
    const put = vi.spyOn(api, 'put')
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValue({ ok: true } as never);

    const upload = uploadProfilePhoto('tok', key, 'data:image/jpeg;base64,AAAA');
    upload.catch(() => { /* judged below, once the retry delay has passed */ });
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(upload).resolves.toBe(1);
    expect(put).toHaveBeenCalledTimes(2);
    expect(put.mock.calls[0][1]).toEqual(put.mock.calls[1][1]);
  });

  it('does not keep sending a chunk the server has refused', async () => {
    const refused = Object.assign(new Error('too_large'), { status: 413 });
    const put = vi.spyOn(api, 'put').mockRejectedValue(refused);

    await expect(uploadProfilePhoto('tok', key, 'data:image/jpeg;base64,AAAA')).rejects.toBe(refused);
    expect(put).toHaveBeenCalledOnce();
  });
});

describe('the producer pulling a headshot back', () => {
  it('waits the two minutes a megabyte needs on venue wifi, rather than giving up at twenty seconds', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({
      data: encryptWithKey('data:image/jpeg;base64,AAAA', key), total: 1,
    } as never);

    const photo = await fetchProfilePhoto(
      request({ submitted: { submittedAt: '', typedName: 'Mona', fields: [], photoChunks: 1 } }),
      creds,
    );

    expect(photo).toBe('data:image/jpeg;base64,AAAA');
    expect(get.mock.calls[0][1]).toMatchObject({ timeoutMs: SUBMIT_TIMEOUT_MS });
  });
});
