import { afterEach, describe, expect, it, vi } from 'vitest';
import { deliverFile, deliveryProblem, isDelivered, type FileDelivery } from './download';

const inTheApp = { Capacitor: { isNativePlatform: () => true } };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** A page that records any download link clicked in it. */
function stubPage() {
  const link = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
  const createElement = vi.fn(() => link);
  const revoke = vi.fn();
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:file', revokeObjectURL: revoke });
  vi.stubGlobal('document', { createElement, body: { appendChild: vi.fn() } });
  return { link, createElement, revoke };
}

describe('saving a file in a browser', () => {
  it('uses the browser download and keeps the link alive until the browser has read it', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', {});
    const { link, revoke } = stubPage();

    expect(await deliverFile(new Blob(['zip']), 'Late Set headshots.zip')).toBe('downloaded');
    expect(link).toMatchObject({ href: 'blob:file', download: 'Late Set headshots.zip' });
    expect(link.click).toHaveBeenCalledOnce();
    // iOS Safari and Firefox read the file after click() returns.
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(revoke).toHaveBeenCalledWith('blob:file');
  });

  it('does not reach for the share sheet, even where there is one', async () => {
    vi.stubGlobal('window', {});
    stubPage();
    const share = vi.fn();
    vi.stubGlobal('navigator', { share, canShare: () => true });
    await deliverFile(new Blob(['{}'], { type: 'application/json' }), 'backup.json');
    expect(share).not.toHaveBeenCalled();
  });
});

describe('saving a file in the iOS app', () => {
  // Capacitor cancels every top-level load that is not the live site, a
  // blob: download included, and says nothing to the page.
  it('hands the file to the share sheet with its name and type, and clicks no download link', async () => {
    vi.stubGlobal('window', inTheApp);
    const { createElement } = stubPage();
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { share, canShare: () => true });

    const outcome = await deliverFile(new Blob(['{}'], { type: 'application/json' }), 'showrunner-backup-2026-10-31.json');

    expect(outcome).toBe('shared');
    expect(share).toHaveBeenCalledOnce();
    const [{ files }] = share.mock.calls[0] as [{ files: File[] }];
    expect(files.map((f) => [f.name, f.type])).toEqual([['showrunner-backup-2026-10-31.json', 'application/json']]);
    expect(createElement).not.toHaveBeenCalled();
  });

  it('says it failed, rather than clicking a link that goes nowhere, when files cannot be shared', async () => {
    vi.stubGlobal('window', inTheApp);
    const { createElement } = stubPage();
    const share = vi.fn();
    vi.stubGlobal('navigator', { share, canShare: () => false });

    expect(await deliverFile(new Blob(['x']), 'DJ-List.txt')).toBe('failed');
    expect(share).not.toHaveBeenCalled();
    expect(createElement).not.toHaveBeenCalled();
  });

  it('says it failed where there is no share sheet at all', async () => {
    vi.stubGlobal('window', inTheApp);
    stubPage();
    vi.stubGlobal('navigator', {});
    expect(await deliverFile(new Blob(['x']), 'DJ-List.txt')).toBe('failed');
  });

  it('reads a refused share for what it means', async () => {
    vi.stubGlobal('window', inTheApp);
    stubPage();
    const refuse = (error: unknown) =>
      vi.stubGlobal('navigator', { share: vi.fn().mockRejectedValue(error), canShare: () => true });

    refuse(new DOMException('closed', 'AbortError'));
    expect(await deliverFile(new Blob(['x']), 'flyer.jpg')).toBe('cancelled');
    refuse(new DOMException('no gesture', 'NotAllowedError'));
    expect(await deliverFile(new Blob(['x']), 'flyer.jpg')).toBe('needs-tap');
    refuse(new TypeError('bad data'));
    expect(await deliverFile(new Blob(['x']), 'flyer.jpg')).toBe('failed');
  });
});

describe('what the person is told', () => {
  it('counts a file as delivered only once it reached them', () => {
    // The backup is recorded as taken on this answer alone.
    const outcomes: FileDelivery[] = ['downloaded', 'shared', 'cancelled', 'needs-tap', 'failed'];
    expect(outcomes.filter(isDelivered)).toEqual(['downloaded', 'shared']);
  });

  it('says nothing when it worked or the sheet was closed on purpose', () => {
    expect(deliveryProblem('downloaded')).toBeNull();
    expect(deliveryProblem('shared')).toBeNull();
    expect(deliveryProblem('cancelled')).toBeNull();
  });

  it('asks for another tap when the first one went stale, and says where else to get it when the app cannot', () => {
    expect(deliveryProblem('needs-tap')).toMatch(/tap again/i);
    expect(deliveryProblem('failed')).toMatch(/Safari/);
  });
});
