/**
 * The decisions behind co-producer view's unsent bar and its review dialog,
 * as a pure reducer: every event in, the next state and what to do out. The
 * hook (useProposalCapture) feeds it events and runs the effects; the rules
 * live here, where they can be tested without a page.
 *
 * The rules that matter:
 * - Nothing is ever sent without the review being asked for, the review
 *   step being shown, and Send for approval being pressed in it.
 * - The review waits while a file is uploading, while a send is on its way
 *   and while Run Show is open, and it always describes the latest change,
 *   including one made in the same tick as the ask.
 * - Discarding waits for an upload: the upload's own callback would
 *   otherwise land on a working copy it no longer belongs to.
 * - A send that failed for want of a connection is tried once more, by
 *   itself, when the browser comes back online.
 */
import { NO_TAPE_SIGN } from './newComics';
import type { SendFailure } from './ReviewContext';

export type CaptureEvent =
  /** The working copy changed. `identical` when it is truth itself again. */
  | { type: 'changed'; identical: boolean }
  /** The latest change has been measured: `count` changes, 0 when it means nothing. */
  | { type: 'built'; count: number }
  /** Review & send, or the Settings page's Save. */
  | { type: 'reviewRequested' }
  /** The review step was closed without sending (Keep editing, or a failure's OK). */
  | { type: 'reviewClosed' }
  | { type: 'stagingChanged'; staging: boolean }
  | { type: 'runShowChanged'; open: boolean }
  /** Send for approval, or Try again after a failure. */
  | { type: 'sendStarted' }
  | { type: 'sendSucceeded' }
  | { type: 'sendFailed'; failure: SendFailure }
  /** Discard, confirmed. */
  | { type: 'discardRequested' }
  | { type: 'online' };

/**
 * What the hook does next:
 * - build: measure the working copy now (a review is waiting on it);
 * - openReview: show the review step for the working copy as it is now;
 * - send: send the change that was reviewed;
 * - reset: put the working copy back to truth;
 * - closeDialog: take the dialog away.
 */
export type CaptureEffect = 'build' | 'openReview' | 'send' | 'reset' | 'closeDialog';

export interface CaptureState {
  /** The working copy asks for something and it has not been sent. */
  dirty: boolean;
  /** How many changes it asks for (for the bar), 0 when clean. */
  count: number;
  /** A change has landed and has not been measured since. */
  unbuilt: boolean;
  /** Review & send was pressed and the review step is not up yet. */
  reviewWanted: boolean;
  /** The review step, or a failure from sending it, is on screen. */
  reviewing: boolean;
  staging: boolean;
  runShowOpen: boolean;
  sending: boolean;
  /** Why the last send did not land, while that is still what the dialog says. */
  failure: SendFailure | null;
  /** The automatic retry on coming back online has been used for this failure. */
  retriedOnline: boolean;
  /** Discard was pressed during an upload, and refused. */
  discardRefused: boolean;
}

export const INITIAL_CAPTURE: CaptureState = {
  dirty: false,
  count: 0,
  unbuilt: false,
  reviewWanted: false,
  reviewing: false,
  staging: false,
  runShowOpen: false,
  sending: false,
  failure: null,
  retriedOnline: false,
  discardRefused: false,
};

export interface CaptureStep {
  state: CaptureState;
  effects: CaptureEffect[];
}

const CLEAN = { dirty: false, count: 0, unbuilt: false } as const;

/** Open the review once nothing stands in its way. */
function settle(state: CaptureState, effects: CaptureEffect[]): CaptureStep {
  if (!state.reviewWanted || state.unbuilt || state.staging || state.sending || state.runShowOpen) {
    return { state, effects };
  }
  if (!state.dirty) {
    // Nothing to review: the ask lapses, and whatever was on screen goes.
    const closing = state.reviewing ? [...effects, 'closeDialog' as const] : effects;
    return { state: { ...state, reviewWanted: false, reviewing: false }, effects: closing };
  }
  return {
    state: { ...state, reviewWanted: false, reviewing: true, failure: null },
    effects: [...effects, 'openReview'],
  };
}

