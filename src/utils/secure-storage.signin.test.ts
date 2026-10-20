import { afterEach, describe, expect, it, vi } from 'vitest';
import { authenticateUser, createAccount } from './secure-storage';
import { deriveAuthKey, deriveUserId, hashPassword } from './encryption';

const PASSWORD = 'correct horse battery staple';
const USER = deriveUserId('producer');

/** Answer each POST to /api/auth in turn, and hand back the bodies that were sent. */
function answer(...replies: unknown[]) {
  const sent: Record<string, unknown>[] = [];
  vi.stubGlobal('fetch', vi.fn().mockImplementation((_path: string, init: RequestInit) => {
    sent.push(JSON.parse(init.body as string));
    const reply = replies[sent.length - 1];
    return Promise.resolve({ ok: true, status: 200, json: async () => reply } as Response);
  }));
  return sent;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('signing in', () => {
  it('sends only the per-account credential to an account that has it', async () => {
    const sent = answer({ ok: true });
    expect(await authenticateUser('Producer', PASSWORD)).toBe(true);
    expect(sent).toEqual([{ action: 'login', userId: USER, authKey: await deriveAuthKey(PASSWORD, USER) }]);
  });

  // The old hash cracks at SHA-256 speed, so it goes on the wire only when
  // the account asks for it to move over, and then only once.
  it('adds the old hash only when the account asks for it', async () => {
    const sent = answer({ ok: false, legacy: true }, { ok: true });
    expect(await authenticateUser('Producer', PASSWORD)).toBe(true);
    const authKey = await deriveAuthKey(PASSWORD, USER);
    expect(sent).toEqual([
      { action: 'login', userId: USER, authKey },
      { action: 'login', userId: USER, authKey, passwordHash: hashPassword(PASSWORD) },
    ]);
  });

  it('is refused on a wrong password without the old hash ever being sent', async () => {
    const sent = answer({ ok: false });
    expect(await authenticateUser('Producer', 'not the password')).toBe(false);
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toHaveProperty('passwordHash');
  });

  it('is refused when the old hash is wrong too', async () => {
    const sent = answer({ ok: false, legacy: true }, { ok: false });
    expect(await authenticateUser('Producer', 'not the password')).toBe(false);
    expect(sent).toHaveLength(2);
  });
});

describe('signing up', () => {
  it('sends the per-account credential and never the old hash', async () => {
    const sent = answer({ ok: true });
    await createAccount('Producer', PASSWORD);
    expect(sent).toEqual([{ action: 'signup', userId: USER, authKey: await deriveAuthKey(PASSWORD, USER) }]);
  });
});
