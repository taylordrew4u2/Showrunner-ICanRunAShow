/**
 * Co-producer view's edits, held until they are sent for approval.
 *
 * Every screen edits App's working copy exactly as it would edit the owner's
 * own data; this hook compares that copy with truth after each commit. While
 * they differ the unsent bar says so, and nothing goes anywhere until the
 * co-producer opens the review, sees every change beside what is there now,
 * and presses Send for approval. The rules are captureState.ts's; this runs
 * them against the page: timers, uploads, Run Show, the network, and the
 * draft kept when the page is put away.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AppSettings, Show } from '../types';
import { onStagingChange, stagedMediaIdSet, stagingInFlight } from '../utils/mediaStore';
import { clearUnsentDraft, saveUnsentDraft } from './boot';
import { buildEditPayload, noTapePeople, reviewDiffContext, sendBlocks, stagedMediaIds, type ReviewTruth } from './capture';
import { INITIAL_CAPTURE, reduceCapture, sendFailureFor, type CaptureEffect, type CaptureEvent, type CaptureState } from './captureState';
import { describePayload } from './diff';
import type { ProposalDialogState, SendFailure } from './ReviewContext';
import type { ChangeGroup, CoproducerClient, EditPayload } from './types';

export interface ProposalCapture {
  /** The working copy differs from truth in a way buildEditPayload keeps, and has not been sent. */
  dirty: boolean;
  /** For the bar: how many changes describePayload gives, 0 when clean. */
  count: number;
  /** Open the review step after the next render (the bar, Settings Save). */
  requestReview(): void;
  /** Put the working copy back to truth (the caller has confirmed). Waits while staging. */
  discard(): void;
  /** Close whatever step the dialog is on, as its OK or close button does. */
  dismiss(): void;
  /** An upload is staging: Send and Discard wait for it. */
  staging: boolean;
  sending: boolean;
  /** Everyone new in the unsent changes who has no tape, by name: the bar's no-tape sign. */
  noTape: readonly string[];
}

export interface ProposalCaptureArgs {
  active: boolean;
  loaded: boolean;
  shows: Show[];
  settings: AppSettings;
  truthRef: React.MutableRefObject<ReviewTruth | null>;
  client: CoproducerClient | null;
  linkId: string;
  /** Put state back to truth (App's resetToTruth). */
  reset(): void;
  /** Show the proposal dialog in a step, or close it with null. */
  onDialog(state: ProposalDialogState | null): void;
  /** Run Show is open: the bar hides and no dialog opens over it. */
  runShowOpen: boolean;
  /** A request landed: the requests list should look again. */
  onSent?(): void;
}

/** How long after the last change the working copy is measured. */
export const CAPTURE_SETTLE_MS = 300;

const RETRYABLE: ReadonlySet<SendFailure> = new Set(['offline', 'server']);
const DISCARDABLE: ReadonlySet<SendFailure> = new Set([
  'offline', 'server', 'too_big', 'too_many_open', 'storage_full_link', 'storage_full_account', 'unknown_media', 'invalid', 'no_tape',
]);

function changeCount(groups: ChangeGroup[]): number {
  return groups.reduce((sum, group) => sum + group.changes.length, 0);
}

type CaptureMachine = ReturnType<typeof createCaptureMachine>;

/**
 * The reducer bound to the page: events in, effects run. Outside the hook so
 * its timer and the change it last reviewed are plain variables of its own.
 */
