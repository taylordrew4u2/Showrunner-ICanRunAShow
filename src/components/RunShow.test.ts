import { describe, expect, it, vi } from 'vitest';
import { holdScreenAwake, type ScreenAwakeNavigator, type ScreenAwakeDocument } from './RunShow';

/** A screen wake lock the test hands out and can watch being released. */
function sentinel() {
  return { release: vi.fn(() => Promise.resolve()) };
}

/** A navigator whose wake lock requests settle when the test says so. */
function fakeNavigator() {
  const pending: Array<(s: ReturnType<typeof sentinel>) => void> = [];
  const nav: ScreenAwakeNavigator = {
    wakeLock: {
      request: vi.fn(() => new Promise<ReturnType<typeof sentinel>>((resolve) => pending.push(resolve))),
    },
  };
  return {
    nav,
    /** Settle the oldest outstanding request with a fresh lock. */
    grant() {
      const s = sentinel();
      pending.shift()!(s);
      return s;
    },
  };
}

function fakeDocument(): ScreenAwakeDocument & { show: () => void } {
  const listeners = new Set<() => void>();
  return {
    visibilityState: 'visible',
    addEventListener: (_type, fn) => { listeners.add(fn); },
    removeEventListener: (_type, fn) => { listeners.delete(fn); },
    show() {
      for (const fn of listeners) fn();
    },
  };
}

const settle = () => new Promise<void>((r) => setTimeout(r, 0));

describe('Run Show holding the screen awake', () => {
  it('lets the screen sleep again once the board is closed', async () => {
    const { nav, grant } = fakeNavigator();
    const release = holdScreenAwake(nav, fakeDocument());
    const lock = grant();
    await settle();
    release();
    await settle();
    expect(lock.release).toHaveBeenCalledTimes(1);
  });

  it('releases a lock the browser hands over after the board has already closed', async () => {
    const { nav, grant } = fakeNavigator();
    const release = holdScreenAwake(nav, fakeDocument());
    // Closed before the browser answered — Escape straight after opening.
    release();
    const late = grant();
    await settle();
    expect(late.release).toHaveBeenCalledTimes(1);
  });

  it('does not hold two locks after the tab comes back into view', async () => {
    const { nav, grant } = fakeNavigator();
    const doc = fakeDocument();
    const release = holdScreenAwake(nav, doc);
    const first = grant();
    await settle();
    doc.show();
    const second = grant();
    await settle();
    expect(first.release).toHaveBeenCalledTimes(1);
    expect(second.release).not.toHaveBeenCalled();
    release();
    await settle();
    expect(second.release).toHaveBeenCalledTimes(1);
  });

  it('stops re-requesting the lock once the board is closed', () => {
    const { nav } = fakeNavigator();
    const doc = fakeDocument();
    const release = holdScreenAwake(nav, doc);
    release();
    doc.show();
    expect(nav.wakeLock!.request).toHaveBeenCalledTimes(1);
  });

  it('carries on without a lock in a browser that has none', () => {
    expect(() => holdScreenAwake({}, fakeDocument())()).not.toThrow();
  });
});
