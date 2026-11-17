import { describe, expect, it } from 'vitest';
import { COPRODUCER_SEAL_INFO, COPRODUCER_SEAL_VERSION, sealBinding } from '../../api/_lib/coproducerAuth';
import { b64url, randomToken, sealKeys, unb64url, unsealKeys } from '../../api/_lib/seal';

const ASSISTANT_INFO = 'icanrunashow assistant delegated keys v2';
const keys = { key: 'a'.repeat(64), legacyKey: 'b'.repeat(64) };

describe('sealing delegated keys', () => {
  it('round-trips with and without additional data', async () => {
    const token = randomToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await unsealKeys(await sealKeys(keys, token, ASSISTANT_INFO, 'v2'), token, ASSISTANT_INFO, 'v2')).toEqual(keys);
    const bound = sealBinding('link-1', 'producer');
    expect(await unsealKeys(await sealKeys(keys, token, COPRODUCER_SEAL_INFO, COPRODUCER_SEAL_VERSION, bound), token, COPRODUCER_SEAL_INFO, COPRODUCER_SEAL_VERSION, bound)).toEqual(keys);
  });

  it('keeps a co-producer seal and an assistant seal apart, both ways', async () => {
    const token = randomToken();
    const bound = sealBinding('link-1', 'producer');
    const coproducer = await sealKeys(keys, token, COPRODUCER_SEAL_INFO, 'v1', bound);
    const assistant = await sealKeys(keys, token, ASSISTANT_INFO, 'v1');
    await expect(unsealKeys(coproducer, token, ASSISTANT_INFO, 'v1', bound)).rejects.toThrow();
    await expect(unsealKeys(coproducer, token, ASSISTANT_INFO, 'v1')).rejects.toThrow();
    await expect(unsealKeys(assistant, token, COPRODUCER_SEAL_INFO, 'v1')).rejects.toThrow();
    await expect(unsealKeys(assistant, token, COPRODUCER_SEAL_INFO, 'v1', bound)).rejects.toThrow();
  });

  it('opens for nothing but its own token', async () => {
    const sealed = await sealKeys(keys, randomToken(), COPRODUCER_SEAL_INFO, 'v1');
    await expect(unsealKeys(sealed, randomToken(), COPRODUCER_SEAL_INFO, 'v1')).rejects.toThrow();
  });

  it('checks the version prefix', async () => {
    const token = randomToken();
    const sealed = await sealKeys(keys, token, COPRODUCER_SEAL_INFO, 'v1');
    expect(sealed.startsWith('v1.')).toBe(true);
    await expect(unsealKeys(sealed, token, COPRODUCER_SEAL_INFO, 'v2')).rejects.toThrow('Unreadable sealed keys.');
    await expect(unsealKeys(`v1.${sealed}`, token, COPRODUCER_SEAL_INFO, 'v1')).rejects.toThrow('Unreadable sealed keys.');
  });

  it('opens nothing once copied to another link row', async () => {
    const token = randomToken();
    const sealed = await sealKeys(keys, token, COPRODUCER_SEAL_INFO, 'v1', sealBinding('link-1', 'producer'));
    await expect(unsealKeys(sealed, token, COPRODUCER_SEAL_INFO, 'v1', sealBinding('link-2', 'producer'))).rejects.toThrow();
    await expect(unsealKeys(sealed, token, COPRODUCER_SEAL_INFO, 'v1', sealBinding('link-1', 'neighbour'))).rejects.toThrow();
    await expect(unsealKeys(sealed, token, COPRODUCER_SEAL_INFO, 'v1')).rejects.toThrow();
  });

  it('encodes base64url without padding, and back', () => {
    const bytes = Uint8Array.from({ length: 70_000 }, (_, i) => (i * 7) % 256);
    const text = b64url(bytes);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Array.from(unb64url(text))).toEqual(Array.from(bytes));
  });
});
