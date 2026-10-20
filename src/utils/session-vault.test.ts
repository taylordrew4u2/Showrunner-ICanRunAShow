import { afterEach, describe, it, expect, vi } from 'vitest';
import { credentialsFrom, loadSession, normalizeUsername, saveSession, type SessionCredentials } from './session-vault';
import { deriveAuthKey, deriveKey, deriveUserId, hashPassword } from './encryption';

// A password with no hex characters in it, so a substring hit against a
// derived hex digest can't happen by chance and give a false pass.
const PASSWORD = 'purple-stout-window-zipper';
const USERNAME = 'Producer';

describe('credentialsFrom', () => {
  // The reason this module exists. Everything else here is detail.
  it('produces a record that does not contain the password', async () => {
    const creds = await credentialsFrom(USERNAME, PASSWORD);
    expect(JSON.stringify(creds)).not.toContain(PASSWORD);
    expect(Object.values(creds)).not.toContain(PASSWORD);
  });

  it('carries exactly the fields a session needs, and no others', async () => {
    const creds = await credentialsFrom(USERNAME, PASSWORD);
    expect(Object.keys(creds).sort()).toEqual(
      ['authHash', 'key', 'legacyKey', 'userId', 'username'].sort(),
    );
  });

  it('derives the same values the storage layer would have derived', async () => {
    const creds = await credentialsFrom(USERNAME, PASSWORD);
    expect(creds.key).toBe(deriveKey(PASSWORD));
    // The user ID is case- and whitespace-insensitive: it's the primary key for
    // every row, so "Producer" and " producer " must land on the same account.
    expect(creds.userId).toBe(deriveUserId('producer'));
    expect((await credentialsFrom('  PRODUCER  ', PASSWORD)).userId).toBe(creds.userId);
  });

  // This used to be hashPassword(PASSWORD), the SHA-256 that cracked at
  // billions of guesses a second. A session now holds the per-account key
  // only; the old hash is computed at sign-in, if at all, and never kept.
  it('sends the per-account credential, not the old hash', async () => {
    const creds = await credentialsFrom(USERNAME, PASSWORD);
    expect(creds.authHash).toBe(await deriveAuthKey(PASSWORD, deriveUserId('producer')));
    expect(creds.authHash).not.toBe(hashPassword(PASSWORD));
    expect((await credentialsFrom('  PRODUCER  ', PASSWORD)).authHash).toBe(creds.authHash);
  });

  it('keeps the legacy key so pre-upgrade data still decrypts', async () => {
    const creds = await credentialsFrom(USERNAME, PASSWORD);
    expect(creds.legacyKey).toBeTruthy();
    expect(creds.legacyKey).not.toBe(creds.key);
  });

  it('preserves the username as typed, for display', async () => {
    expect((await credentialsFrom('  Producer  ', PASSWORD)).username).toBe('  Producer  ');
  });
});

describe('the name an account is filed under', () => {
  it('is the same however the producer capitalised or spaced it at sign-in', async () => {
    expect(normalizeUsername('  Producer  ')).toBe('producer');
    expect(normalizeUsername('PRODUCER')).toBe(normalizeUsername('producer'));
    expect((await credentialsFrom(' Producer ', PASSWORD)).userId).toBe(deriveUserId(normalizeUsername(' Producer ')));
  });
});

/**
 * Just enough IndexedDB for the session vault: one store, and an open that
 * can be made to fail the way WebKit's does when it drops its connection.
 */
function fakeIndexedDB() {
  const keys = new Map<string, unknown>();
  let failingOpens = 0;
  const later = (fn: () => void) => setTimeout(fn, 0);
  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => undefined,
    transaction: () => {
      const tx: { oncomplete?: () => void; onerror?: () => void; objectStore: () => unknown } = {
        objectStore: () => ({
          get: (id: string) => {
            const request: { result?: unknown; onsuccess?: () => void } = {};
            later(() => { request.result = keys.get(id); request.onsuccess?.(); });
            return request;
          },
          put: (value: unknown, id: string) => { keys.set(id, value); later(() => tx.oncomplete?.()); },
          delete: (id: string) => { keys.delete(id); later(() => tx.oncomplete?.()); },
        }),
      };
      return tx;
    },
  };
  const factory = {
    open: () => {
      const request: { result?: unknown; error?: unknown; onsuccess?: () => void; onerror?: () => void } = {};
      later(() => {
        if (failingOpens > 0) {
          failingOpens--;
          request.error = new Error('Connection to Indexed Database server lost. Refresh the page to try again');
          request.onerror?.();
          return;
        }
        request.result = db;
        request.onsuccess?.();
      });
      return request;
    },
  };
  return { factory, keys, failNextOpens: (count: number) => { failingOpens = count; } };
}

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return { get length() { return data.size; }, key: i => [...data.keys()][i] ?? null,
    getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); },
    removeItem: key => { data.delete(key); }, clear: () => data.clear() };
}

// Supplied directly: PBKDF2 is slow and none of this is about the KDF.
const STORED: SessionCredentials = { username: 'ada', userId: 'u1', authHash: 'h1', key: 'k2', legacyKey: 'k1' };

describe('restoring a session when IndexedDB has a bad moment', () => {
  afterEach(() => vi.unstubAllGlobals());

  function setUp() {
    const idb = fakeIndexedDB();
    vi.stubGlobal('indexedDB', idb.factory);
    vi.stubGlobal('localStorage', memoryStorage());
    return idb;
  }

  it('gets through a connection that drops once', async () => {
    const idb = setUp();
    await saveSession(STORED);
    idb.failNextOpens(1);
    expect(await loadSession()).toEqual(STORED);
  });

  it('keeps the session and its key for the next launch when IndexedDB cannot be read at all', async () => {
    // Safari and the iOS app's web view lose their IndexedDB connection now
    // and then. That used to read as "the key is gone": the session and the
    // key were both deleted, and a producer at a venue with no signal could
    // not sign back in.
    const idb = setUp();
    await saveSession(STORED);
    idb.failNextOpens(5);
    expect(await loadSession()).toBeNull();
    expect(localStorage.getItem('showrunner:session:v2')).not.toBeNull();
    expect(idb.keys.size).toBe(1);

    idb.failNextOpens(0);
    expect(await loadSession()).toEqual(STORED);
  });

  it('still lets go of a session whose key really is gone', async () => {
    const idb = setUp();
    await saveSession(STORED);
    idb.keys.clear();
    expect(await loadSession()).toBeNull();
    expect(localStorage.getItem('showrunner:session:v2')).toBeNull();
  });
});