function createCaptureMachine(first: ProposalCaptureArgs, publish: (state: CaptureState) => void) {
  let latest = first;
  const read = () => latest;
  let current: CaptureState = INITIAL_CAPTURE;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reviewed: { payload: EditPayload; groups: ChangeGroup[]; blocked: string[]; noTape: string[] } | null = null;
  /** Who in the working copy, as last measured, is new and has no tape. */
  let noTape: string[] = [];

  function tapeless(payload: EditPayload | null): string[] {
    const truth = read().truthRef.current;
    return payload && truth ? noTapePeople(payload, truth) : [];
  }

  function measure(): { payload: EditPayload | null; groups: ChangeGroup[] } {
    const { truthRef, shows, settings } = read();
    const truth = truthRef.current;
    if (!truth) return { payload: null, groups: [] };
    const payload = buildEditPayload(truth, { shows, settings });
    return { payload, groups: payload ? describePayload(payload, reviewDiffContext(truth)) : [] };
  }

  function failedStep(failure: SendFailure): ProposalDialogState {
    return {
      step: 'failed',
      failure,
      retry: RETRYABLE.has(failure) ? () => run({ type: 'sendStarted' }) : undefined,
      discard: DISCARDABLE.has(failure) ? () => run({ type: 'discardRequested' }) : undefined,
    };
  }

  function send(): void {
    const { client, onDialog } = read();
    const sending = reviewed;
    // Someone new without a name, a tape and social media: never sent, however Send was reached.
    if (!sending || !client || sending.blocked.length > 0) {
      const failure: SendFailure = sending && sending.noTape.length > 0 ? 'no_tape' : 'invalid';
      run({ type: 'sendFailed', failure });
      onDialog(failedStep(failure));
      return;
    }
    onDialog({ step: 'sending', groups: sending.groups });
    const mediaIds = stagedMediaIds(sending.payload, stagedMediaIdSet());
    client
      .createRequest({ kind: 'edit', payload: sending.payload, mediaIds })
      .then(() => {
        run({ type: 'sendSucceeded' });
        clearUnsentDraft();
        read().onDialog({ step: 'sent', groups: sending.groups });
        read().onSent?.();
      })
      .catch((err: unknown) => {
        const failure = sendFailureFor(err, typeof navigator === 'undefined' || navigator.onLine !== false);
        run({ type: 'sendFailed', failure });
        read().onDialog(failedStep(failure));
      });
  }

  function perform(effect: CaptureEffect): void {
    switch (effect) {
      case 'build': {
        clearTimeout(timer);
        const { payload, groups } = measure();
        noTape = tapeless(payload);
        run({ type: 'built', count: payload ? Math.max(1, changeCount(groups)) : 0 });
        return;
      }
      case 'openReview': {
        const measured = measure();
        if (!measured.payload) {
          run({ type: 'built', count: 0 });
          return;
        }
        const truth = read().truthRef.current;
        const blocked = truth ? sendBlocks(measured.payload, truth) : [];
        noTape = tapeless(measured.payload);
        reviewed = { payload: measured.payload, groups: measured.groups, blocked, noTape };
        read().onDialog({
          step: 'review',
          groups: measured.groups,
          blocked,
          noTape,
          send: () => run({ type: 'sendStarted' }),
          keepEditing: () => run({ type: 'reviewClosed' }),
          discard: () => run({ type: 'discardRequested' }),
        });
        return;
      }
      case 'send':
        send();
        return;
      case 'reset':
        clearTimeout(timer);
        read().reset();
        return;
      case 'closeDialog':
        read().onDialog(null);
        return;
    }
  }

  function run(event: CaptureEvent): void {
    const step = reduceCapture(current, event);
    current = step.state;
    publish(step.state);
    if (event.type === 'discardRequested' && step.effects.includes('reset')) clearUnsentDraft();
    for (const effect of step.effects) perform(effect);
  }

  return {
    run,
    /** The page's latest arguments, given after every render. */
    setArgs(args: ProposalCaptureArgs): void {
      latest = args;
    },
    state: () => current,
    noTape: () => noTape,
    linkId: () => latest.linkId,
    /** Measure once the working copy has been still for a moment. */
    settleLater(): void {
      clearTimeout(timer);
      timer = setTimeout(() => perform('build'), CAPTURE_SETTLE_MS);
    },
    stop(): void {
      clearTimeout(timer);
    },
    /** What to keep when the page is put away, or null when there is nothing. */
    draft(): { payload: EditPayload; mediaIds: string[] } | null {
      if (!current.dirty && !current.unbuilt) return null;
      const { payload } = measure();
      return payload ? { payload, mediaIds: stagedMediaIds(payload, stagedMediaIdSet()) } : null;
    },
  };
}

export function useProposalCapture(args: ProposalCaptureArgs): ProposalCapture {
  const [state, setState] = useState<CaptureState>(INITIAL_CAPTURE);
  const [machine] = useState<CaptureMachine>(() => createCaptureMachine(args, setState));
  useLayoutEffect(() => {
    machine.setArgs(args);
  });
  const [reviewTick, setReviewTick] = useState(0);
  const reviewAsked = useRef(false);

  const { active, loaded, shows, settings, truthRef, runShowOpen } = args;

  // After every commit that moves the working copy: clean at once if it is
  // truth again, otherwise measured once it has been still for a moment.
  useEffect(() => {
    if (!active || !loaded) return;
    const truth = truthRef.current;
    const identical = !!truth && shows === truth.shows && settings === truth.settings;
    machine.run({ type: 'changed', identical });
    if (!identical && !machine.state().reviewWanted) machine.settleLater();
  }, [active, loaded, shows, settings, truthRef, machine]);

  // Declared after the effect above, so a review asked for in the same tick
  // as a change is taken after that change is seen.
  useEffect(() => {
    if (!reviewAsked.current) return;
    reviewAsked.current = false;
    machine.run({ type: 'reviewRequested' });
  }, [reviewTick, machine]);

  useEffect(() => {
    if (!active) return;
    machine.run({ type: 'runShowChanged', open: runShowOpen });
  }, [active, runShowOpen, machine]);

  useEffect(() => {
    if (!active) return;
    const report = () => machine.run({ type: 'stagingChanged', staging: stagingInFlight() > 0 });
    report();
    return onStagingChange(report);
  }, [active, machine]);

  useEffect(() => {
    if (!active) return;
    const onOnline = () => machine.run({ type: 'online' });
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [active, machine]);

  // Put away with changes unsent: keep them sealed on this device, to be
  // offered back on the next visit rather than sent unseen.
  useEffect(() => {
    if (!active) return;
    function keep() {
      const draft = machine.draft();
      if (!draft) return;
      void saveUnsentDraft({ linkId: machine.linkId(), savedAt: new Date().toISOString(), ...draft });
    }
    function onVisibility() {
      if (document.visibilityState === 'hidden') keep();
    }
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', keep);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', keep);
    };
  }, [active, machine]);

  useEffect(() => () => machine.stop(), [machine]);

  return {
    dirty: active && state.dirty,
    count: active ? state.count : 0,
    requestReview: () => {
      reviewAsked.current = true;
      setReviewTick((tick) => tick + 1);
    },
    discard: () => machine.run({ type: 'discardRequested' }),
    dismiss: () => machine.run({ type: 'reviewClosed' }),
    staging: active && state.staging,
    sending: active && state.sending,
    noTape: active && state.dirty ? machine.noTape() : [],
  };
}
