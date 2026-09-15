import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSignerDraft, loadSignerDraft, saveSignerDraft } from './signerDraft';

/** A localStorage that behaves, since the tests run in node. */
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

describe('what a signer has typed', () => {
  it('comes back after the page is reloaded', () => {
    // A long agreement's worth of answers, and a backgrounded tab the phone
    // decided to reclaim. Retyping it is where someone gives up.
    saveSignerDraft('tok', {
      signerName: 'Nadia Okonjo',
      typedName: 'N. Okonjo',
      values: { email: 'nadia@example.com', credits: 'Two festivals and a late-night set' },
      agreed: true,
    });

    expect(loadSignerDraft('tok')).toEqual({
      signerName: 'Nadia Okonjo',
      typedName: 'N. Okonjo',
      values: { email: 'nadia@example.com', credits: 'Two festivals and a late-night set' },
      agreed: true,
    });
  });

  it('keeps two contracts on one phone apart', () => {
    saveSignerDraft('one', { signerName: 'Nadia' });
    saveSignerDraft('two', { signerName: 'Dev' });
    expect(loadSignerDraft('one')?.signerName).toBe('Nadia');
    expect(loadSignerDraft('two')?.signerName).toBe('Dev');
  });

  it('is gone once it has been signed', () => {
    saveSignerDraft('tok', { signerName: 'Nadia', agreed: true });
    clearSignerDraft('tok');
    expect(loadSignerDraft('tok')).toBeNull();
  });

  it('never keeps the headshot, which would fill the quota and take the words with it', () => {
    const store = installStorage();
    saveSignerDraft('tok', { signerName: 'Nadia', values: { email: 'a@b.example' } });
    expect(store.get('showrunner:signing:tok')).not.toContain('data:image');
  });

  it('survives a private window, where storage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); },
    });
    // The page still has to work. It just forgets.
    expect(() => saveSignerDraft('tok', { signerName: 'Nadia' })).not.toThrow();
    expect(loadSignerDraft('tok')).toBeNull();
    expect(() => clearSignerDraft('tok')).not.toThrow();
  });

  it('ignores anything that is not a draft', () => {
    localStorage.setItem('showrunner:signing:tok', 'not json');
    expect(loadSignerDraft('tok')).toBeNull();
    localStorage.setItem('showrunner:signing:tok', '"a string"');
    expect(loadSignerDraft('tok')).toBeNull();
    localStorage.setItem('showrunner:signing:tok', JSON.stringify({ signerName: 42, values: 'no' }));
    expect(loadSignerDraft('tok')).toEqual({
      signerName: undefined,
      typedName: undefined,
      values: undefined,
      agreed: false,
    });
  });

  it('does nothing at all without a token', () => {
    expect(loadSignerDraft('')).toBeNull();
    expect(() => saveSignerDraft('', { signerName: 'x' })).not.toThrow();
  });
});
