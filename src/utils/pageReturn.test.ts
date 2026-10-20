import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onPageReturn } from './pageReturn';

describe('noticing the producer come back to the page', () => {
  let page: EventTarget & { visibilityState: DocumentVisibilityState };
  let win: EventTarget;

  function hide() {
    page.visibilityState = 'hidden';
    page.dispatchEvent(new Event('visibilitychange'));
  }
  function show() {
    page.visibilityState = 'visible';
    page.dispatchEvent(new Event('visibilitychange'));
  }

  beforeEach(() => {
    page = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
    win = new EventTarget();
    vi.stubGlobal('document', page);
    vi.stubGlobal('window', win);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls back when the page is shown again after being hidden', () => {
    // The iOS app sent to the background for Safari, then brought back.
    const back = vi.fn();
    onPageReturn(back);
    hide();
    expect(back).not.toHaveBeenCalled();
    show();
    expect(back).toHaveBeenCalledOnce();
  });

  it('calls back when the window gets focus back', () => {
    const back = vi.fn();
    onPageReturn(back);
    win.dispatchEvent(new Event('blur'));
    win.dispatchEvent(new Event('focus'));
    expect(back).toHaveBeenCalledOnce();
  });

  it('counts one return once, though the page showing and the window focusing both say so', () => {
    const back = vi.fn();
    onPageReturn(back);
    win.dispatchEvent(new Event('blur'));
    hide();
    show();
    win.dispatchEvent(new Event('focus'));
    expect(back).toHaveBeenCalledOnce();

    hide();
    show();
    expect(back).toHaveBeenCalledTimes(2);
  });

  it('ignores focus that was never lost', () => {
    const back = vi.fn();
    onPageReturn(back);
    win.dispatchEvent(new Event('focus'));
    show();
    expect(back).not.toHaveBeenCalled();
  });

  it('counts a page that was already hidden when it started listening as away', () => {
    page.visibilityState = 'hidden';
    const back = vi.fn();
    onPageReturn(back);
    show();
    expect(back).toHaveBeenCalledOnce();
  });

  it('stops listening once unsubscribed', () => {
    const back = vi.fn();
    const stop = onPageReturn(back);
    stop();
    hide();
    show();
    win.dispatchEvent(new Event('blur'));
    win.dispatchEvent(new Event('focus'));
    expect(back).not.toHaveBeenCalled();
  });
});
