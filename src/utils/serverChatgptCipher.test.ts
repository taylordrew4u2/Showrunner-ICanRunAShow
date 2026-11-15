import { expect, it } from 'vitest';
import { decryptShow, encryptShow } from '../../api/_lib/chatgptCipher';
import { decryptWithKey, encryptWithKey } from './encryption';

const currentKey = '0123456789abcdef'.repeat(4);
const legacyKey = 'fedcba9876543210'.repeat(4);

it.each([
  { name: 'Show', schedule: [] },
  { name: 'Café 🎭 — 演出', location: 'São Paulo', notes: 'שָׁלוֹם\nمرحبا' },
  { name: 'Large show', notes: 'A long line with 🎵 and é. '.repeat(10_000), schedule: Array.from({ length: 100 }, (_, id) => ({ id, duration: 5 })) },
  '', null, 42,
])('reads existing CryptoJS ciphertext and writes ciphertext the app can read (%#)', async value => {
  const existing = encryptWithKey(value, currentKey);
  expect(await decryptShow(existing, [currentKey])).toEqual(value);
  const native = await encryptShow(value, currentKey);
  expect(decryptWithKey(native, currentKey)).toEqual(value);
  expect(await decryptShow(native, [currentKey])).toEqual(value);
});

it('tries the legacy session key without altering the stored ciphertext', async () => {
  const cipher = encryptWithKey({ name: 'Older night' }, legacyKey);
  expect(await decryptShow(cipher, [currentKey, legacyKey])).toEqual({ name: 'Older night' });
  await expect(decryptShow(cipher, [currentKey])).rejects.toThrow('Show decryption failed');
});

it('uses a fresh random salt for each encryption', async () => {
  const first = await encryptShow({ name: 'Same show' }, currentKey);
  const second = await encryptShow({ name: 'Same show' }, currentKey);
  expect(first).not.toEqual(second);
  expect(atob(first).slice(0, 8)).toBe('Salted__');
  expect(await decryptShow(first, [currentKey])).toEqual(await decryptShow(second, [currentKey]));
});

it('rejects malformed encodings, missing salt headers and invalid block lengths', async () => {
  const valid = await encryptShow({ name: 'Show' }, currentKey);
  const missingHeader = btoa('Wrong___' + atob(valid).slice(8));
  const invalidLength = btoa(atob(valid).slice(0, -1));
  for (const invalid of ['', 'not base64', valid + '\n', valid.replace(/=+$/, ''), missingHeader, invalidLength, btoa('Salted__')]) {
    // A value without padding can happen to be unchanged if its length was
    // already divisible by three; only test actual mutations.
    if (invalid !== valid) await expect(decryptShow(invalid, [currentKey])).rejects.toThrow();
  }
});

it('refuses absent or malformed session keys and truncated ciphertext', async () => {
  const cipher = await encryptShow({ name: 'Show' }, currentKey);
  await expect(decryptShow(cipher, [])).rejects.toThrow('Show decryption failed');
  await expect(decryptShow(cipher, ['invalid key'])).rejects.toThrow('Show decryption failed');
  await expect(encryptShow({ name: 'Show' }, 'invalid key')).rejects.toThrow('Invalid session key');
  await expect(decryptShow(cipher.slice(0, -4), [currentKey])).rejects.toThrow();
  await expect(encryptShow(undefined, currentKey)).rejects.toThrow('must be JSON');
});
