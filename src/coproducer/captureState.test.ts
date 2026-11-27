import { describe, expect, it } from 'vitest';
import { INITIAL_CAPTURE, reduceCapture, sendFailureFor, type CaptureEffect, type CaptureEvent, type CaptureState } from './captureState';

/** Feed events in order; the final state and every effect asked for on the way. */
function play(events: CaptureEvent[], from: CaptureState = INITIAL_CAPTURE): { state: CaptureState; effects: CaptureEffect[] } {
  let state = from;
  const effects: CaptureEffect[] = [];
  for (const event of events) {
    const step = reduceCapture(state, event);
    state = step.state;
    effects.push(...step.effects);
  }
  return { state, effects };
}

const EDITED: CaptureEvent[] = [{ type: 'changed', identical: false }, { type: 'built', count: 2 }];

describe('reduceCapture', () => {
  it('becomes dirty once a change is measured, and clean when the copy is truth again', () => {
    const edited = play(EDITED);
    expect(edited.state).toMatchObject({ dirty: true, count: 2, unbuilt: false });
    expect(edited.effects).toEqual([]);
    expect(play([{ type: 'changed', identical: true }], edited.state).state).toMatchObject({ dirty: false, count: 0 });
  });

  it('resets quietly when a change means nothing, but never during an upload', () => {
    expect(play([{ type: 'changed', identical: false }, { type: 'built', count: 0 }]).effects).toEqual(['reset']);
    const uploading = play([{ type: 'stagingChanged', staging: true }, { type: 'changed', identical: false }, { type: 'built', count: 0 }]);
    expect(uploading.effects).toEqual([]);
    expect(uploading.state.dirty).toBe(false);
  });

  it('never sends without a review asked for and the dialog’s send', () => {
    // A send with no review open does nothing.
    expect(play([...EDITED, { type: 'sendStarted' }]).effects).toEqual([]);
    // Asked for, shown, then sent.
    const sent = play([...EDITED, { type: 'reviewRequested' }, { type: 'sendStarted' }]);
    expect(sent.effects).toEqual(['openReview', 'send']);
    expect(sent.state.sending).toBe(true);
    // Only one at a time.
    expect(play([{ type: 'sendStarted' }], sent.state).effects).toEqual([]);
  });

  it('waits to open the review while staging, sending or in Run Show', () => {
    const staging = play([...EDITED, { type: 'stagingChanged', staging: true }, { type: 'reviewRequested' }]);
    expect(staging.effects).toEqual([]);
    expect(play([{ type: 'stagingChanged', staging: false }], staging.state).effects).toEqual(['openReview']);

    const running = play([...EDITED, { type: 'runShowChanged', open: true }, { type: 'reviewRequested' }]);
    expect(running.effects).toEqual([]);
    expect(play([{ type: 'runShowChanged', open: false }], running.state).effects).toEqual(['openReview']);

    const sending = play([...EDITED, { type: 'reviewRequested' }, { type: 'sendStarted' }]);
    const again = play([{ type: 'reviewRequested' }], sending.state);
    expect(again.effects).toEqual([]);
    expect(play([{ type: 'sendFailed', failure: 'server' }], again.state).state.reviewing).toBe(true);
  });

  it('sees a change made in the same tick as the ask', () => {
    const asked = play([...EDITED, { type: 'changed', identical: false }, { type: 'reviewRequested' }]);
    // The newest change is measured first, then the review opens on it.
    expect(asked.effects).toEqual(['build']);
    expect(asked.state.reviewWanted).toBe(true);
    const opened = play([{ type: 'built', count: 3 }], asked.state);
    expect(opened.effects).toEqual(['openReview']);
    expect(opened.state.count).toBe(3);
  });

  it('lets a review asked for with nothing changed lapse', () => {
    const lapsed = play([{ type: 'reviewRequested' }]);
    expect(lapsed.effects).toEqual([]);
    expect(lapsed.state.reviewWanted).toBe(false);
    // And one whose change turns out to mean nothing closes and resets.
    const empty = play([{ type: 'changed', identical: false }, { type: 'reviewRequested' }, { type: 'built', count: 0 }]);
    expect(empty.effects).toEqual(['build', 'reset']);
    expect(empty.state).toMatchObject({ dirty: false, reviewWanted: false, reviewing: false });
  });

  it('refuses to discard during an upload, and discards after', () => {
    const uploading = play([...EDITED, { type: 'stagingChanged', staging: true }, { type: 'discardRequested' }]);
    expect(uploading.effects).toEqual([]);
    expect(uploading.state).toMatchObject({ dirty: true, discardRefused: true });
    const done = play([{ type: 'stagingChanged', staging: false }, { type: 'discardRequested' }], uploading.state);
    expect(done.effects).toEqual(['reset', 'closeDialog']);
    expect(done.state).toMatchObject({ dirty: false, discardRefused: false });
  });

  it('cleans up on success and keeps the copy on failure', () => {
    const sending = play([...EDITED, { type: 'reviewRequested' }, { type: 'sendStarted' }]).state;
    const ok = play([{ type: 'sendSucceeded' }], sending);
    expect(ok.effects).toEqual(['reset']);
    expect(ok.state).toMatchObject({ dirty: false, sending: false, reviewing: false });
    const failed = play([{ type: 'sendFailed', failure: 'too_big' }], sending);
    expect(failed.effects).toEqual([]);
    expect(failed.state).toMatchObject({ dirty: true, sending: false, reviewing: true, failure: 'too_big' });
    // Try again from the failure.
    expect(play([{ type: 'sendStarted' }], failed.state).effects).toEqual(['send']);
  });

  it('closes the review on Keep editing, keeping the change', () => {
    const open = play([...EDITED, { type: 'reviewRequested' }]).state;
    const closed = play([{ type: 'reviewClosed' }], open);
    expect(closed.effects).toEqual(['closeDialog']);
    expect(closed.state).toMatchObject({ dirty: true, reviewing: false });
  });

  it('retries an offline failure once when the browser comes back online', () => {
    const sending = play([...EDITED, { type: 'reviewRequested' }, { type: 'sendStarted' }]).state;
    const offline = play([{ type: 'sendFailed', failure: 'offline' }], sending).state;
    const back = play([{ type: 'online' }], offline);
    expect(back.effects).toEqual(['send']);
    const twice = play([{ type: 'sendFailed', failure: 'offline' }, { type: 'online' }], back.state);
    // A fresh failure earns its own retry; the same one never two.
    expect(twice.effects).toEqual(['send']);
    const once = play([{ type: 'online' }], twice.state);
    expect(once.effects).toEqual([]);
    expect(play([{ type: 'online' }], play([{ type: 'sendFailed', failure: 'server' }], sending).state).effects).toEqual([]);
  });
});

