import { describe, expect, it } from 'vitest';
import CryptoJS from 'crypto-js';
import { decryptData, encryptData, hashPassword } from './encryption';

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
