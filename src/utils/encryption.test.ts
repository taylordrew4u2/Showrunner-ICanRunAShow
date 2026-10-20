import { pbkdf2Sync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import CryptoJS from 'crypto-js';
import { decryptData, deriveAuthKey, deriveSessionKeys, deriveUserId, encryptData, hashPassword } from './encryption';

// The legacy (v1) key derivation, reproduced here to forge pre-upgrade
// ciphertext. Must match what shipped before the KDF was strengthened.
const LEGACY_SALT = 'showrunner-salt-2024';
function legacyEncrypt(data: unknown, password: string): string {
  const key = CryptoJS.PBKDF2(password, LEGACY_SALT, { keySize: 256 / 32, iterations: 1000 }).toString();
  return CryptoJS.AES.encrypt(JSON.stringify(data), key).toString();
}

describe('encryptData / decryptData', () => {
  it('round-trips an object with the correct password', () => {
    const data = { shows: [{ id: '1', name: 'Open Mic' }], n: 42 };
    const cipher = encryptData(data, 'hunter2');
    expect(typeof cipher).toBe('string');
    expect(cipher).not.toContain('Open Mic'); // actually encrypted
    expect(decryptData(cipher, 'hunter2')).toEqual(data);
  });

  it('fails to decrypt with the wrong password', () => {
    const cipher = encryptData({ secret: true }, 'right-password');
    expect(() => decryptData(cipher, 'wrong-password')).toThrow();
  });

  it('still decrypts legacy (v1) ciphertext — no existing data is lost', () => {
    const data = { shows: [{ id: 'legacy', name: 'Old Show' }] };
    const legacyCipher = legacyEncrypt(data, 'hunter2');
    expect(decryptData(legacyCipher, 'hunter2')).toEqual(data);
  });
});

describe('hashPassword', () => {
  it('is deterministic and hides the input', () => {
    const h = hashPassword('hunter2');
    expect(h).toBe(hashPassword('hunter2'));
    expect(h).not.toContain('hunter2');
    expect(h).toHaveLength(64); // SHA-256 hex
  });

  it('differs for different passwords', () => {
    expect(hashPassword('a')).not.toBe(hashPassword('b'));
  });
});

describe('deriveAuthKey', () => {
  const USER = deriveUserId('producer');

  it('is deterministic, so every device and every sign-in sends the same credential', async () => {
    const key = await deriveAuthKey('hunter2', USER);
    expect(key).toBe(await deriveAuthKey('hunter2', USER));
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  // Every stored verifier is a hash of this exact output. A changed label,
  // salt or count would lock every account out, so pin it to an independent
  // implementation rather than to the function itself.
  it('is PBKDF2-SHA256 with the per-account salt and 210,000 rounds', async () => {
    const expected = pbkdf2Sync('hunter2', `icanrunashow-auth-v2:${USER}`, 210_000, 32, 'sha256').toString('hex');
    expect(await deriveAuthKey('hunter2', USER)).toBe(expected);
  });

  it('is neither the data key nor the old hash, though the same password goes into all of them', async () => {
    const key = await deriveAuthKey('hunter2', USER);
    const { key: dataKey, legacyKey } = deriveSessionKeys('hunter2');
    expect(key).not.toBe(dataKey);
    expect(key).not.toBe(legacyKey);
    expect(key).not.toBe(hashPassword('hunter2'));
  });

  it('differs between accounts with the same password, and between passwords', async () => {
    const key = await deriveAuthKey('hunter2', USER);
    expect(await deriveAuthKey('hunter2', deriveUserId('someone-else'))).not.toBe(key);
    expect(await deriveAuthKey('hunter3', USER)).not.toBe(key);
  });

  // A page not served securely (the dev server opened from a phone over the
  // LAN) has no WebCrypto. The fallback must give the very same credential, or
  // that device could never sign in to an account made anywhere else.
  it('gives the same credential without WebCrypto', async () => {
    const expected = pbkdf2Sync('fallback-only', `icanrunashow-auth-v2:${USER}`, 210_000, 32, 'sha256').toString('hex');
    vi.stubGlobal('crypto', {});
    try {
      expect(await deriveAuthKey('fallback-only', USER)).toBe(expected);
    } finally {
      vi.unstubAllGlobals();
    }
  }, 30_000);
});
