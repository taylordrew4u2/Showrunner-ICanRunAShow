import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchWebsiteLineupSync } from './websiteLineupSync';

describe('automatic website lineup reconciliation', () => {
  let page: EventTarget & { visibilityState: DocumentVisibilityState };
  let win: EventTarget;
  let network: { onLine: boolean };
  let stop: (() => void) | undefined;

  function visibility(state: DocumentVisibilityState) {
    page.visibilityState = state;
    page.dispatchEvent(new Event('visibilitychange'));
  }

  function connect() {
    network.onLine = true;
    win.dispatchEvent(new Event('online'));
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    page = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
    win = new EventTarget();
    network = { onLine: true };
    vi.stubGlobal('document', page);
    vi.stubGlobal('window', win);
    vi.stubGlobal('navigator', network);
  });

  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('checks immediately and every minute while the owner is present', async () => {
    const attempt = vi.fn().mockResolvedValue({ status: 'reconciled' });
    stop = watchWebsiteLineupSync(attempt);
    expect(attempt).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(attempt).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(attempt).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it('pauses in the background and resumes on return without duplicate focus requests', async () => {
    const attempt = vi.fn().mockResolvedValue({ status: 'reconciled' });
    stop = watchWebsiteLineupSync(attempt);
    await vi.advanceTimersByTimeAsync(2_000);
    visibility('hidden');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(attempt).toHaveBeenCalledOnce();
    visibility('visible');
    win.dispatchEvent(new Event('focus'));
    expect(attempt).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it('waits for connectivity when launched offline and does not poll offline', async () => {
    network.onLine = false;
    const attempt = vi.fn().mockResolvedValue({ status: 'reconciled' });
    stop = watchWebsiteLineupSync(attempt);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(attempt).not.toHaveBeenCalled();
    connect();
    expect(attempt).toHaveBeenCalledOnce();
    network.onLine = false;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(attempt).toHaveBeenCalledOnce();
    connect();
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it('backs off retryable failures to one minute, then resets after success', async () => {
    const attempt = vi.fn().mockResolvedValue({ status: 'failed', retryable: true });
    stop = watchWebsiteLineupSync(attempt);
    for (const delay of [5_000, 10_000, 20_000, 40_000, 60_000, 60_000]) {
      const before = attempt.mock.calls.length;
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(attempt).toHaveBeenCalledTimes(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(attempt).toHaveBeenCalledTimes(before + 1);
    }
    attempt.mockResolvedValueOnce({ status: 'reconciled' });
    await vi.advanceTimersByTimeAsync(60_000);
    const afterSuccess = attempt.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(attempt).toHaveBeenCalledTimes(afterSuccess + 1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(attempt).toHaveBeenCalledTimes(afterSuccess + 2);
  });

  it('waits for a new signal after a permanent refusal, then retries unexpected rejections', async () => {
    const attempt = vi.fn()
      .mockResolvedValueOnce({ status: 'failed', retryable: false })
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue({ status: 'reconciled' });
    stop = watchWebsiteLineupSync(attempt);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(attempt).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    connect();
    expect(attempt).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it('does not poll an account with nothing to publish until return or reconnect', async () => {
    const attempt = vi.fn().mockResolvedValue({ status: 'skipped' });
    stop = watchWebsiteLineupSync(attempt);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(attempt).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    visibility('hidden');
    visibility('visible');
    expect(attempt).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    connect();
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it('coalesces reconnects during a slow request and waits past the completed-request cache before one fresh read', async () => {
    let resolve!: (value: { status: string; retryable: boolean }) => void;
    const attempt = vi.fn()
      .mockImplementationOnce(() => new Promise((done) => { resolve = done; }))
      .mockResolvedValue({ status: 'reconciled' });
    stop = watchWebsiteLineupSync(attempt);
    connect();
    connect();
    win.dispatchEvent(new Event('blur'));
    win.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(attempt).toHaveBeenCalledOnce();
    resolve({ status: 'failed', retryable: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(attempt).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(attempt).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(attempt).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it('spaces rapid completed requests instead of hammering on browser event bursts', async () => {
    const attempt = vi.fn().mockResolvedValue({ status: 'reconciled' });
    stop = watchWebsiteLineupSync(attempt);
    await vi.advanceTimersByTimeAsync(0);
    connect();
    connect();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(attempt).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it('cleanup cancels requests, listeners, and a late request completion', async () => {
    let resolve!: (value: { status: string; retryable: boolean }) => void;
    const attempt = vi.fn(() => new Promise<{ status: string; retryable: boolean }>((done) => { resolve = done; }));
    stop = watchWebsiteLineupSync(attempt);
    connect();
    stop();
    resolve({ status: 'failed', retryable: true });
    await vi.advanceTimersByTimeAsync(120_000);
    connect();
    visibility('hidden');
    visibility('visible');
    win.dispatchEvent(new Event('blur'));
    win.dispatchEvent(new Event('focus'));
    expect(attempt).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not start in a hidden page until it becomes visible', async () => {
    page.visibilityState = 'hidden';
    const attempt = vi.fn().mockResolvedValue({ status: 'skipped' });
    stop = watchWebsiteLineupSync(attempt);
    connect();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(attempt).not.toHaveBeenCalled();
    visibility('visible');
    expect(attempt).toHaveBeenCalledOnce();
  });
});
