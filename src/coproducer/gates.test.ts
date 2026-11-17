import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReviewModeBlockedError } from './errors';
import { canShareLinks, copyText, deliveryAllowed, setDeliveryGate, shareLink, withApprovedDelivery } from './gates';

function stubNavigator(nav: Partial<Navigator>) {
  vi.stubGlobal('navigator', nav);
}

afterEach(() => {
  setDeliveryGate(false);
  vi.unstubAllGlobals();
});

describe('the delivery gate', () => {
  it('is open in the owner’s app', () => {
    expect(deliveryAllowed()).toBe(true);
  });

  it('holds shut in co-producer view, except inside an approved delivery', () => {
    setDeliveryGate(true);
    expect(deliveryAllowed()).toBe(false);
    expect(withApprovedDelivery(() => deliveryAllowed())).toBe(true);
    expect(deliveryAllowed()).toBe(false);
  });

  it('allows only what runs before the delivery returns', async () => {
    setDeliveryGate(true);
    const later = withApprovedDelivery(async () => {
      await Promise.resolve();
      return deliveryAllowed();
    });
    expect(await later).toBe(false);
  });

  it('closes again when the delivery throws', () => {
    setDeliveryGate(true);
    expect(() => withApprovedDelivery(() => { throw new Error('boom'); })).toThrow('boom');
    expect(deliveryAllowed()).toBe(false);
  });
});

describe('copying', () => {
  it('copies as before in the owner’s app', async () => {
    const writeText = vi.fn(async () => {});
    stubNavigator({ clipboard: { writeText } as unknown as Clipboard });
    await copyText('hello');
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('refuses in co-producer view, before touching the clipboard', async () => {
    const writeText = vi.fn(async () => {});
    stubNavigator({ clipboard: { writeText } as unknown as Clipboard });
    setDeliveryGate(true);
    await expect(copyText('hello')).rejects.toBeInstanceOf(ReviewModeBlockedError);
    expect(writeText).not.toHaveBeenCalled();
    await withApprovedDelivery(() => copyText('approved'));
    expect(writeText).toHaveBeenCalledWith('approved');
  });

  it('rejects where there is no clipboard', async () => {
    stubNavigator({});
    await expect(copyText('hello')).rejects.toThrow();
  });
});

describe('sharing a link', () => {
  it('uses the share sheet where there is one, with the title and the URL only', async () => {
    const share = vi.fn(async () => {});
    stubNavigator({ share });
    expect(canShareLinks()).toBe(true);
    expect(await shareLink('Agreement', 'https://x.example/sign?t=1')).toBe('shared');
    expect(share).toHaveBeenCalledWith({ title: 'Agreement', url: 'https://x.example/sign?t=1' });
  });

  it('copies where there is no share sheet', async () => {
    const writeText = vi.fn(async () => {});
    stubNavigator({ clipboard: { writeText } as unknown as Clipboard });
    expect(canShareLinks()).toBe(false);
    expect(await shareLink('Agreement', 'https://x.example')).toBe('copied');
    expect(writeText).toHaveBeenCalledWith('https://x.example');
  });

  it('reads a closed share sheet as cancelled, and anything else as a failure', async () => {
    stubNavigator({ share: vi.fn(async () => { throw Object.assign(new Error('closed'), { name: 'AbortError' }); }) });
    expect(await shareLink('t', 'u')).toBe('cancelled');
    stubNavigator({ share: vi.fn(async () => { throw new Error('denied'); }) });
    await expect(shareLink('t', 'u')).rejects.toThrow('denied');
  });

  it('refuses in co-producer view without opening the share sheet', async () => {
    const share = vi.fn(async () => {});
    stubNavigator({ share });
    setDeliveryGate(true);
    await expect(shareLink('t', 'u')).rejects.toBeInstanceOf(ReviewModeBlockedError);
    expect(share).not.toHaveBeenCalled();
    expect(await withApprovedDelivery(() => shareLink('t', 'u'))).toBe('shared');
  });
});
