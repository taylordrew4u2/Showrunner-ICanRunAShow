import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const review = vi.hoisted(() => ({ on: false }));
vi.mock('../coproducer/reviewMode', () => ({ isReviewMode: () => review.on }));

import { EMPTY_GUIDE, guideKey, readGuide, updateGuide, writeGuide, type GuideState } from './guideStore';

function fakeStorage() {
  const held = new Map<string, string>();
  return {
    held,
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => { held.set(key, value); },
    removeItem: (key: string) => { held.delete(key); },
  };
}

let storage: ReturnType<typeof fakeStorage>;

beforeEach(() => {
  review.on = false;
  storage = fakeStorage();
  vi.stubGlobal('localStorage', storage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const PAUSED: GuideState = { ...EMPTY_GUIDE, offer: 'dismissed', tour: { status: 'paused', stepId: 'sync' } };

describe('what the guide remembers on this device', () => {
  it('reads as never opened when nothing is stored, or what is stored cannot be used', () => {
    expect(readGuide('pat')).toEqual(EMPTY_GUIDE);
    storage.held.set(guideKey('pat'), '{not json');
    expect(readGuide('pat')).toEqual(EMPTY_GUIDE);
    storage.held.set(guideKey('pat'), JSON.stringify({ ...PAUSED, v: 2 }));
    expect(readGuide('pat')).toEqual(EMPTY_GUIDE);
    storage.held.set(guideKey('pat'), JSON.stringify(['v', 1]));
    expect(readGuide('pat')).toEqual(EMPTY_GUIDE);
  });

  it('keeps each account on the device apart, whichever way the name was typed', () => {
    writeGuide('Pat', PAUSED);
    expect(guideKey(' PAT ')).toBe('showrunner:guide:pat');
    expect(readGuide('pat')).toEqual(PAUSED);
    expect(readGuide('sam')).toEqual(EMPTY_GUIDE);
    writeGuide('sam', { ...EMPTY_GUIDE, offer: 'show' });
    expect(readGuide('pat').offer).toBe('dismissed');
    expect(readGuide('sam').offer).toBe('show');
  });

  // The tour never reopens itself on a cold start: it is picked up by hand.
  it('reads a tour that was left running as stopped at the same step', () => {
    writeGuide('pat', { ...EMPTY_GUIDE, tour: { status: 'active', stepId: 'lineup' }, wizard: { id: 'rolodex', stepId: 'add' } });
    const read = readGuide('pat');
    expect(read.tour).toEqual({ status: 'paused', stepId: 'lineup' });
    expect(read.wizard).toBeUndefined();
  });

  it('keeps what was ticked, which row was open and what this device saw', () => {
    const state: GuideState = {
      ...EMPTY_GUIDE,
      openWizard: 'music',
      checked: { music: ['trim'], live: ['night'] },
      facts: { ranShow: true },
      tour: { status: 'done' },
    };
    writeGuide('pat', state);
    expect(readGuide('pat')).toEqual(state);
  });

  it('drops anything of the wrong shape rather than trusting it', () => {
    storage.held.set(guideKey('pat'), JSON.stringify({
      v: 1, offer: 'loud', tour: { status: 'flying', stepId: 7 }, checked: { music: 'trim', live: ['night', 3] }, facts: { ranShow: 'yes' },
    }));
    expect(readGuide('pat')).toEqual({ ...EMPTY_GUIDE, checked: { live: ['night'] } });
  });

  it('carries on from memory when the browser will not store anything', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('full'); },
    });
    expect(readGuide('pat')).toEqual(EMPTY_GUIDE);
    expect(() => writeGuide('pat', PAUSED)).not.toThrow();
    expect(() => updateGuide('pat', (state) => ({ ...state, offer: 'show' }))).not.toThrow();
  });

  it('changes one thing and leaves the rest', () => {
    writeGuide('pat', PAUSED);
    updateGuide('pat', (state) => ({ ...state, offer: 'show' }));
    expect(readGuide('pat')).toEqual({ ...PAUSED, offer: 'show' });
  });

  // A co-producer's browser is not the owner's device.
  it('writes nothing in co-producer view', () => {
    review.on = true;
    writeGuide('coproducer:abc', PAUSED);
    updateGuide('coproducer:abc', (state) => ({ ...state, offer: 'show' }));
    expect(storage.held.size).toBe(0);
  });
});
