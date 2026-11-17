import { describe, expect, it } from 'vitest';
import type { CoproducerRequestView } from './types';
import { controlState, newestFor, sendOnce, stateOf } from './useReviewContextValue';

function request(id: string, over: Partial<CoproducerRequestView> = {}): CoproducerRequestView {
  return {
    id,
    kind: 'download',
    status: 'pending',
    createdAt: '2026-11-17T10:00:00.000Z',
    decidedAt: null,
    usedAt: null,
    outline: { kind: 'download', action: { type: 'flyer', key: 'download:flyer:s1', showId: 's1' } },
    result: null,
    ...over,
  };
}

describe('newestFor', () => {
  it('finds the newest request for one action by its key, and nothing for another', () => {
    const older = request('a', { createdAt: '2026-11-17T09:00:00.000Z', status: 'rejected' });
    const newer = request('b', { createdAt: '2026-11-17T11:00:00.000Z' });
    const other = request('c', { outline: { kind: 'download', action: { type: 'flyer', key: 'download:flyer:s2', showId: 's2' } } });
    expect(newestFor([older, newer, other], 'download:flyer:s1')?.id).toBe('b');
    expect(newestFor([older, other], 'download:flyer:s9')).toBeNull();
    expect(newestFor([request('e', { kind: 'edit', outline: { kind: 'edit' } })], 'download:flyer:s1')).toBeNull();
  });
});

describe('stateOf', () => {
  const prepared = { ready: { label: 'Approved — tap to download', deliver: async () => 'done' as const } };

  it('says what the control should say for each status', () => {
    expect(stateOf(null, undefined)).toEqual({ state: 'none' });
    expect(stateOf(request('a'), undefined)).toEqual({ state: 'pending', requestId: 'a' });
    expect(stateOf(request('a', { status: 'stale' }), undefined)).toEqual({ state: 'stale', requestId: 'a' });
    expect(stateOf(request('a', { status: 'rejected' }), undefined)).toEqual({ state: 'rejected', requestId: 'a' });
    expect(stateOf(request('a', { status: 'withdrawn' }), undefined)).toEqual({ state: 'none' });
  });

  it('is getting ready until an approval is prepared, then approved, then used', () => {
    const approved = request('a', { status: 'approved' });
    expect(stateOf(approved, undefined)).toEqual({ state: 'preparing', requestId: 'a' });
    expect(stateOf(approved, prepared)).toEqual({ state: 'approved', requestId: 'a' });
    expect(stateOf({ ...approved, usedAt: '2026-11-17T12:00:00.000Z' }, prepared)).toEqual({ state: 'used', requestId: 'a' });
    // Nothing left to hand over: the control goes back to asking.
    expect(stateOf(approved, { gone: true })).toEqual({ state: 'none' });
  });
});

// Two quick taps on a slow connection made two requests for one download.
describe('sendOnce', () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('sends one ask per action until the first has settled, then allows another', async () => {
    const inFlight = new Set<string>();
    let finish: () => void = () => {};
    let sent = 0;
    const send = () => {
      sent += 1;
      return new Promise<void>((resolve) => { finish = resolve; });
    };
    let changes = 0;
    const onChange = () => { changes += 1; };

    expect(sendOnce(inFlight, 'download:backup', send, onChange)).toBe(true);
    expect(sendOnce(inFlight, 'download:backup', send, onChange)).toBe(false);
    expect(sent).toBe(1);
    expect(inFlight.has('download:backup')).toBe(true);
    // Another action is an ask of its own.
    expect(sendOnce(inFlight, 'download:flyer:s1', () => Promise.resolve(), onChange)).toBe(true);

    finish();
    await settle();
    expect(inFlight.size).toBe(0);
    expect(changes).toBe(4);
    expect(sendOnce(inFlight, 'download:backup', send, onChange)).toBe(true);
    expect(sent).toBe(2);
  });

  it('lets the action be asked again after a failed ask', async () => {
    const inFlight = new Set<string>();
    expect(sendOnce(inFlight, 'download:backup', () => Promise.reject(new Error('offline')), () => {})).toBe(true);
    await settle();
    expect(inFlight.size).toBe(0);
  });
});

describe('controlState', () => {
  it('is sending while its own ask is out, whatever the list says, and otherwise where its newest request stands', () => {
    const key = 'download:flyer:s1';
    expect(controlState([], new Map(), new Set([key]), key)).toEqual({ state: 'sending' });
    expect(controlState([request('a', { status: 'rejected' })], new Map(), new Set([key]), key)).toEqual({ state: 'sending' });
    expect(controlState([request('a')], new Map(), new Set(['download:flyer:s2']), key)).toEqual({ state: 'pending', requestId: 'a' });
    expect(controlState([], new Map(), new Set(), key)).toEqual({ state: 'none' });
  });
});
