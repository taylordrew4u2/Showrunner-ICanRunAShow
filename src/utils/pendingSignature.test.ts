import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPendingSignature,
  loadPendingSignature,
  retryDelayMs,
  savePendingSignature,
} from './pendingSignature';

function installStorage(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  return store;
}

beforeEach(() => installStorage());
afterEach(() => vi.unstubAllGlobals());

/**
 * A signature given in a basement is still a signature. It waits for signal;
 * it is never refused, and the person is never told they cannot sign.
 */
describe('a signature waiting to be delivered', () => {
  it('survives the page being closed, ready to post unchanged', () => {
    savePendingSignature('tok', 'U2FsdGVkX1+ciphertext');
    expect(loadPendingSignature('tok')?.signature).toBe('U2FsdGVkX1+ciphertext');
  });

  it('is only ever the ciphertext, never the answers', () => {
    const store = installStorage();
    savePendingSignature('tok', 'U2FsdGVkX1+opaque');
    const written = store.get('showrunner:pending-signature:tok')!;
    expect(written).toContain('U2FsdGVkX1+opaque');
    expect(written).not.toContain('nadia@example.com');
  });

  it('is gone once the server has it', () => {
    savePendingSignature('tok', 'cipher');
    clearPendingSignature('tok');
    expect(loadPendingSignature('tok')).toBeNull();
  });

  it('keeps two contracts on one phone apart', () => {
    savePendingSignature('one', 'first');
    savePendingSignature('two', 'second');
    expect(loadPendingSignature('one')?.signature).toBe('first');
    expect(loadPendingSignature('two')?.signature).toBe('second');
  });

  it('does not fail the submission when storage refuses', () => {
    // A private window. The page keeps trying for as long as it is open; it
    // just cannot also survive being closed. Never a reason to say no.
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); },
    });
    expect(() => savePendingSignature('tok', 'cipher')).not.toThrow();
    expect(loadPendingSignature('tok')).toBeNull();
    expect(() => clearPendingSignature('tok')).not.toThrow();
  });

  it('ignores a stored entry that is not one', () => {
    localStorage.setItem('showrunner:pending-signature:tok', 'not json');
    expect(loadPendingSignature('tok')).toBeNull();
    localStorage.setItem('showrunner:pending-signature:tok', JSON.stringify({ signature: '' }));
    expect(loadPendingSignature('tok')).toBeNull();
    localStorage.setItem('showrunner:pending-signature:tok', JSON.stringify({ signature: 7 }));
    expect(loadPendingSignature('tok')).toBeNull();
  });

  it('asks again quickly at first and then settles, and never stops asking', () => {
    expect(retryDelayMs(0)).toBeLessThan(retryDelayMs(3));
    // A background tab all evening should not be a nuisance, and should not
    // ever be the reason a signature is lost.
    expect(retryDelayMs(99)).toBe(60_000);
    for (let attempt = 0; attempt < 200; attempt++) {
      expect(retryDelayMs(attempt)).toBeGreaterThan(0);
    }
  });
});