describe('sendFailureFor', () => {
  const err = (status: number | undefined, code?: string, reason?: string) => Object.assign(new Error(code ?? 'x'), { status, code, reason });

  it('maps every refusal to what the dialog says', () => {
    expect(sendFailureFor(err(undefined), true)).toBe('offline');
    expect(sendFailureFor(err(500), false)).toBe('offline');
    expect(sendFailureFor(err(413, 'payload_too_large'), true)).toBe('too_big');
    expect(sendFailureFor(err(409, 'too_many_open_requests'), true)).toBe('too_many_open');
    expect(sendFailureFor(err(413, 'coproducer_storage_full', 'link_full'), true)).toBe('storage_full_link');
    expect(sendFailureFor(err(413, 'coproducer_storage_full', 'account_full'), true)).toBe('storage_full_account');
    expect(sendFailureFor(err(409, 'too_many_staged_files'), true)).toBe('too_many_files');
    expect(sendFailureFor(err(400, 'unknown_media'), true)).toBe('unknown_media');
    expect(sendFailureFor(err(400, 'bad_request'), true)).toBe('invalid');
    // Refused for someone new with no tape: the server says so in the sign's own words.
    expect(sendFailureFor(Object.assign(err(400, 'bad_request'), { detail: "Sorry, you can't submit without a tape." }), true)).toBe('no_tape');
    expect(sendFailureFor(Object.assign(err(400, 'bad_request'), { detail: 'something else' }), true)).toBe('invalid');
    expect(sendFailureFor(err(409, 'media_in_use'), true)).toBe('server');
    expect(sendFailureFor(err(502), true)).toBe('server');
    expect(sendFailureFor(Object.assign(new Error('x'), { name: 'ServerNotConfiguredError' }), true)).toBe('server');
    expect(sendFailureFor(Object.assign(new Error('x'), { code: 'review_mode', reason: 'unsupported_media' }), true)).toBe('unsupported_media');
  });
});