export function reduceCapture(state: CaptureState, event: CaptureEvent): CaptureStep {
  switch (event.type) {
    case 'changed': {
      if (event.identical) {
        const next = { ...state, ...CLEAN };
        return settle(next, state.reviewing && !state.sending ? ['closeDialog'] : []);
      }
      const next = { ...state, unbuilt: true };
      return { state: next, effects: next.reviewWanted ? ['build'] : [] };
    }
    case 'built': {
      if (event.count === 0) {
        // Only bookkeeping changed: back to truth, quietly. Never during an
        // upload, whose callback is still to land on this copy.
        const next = { ...state, ...CLEAN };
        const effects: CaptureEffect[] = state.staging ? [] : ['reset'];
        if (state.reviewing && !state.sending) {
          effects.push('closeDialog');
          return settle({ ...next, reviewing: false }, effects);
        }
        return settle(next, effects);
      }
      return settle({ ...state, dirty: true, count: event.count, unbuilt: false }, []);
    }
    case 'reviewRequested': {
      const next = { ...state, reviewWanted: true, discardRefused: false };
      return settle(next, next.unbuilt ? ['build'] : []);
    }
    case 'reviewClosed':
      if (state.sending) return { state, effects: [] };
      return { state: { ...state, reviewing: false, reviewWanted: false, failure: null }, effects: ['closeDialog'] };
    case 'stagingChanged': {
      const next = { ...state, staging: event.staging, discardRefused: event.staging ? state.discardRefused : false };
      return settle(next, []);
    }
    case 'runShowChanged':
      return settle({ ...state, runShowOpen: event.open }, []);
    case 'sendStarted':
      if (!state.reviewing || !state.dirty || state.sending || state.staging || state.unbuilt) {
        return { state, effects: [] };
      }
      return { state: { ...state, sending: true, failure: null }, effects: ['send'] };
    case 'sendSucceeded':
      return {
        state: { ...state, ...CLEAN, sending: false, reviewing: false, reviewWanted: false, failure: null, retriedOnline: false },
        effects: ['reset'],
      };
    case 'sendFailed':
      return {
        state: { ...state, sending: false, reviewing: true, failure: event.failure, retriedOnline: false },
        effects: [],
      };
    case 'discardRequested':
      if (state.sending) return { state, effects: [] };
      if (state.staging) return { state: { ...state, discardRefused: true }, effects: [] };
      return {
        state: { ...state, ...CLEAN, reviewWanted: false, reviewing: false, failure: null, retriedOnline: false, discardRefused: false },
        effects: ['reset', 'closeDialog'],
      };
    case 'online':
      if (state.failure !== 'offline' || state.retriedOnline || state.sending || !state.dirty) {
        return { state, effects: [] };
      }
      return { state: { ...state, sending: true, failure: null, retriedOnline: true }, effects: ['send'] };
  }
}

/** The SendFailure an answer from POST ?route=requests means. */
export function sendFailureFor(err: unknown, online: boolean): SendFailure {
  const e = (err ?? {}) as { status?: number; code?: string; reason?: string; name?: string; detail?: string };
  if (e.code === 'unsupported_media' || e.reason === 'unsupported_media') return 'unsupported_media';
  if (e.name === 'ServerNotConfiguredError' || e.code === 'review_mode') return 'server';
  if (!online || e.status === undefined) return 'offline';
  if (e.status === 413 && e.code === 'payload_too_large') return 'too_big';
  if (e.status === 413 && e.code === 'coproducer_storage_full') {
    return e.reason === 'account_full' ? 'storage_full_account' : 'storage_full_link';
  }
  if (e.status === 409 && e.code === 'too_many_open_requests') return 'too_many_open';
  if (e.status === 409 && e.code === 'too_many_staged_files') return 'too_many_files';
  if (e.status === 400 && e.code === 'unknown_media') return 'unknown_media';
  // Refused for someone new with no tape: the server says the sign itself.
  if (e.status === 400 && e.detail === NO_TAPE_SIGN) return 'no_tape';
  if (e.status === 400) return 'invalid';
  return 'server';
}
