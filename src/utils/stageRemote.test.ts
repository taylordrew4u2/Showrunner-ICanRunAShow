import { describe, it, expect } from 'vitest';
import { describeKey, explainFailure, isRemotePress, keyFromEvent } from './stageRemote';

describe('keyFromEvent', () => {
  it('accepts the keys a clicker usually sends', () => {
    for (const k of ['Enter', ' ', 'a', 'ArrowRight', 'PageDown']) {
      expect(keyFromEvent(k)).toEqual({ ok: true, key: k });
    }
  });

  it('rejects volume keys, which the OS never passes on', () => {
    // The common selfie-clicker case, and the one worth naming out loud.
    expect(keyFromEvent('AudioVolumeUp')).toEqual({ ok: false, reason: 'os-key' });
  });

  it('rejects keys the app needs for itself', () => {
    expect(keyFromEvent('Escape')).toEqual({ ok: false, reason: 'reserved' });
    expect(keyFromEvent('Meta')).toEqual({ ok: false, reason: 'reserved' });
  });
});

describe('describeKey', () => {
  it('names keys the way a person would', () => {
    expect(describeKey(' ')).toBe('Space');
    expect(describeKey('a')).toBe('A');
    expect(describeKey('ArrowRight')).toBe('Right arrow');
    expect(describeKey('Enter')).toBe('Enter');
  });
});

describe('isRemotePress', () => {
  it('is false when nothing is paired', () => {
    expect(isRemotePress('Enter', undefined)).toBe(false);
  });

  it('matches the bound key', () => {
    expect(isRemotePress('Enter', 'Enter')).toBe(true);
    expect(isRemotePress('Enter', ' ')).toBe(false);
  });

  it('ignores case for a single character, so a shifted press still fires', () => {
    expect(isRemotePress('B', 'b')).toBe(true);
    expect(isRemotePress('b', 'B')).toBe(true);
  });

  it('does not loosen the match for named keys', () => {
    expect(isRemotePress('arrowright', 'ArrowRight')).toBe(false);
  });
});

describe('explainFailure', () => {
  it('says what to do about a volume-key remote', () => {
    expect(explainFailure('os-key')).toMatch(/iOS\/Android switch|pedal/);
  });
});
