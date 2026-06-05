import { describe, expect, it } from 'vitest';
import {
  decryptData,
  encryptData,
  generateSalt,
  hashPassword,
  type KdfParams,
} from './encryption';

const params: KdfParams = { salt: 'a1b2c3d4e5f6a7b8', iterations: 2000 };

describe('encryptData / decryptData', () => {
  it('round-trips an object with the correct password (legacy params)', () => {
    const data = { shows: [{ id: '1', name: 'Open Mic' }], n: 42 };
    const cipher = encryptData(data, 'hunter2');
    expect(typeof cipher).toBe('string');
    expect(cipher).not.toContain('Open Mic'); // actually encrypted
    expect(decryptData(cipher, 'hunter2')).toEqual(data);
  });

  it('round-trips with per-user KDF params', () => {
    const data = { secret: 'value', list: [1, 2, 3] };
    const cipher = encryptData(data, 'hunter2', params);
    expect(decryptData(cipher, 'hunter2', params)).toEqual(data);
  });

  it('fails to decrypt with the wrong password', () => {
    const cipher = encryptData({ secret: true }, 'right-password');
    expect(() => decryptData(cipher, 'wrong-password')).toThrow();
  });

  it('cannot decrypt new-param ciphertext with the legacy derivation', () => {
    const cipher = encryptData({ secret: true }, 'hunter2', params);
    expect(() => decryptData(cipher, 'hunter2')).toThrow();
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

  it('salted hashes are deterministic and differ from the legacy hash', () => {
    expect(hashPassword('pw', 'salt-1')).toBe(hashPassword('pw', 'salt-1'));
    expect(hashPassword('pw', 'salt-1')).not.toBe(hashPassword('pw', 'salt-2'));
    expect(hashPassword('pw', 'salt-1')).not.toBe(hashPassword('pw'));
  });
});

describe('generateSalt', () => {
  it('returns a 128-bit hex salt', () => {
    expect(generateSalt()).toMatch(/^[0-9a-f]{32}$/);
  });

  it('returns unique values', () => {
    const salts = new Set(Array.from({ length: 100 }, () => generateSalt()));
    expect(salts.size).toBe(100);
  });
});
