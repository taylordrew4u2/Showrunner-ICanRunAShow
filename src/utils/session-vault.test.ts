import { describe, it, expect } from 'vitest';
import { credentialsFrom } from './session-vault';
import { deriveKey, deriveUserId, hashPassword } from './encryption';

// A password with no hex characters in it, so a substring hit against a
// derived hex digest can't happen by chance and give a false pass.
const PASSWORD = 'purple-stout-window-zipper';
const USERNAME = 'Producer';

describe('credentialsFrom', () => {
  // The reason this module exists. Everything else here is detail.
  it('produces a record that does not contain the password', () => {
    const creds = credentialsFrom(USERNAME, PASSWORD);
    expect(JSON.stringify(creds)).not.toContain(PASSWORD);
    expect(Object.values(creds)).not.toContain(PASSWORD);
  });

  it('carries exactly the fields a session needs, and no others', () => {
    const creds = credentialsFrom(USERNAME, PASSWORD);
    expect(Object.keys(creds).sort()).toEqual(
      ['authHash', 'key', 'legacyKey', 'userId', 'username'].sort(),
    );
  });

  it('derives the same values the storage layer would have derived', () => {
    const creds = credentialsFrom(USERNAME, PASSWORD);
    expect(creds.key).toBe(deriveKey(PASSWORD));
    expect(creds.authHash).toBe(hashPassword(PASSWORD));
    // The user ID is case- and whitespace-insensitive: it's the primary key for
    // every row, so "Producer" and " producer " must land on the same account.
    expect(creds.userId).toBe(deriveUserId('producer'));
    expect(credentialsFrom('  PRODUCER  ', PASSWORD).userId).toBe(creds.userId);
  });

  it('keeps the legacy key so pre-upgrade data still decrypts', () => {
    const creds = credentialsFrom(USERNAME, PASSWORD);
    expect(creds.legacyKey).toBeTruthy();
    expect(creds.legacyKey).not.toBe(creds.key);
  });

  it('preserves the username as typed, for display', () => {
    expect(credentialsFrom('  Producer  ', PASSWORD).username).toBe('  Producer  ');
  });
});
