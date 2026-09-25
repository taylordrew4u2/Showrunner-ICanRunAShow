import { afterEach, describe, expect, it, vi } from 'vitest';
import { NOTICES_PROPERTY, noticesHeight, watchStatusRail } from './statusBand';

afterEach(() => vi.unstubAllGlobals());

describe('the page making room under the status rail', () => {
  it('adds exactly what the notices take, not the pill or the phone notch', () => {
    // Verified on a phone: a save-conflict notice put the rail at 217px over
    // a 40px band. The page has to move down by the notice, and only that.
    expect(noticesHeight(217, 40, 0)).toBe(177);
    expect(noticesHeight(264, 40, 47)).toBe(177);
  });

  it('adds nothing while the rail is only the pill', () => {
    expect(noticesHeight(40, 40, 0)).toBe(0);
    expect(noticesHeight(0, 40, 47)).toBe(0);
  });

  it('tells the stylesheet as the rail changes, and lets the defaults back when it goes', () => {
    let railHeight = 217;
    let onResize: (() => void) | null = null;
    class FakeResizeObserver {
      constructor(cb: () => void) { onResize = cb; }
      observe() {}
      disconnect() { onResize = null; }
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    vi.stubGlobal('getComputedStyle', () => ({ paddingTop: '0px' }));

    const pill = { getBoundingClientRect: () => ({ height: 40 }) };
    const rail = {
      querySelector: () => pill,
      getBoundingClientRect: () => ({ height: railHeight }),
    } as unknown as HTMLElement;
    const set = new Map<string, string>();
    const root = {
      style: {
        setProperty: (name: string, value: string) => set.set(name, value),
        removeProperty: (name: string) => set.delete(name),
      },
    } as unknown as HTMLElement;

    const stop = watchStatusRail(rail, root);
    expect(set.get(NOTICES_PROPERTY)).toBe('177px');

    // A confirm dialog hides the rail. The notice is still behind it, so
    // the page must not jump up under the dialog and back down after.
    railHeight = 0;
    onResize!();
    expect(set.get(NOTICES_PROPERTY)).toBe('177px');
    railHeight = 217;
    onResize!();

    // The producer dismisses the notice.
    railHeight = 40;
    onResize!();
    expect(set.get(NOTICES_PROPERTY)).toBe('0px');

    stop();
    expect(set.has(NOTICES_PROPERTY)).toBe(false);
  });
});
