import { describe, expect, it } from 'vitest';
import { decryptData, encryptData, hashPassword } from './encryption';

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
