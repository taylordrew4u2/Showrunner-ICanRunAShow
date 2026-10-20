import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOARD_HOLD_MS, boardHoldsRoom, createLivePublisher, restampPayload, type LiveViewPayload } from './liveView';
import type { SessionCredentials } from './session-vault';

const creds = { userId: 'u', authHash: 'h' } as SessionCredentials;

function onStage(name: string, lastUpdateMs: number, status: LiveViewPayload['status'] = 'running'): LiveViewPayload {
  return { showName: 'Test show', status, segment: { name }, totalSec: 300, remainingAtLastUpdate: 300, lastUpdateMs };
}

/** A fake server: each call takes the next answer off the list. */
function server(...answers: Array<'ok' | 'stale' | 'offline' | 403>) {
  const sent: LiveViewPayload[] = [];
  const send = vi.fn(async (_token: string, payload: LiveViewPayload) => {
    sent.push(payload);
    const answer = answers.shift() ?? 'ok';
    if (answer === 'offline') throw new Error('Failed to fetch');
    if (answer === 403) throw Object.assign(new Error('forbidden'), { status: 403 });
    return { stale: answer === 'stale' };
  });
  return { send, sent };
}

describe('getting the board to the room', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
  });
  afterEach(() => vi.useRealTimers());

  it('keeps sending a cue change that did not arrive until it does', async () => {
    // Venue wifi drops the POST for the headliner's cue. Nothing else is
    // pressed for the whole set, so nothing else would ever have sent it.
    const { send, sent } = server('offline', 'offline', 'ok');
    const publisher = createLivePublisher('tok', send, [1_000, 2_000]);
    publisher.publish(onStage('Headliner', 100_000), creds);
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(send).toHaveBeenCalledTimes(3);
    expect(sent[2].segment?.name).toBe('Headliner');
    // Landed: nothing more goes out.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('stamps a resend with when it is sent, and the clock with what is left by then', async () => {
    const { send, sent } = server('offline', 'ok');
    const publisher = createLivePublisher('tok', send, [3_000]);
    publisher.publish(onStage('Headliner', 100_000), creds);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(sent[1].lastUpdateMs).toBe(103_000);
    expect(sent[1].remainingAtLastUpdate).toBe(297);
  });

  it('sends again when the server keeps a newer state from a clock running ahead', async () => {
    // The note was saved from a laptop 20s fast; Start from the phone is
    // refused as a late arrival and the room stays on the pre-show screen.
    const { send } = server('stale', 'stale', 'ok');
    const publisher = createLivePublisher('tok', send, [1_000, 2_000]);
    publisher.publish(onStage('Host', 100_000), creds);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(send).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('drops a resend once the board has moved on, and sends the newer state instead', async () => {
    const { send, sent } = server('offline', 'ok', 'ok');
    const publisher = createLivePublisher('tok', send, [1_000]);
    publisher.publish(onStage('Opener', 100_000), creds);
    await vi.advanceTimersByTimeAsync(0);
    publisher.publish(onStage('Headliner', 100_500), creds);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sent.map((p) => p.segment?.name)).toEqual(['Opener', 'Headliner']);
  });

  it('keeps trying at the last spacing for as long as the connection is down', async () => {
    const { send } = server('offline', 'offline', 'offline', 'offline', 'ok');
    const publisher = createLivePublisher('tok', send, [1_000, 5_000]);
    publisher.publish(onStage('Headliner', 100_000), creds);
    await vi.advanceTimersByTimeAsync(1_000 + 5_000 + 5_000 + 5_000);
    expect(send).toHaveBeenCalledTimes(5);
  });

  it('does not keep asking after the server has said no', async () => {
    const { send } = server(403);
    const publisher = createLivePublisher('tok', send, [1_000]);
    publisher.publish(onStage('Headliner', 100_000), creds);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('restamping the room state', () => {
  it('counts a running clock down to the new time', () => {
    expect(restampPayload(onStage('A', 100_000), 110_000)).toMatchObject({ lastUpdateMs: 110_000, remainingAtLastUpdate: 290 });
  });

  it('leaves a paused clock where it is', () => {
    expect(restampPayload(onStage('A', 100_000, 'paused'), 110_000)).toMatchObject({ lastUpdateMs: 110_000, remainingAtLastUpdate: 300 });
  });
});

describe('whether the show page may put the pre-show screen back up', () => {
  const now = 1_000_000_000;

  it('leaves a board running the room from another device alone', () => {
    // The operator runs the night from a phone with Next and the pads and
    // never starts the timer, so the show still reads "upcoming". A co-host
    // opening the show on a tablet must not put "starting soon" back up.
    expect(boardHoldsRoom(onStage('Headliner', now - 30_000, 'paused'), now, null)).toBe(true);
    expect(boardHoldsRoom(onStage('Headliner', now - 30_000, 'running'), now, null)).toBe(true);
    expect(boardHoldsRoom(onStage('Host', now - 30_000, 'idle'), now, null)).toBe(true);
  });

  it('puts it back up over a pre-show screen, a finished board, or nothing', () => {
    expect(boardHoldsRoom(null, now, null)).toBe(false);
    expect(boardHoldsRoom(onStage('', now - 30_000, 'scheduled'), now, null)).toBe(false);
    expect(boardHoldsRoom(onStage('Closer', now - 30_000, 'ended'), now, null)).toBe(false);
  });

  it('does not count the board this device has just closed, still on its way out', () => {
    const closing = onStage('Closer', now - 1_000, 'ended');
    expect(boardHoldsRoom(onStage('Closer', now - 5_000, 'paused'), now, closing)).toBe(false);
  });

  it('lets go of a board that has said nothing for a whole night', () => {
    expect(boardHoldsRoom(onStage('Headliner', now - BOARD_HOLD_MS - 1, 'paused'), now, null)).toBe(false);
  });
});
