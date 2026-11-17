import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Modal } from './Modal';
import { useReview } from '../coproducer/ReviewContext';
import './useConfirm.css';

/**
 * A confirmation prompt that doesn't stop the page.
 *
 * Everything destructive in this app used to go through `window.confirm`,
 * which is the one browser API that halts the event loop until the user
 * answers. In a plain desktop tab you get away with it. Inside the installed
 * app — an iOS WKWebView under Capacitor, or a standalone PWA — the native
 * panel can fail to present while the page is mid-transition, and because the
 * call blocks, the page it was called from stops responding with it. A delete
 * button that can hang the app is worse than no confirmation at all.
 *
 * So the prompt is the app's own Modal now: rendered, not blocking. The call
 * site keeps the shape it had —
 *
 *   if (await confirm('Delete this?')) { ... }
 *
 * — so it still reads as a question asked before the damage is done, and the
 * answer still arrives before the next line runs.
 *
 * `confirm` hears every way out of the dialog that isn't the confirm button as
 * "no", which is right for a deletion. A question whose two buttons are both
 * real answers uses `ask` instead: it resolves null when the dialog is backed
 * out of — Escape, a tap outside it, the screen going away — so dismissing it
 * is not taken as choosing whichever answer sits on the cancel button.
 */

export interface ConfirmOptions {
  /** The question. Say what will happen, and whether it can be undone. */
  message: string;
  title?: string;
  /** The verb on the confirm button. Name the action — a button that says
   *  "Delete" on a prompt about ending a show is worse than no label. */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button as destructive. Defaults to true, since most of
   *  these are deletions — pass false for anything that doesn't destroy data. */
  danger?: boolean;
  /**
   * The words for co-producer view, for a confirm that asks the owner rather
   * than doing it. Giving them marks the confirm as one (see reviewConfirm).
   */
  review?: { title?: string; message?: string; confirmLabel?: string };
  /** In co-producer view, confirming sends a request to the owner: worded as one, with the generic words. */
  asksOwner?: boolean;
  /**
   * Not a change to the account at all (leave a page, restart the clock,
   * which of two acts this is, discard unsent work): the same words in
   * co-producer view as anywhere. See coproducer/localConfirm.
   */
  local?: boolean;
}

/**
 * Sentences that are not true of a request: nothing happens until the owner
 * approves it. A sentence ends at a question or exclamation mark too, so the
 * question a confirm asks stays when the warning after it goes.
 */
const NOT_SO_FOR_A_REQUEST = /[^.?!]*\b(?:cannot|can't|can’t) be undone\.|[^.?!]*\bstraight away\.|[^.?!]*\bstop(?:s)? working\b[^.?!]*\./gi;

/**
 * A confirmation as co-producer view asks it. Pressing it sends a request to
 * the owner, so it is never a red, irreversible button, and it never says
 * something is about to stop working: nothing changes until the owner
 * approves.
 */
export function reviewConfirm(options: ConfirmOptions): ConfirmOptions {
  const review = options.review ?? {};
  const kept = options.message.replace(NOT_SO_FOR_A_REQUEST, '').replace(/\s+/g, ' ').trim();
  const message = review.message ?? [kept, 'Nothing changes until the owner approves.'].filter(Boolean).join(' ');
  return {
    ...options,
    title: review.title ?? options.title ?? 'Ask the owner?',
    message,
    confirmLabel: review.confirmLabel ?? 'Ask the owner',
    danger: false,
  };
}

/** The line an edit's confirm gets in co-producer view: confirming it sends nothing to anyone yet. */
export const NOT_SENT_YET = 'Nothing is sent until you press Review & send.';

/**
 * A confirmation for an edit in co-producer view. Confirming it changes the
 * co-producer's own unsent copy and nothing else, so it keeps its own words
 * and buttons ("Delete", "Remove from show": what happens to that copy), is
 * never red, drops what is not so of an unsent change, and says that nothing
 * has gone to the owner. Calling it "Ask the owner" read as if the request
 * had already gone, when it waits for Review & send.
 */
export function workingCopyConfirm(options: ConfirmOptions): ConfirmOptions {
  const kept = options.message.replace(NOT_SO_FOR_A_REQUEST, '').replace(/\s+/g, ' ').trim();
  return { ...options, message: [kept, NOT_SENT_YET].filter(Boolean).join(' '), danger: false };
}

/**
 * How a confirm reads in co-producer view. The rewrite into a request to the
 * owner is opt-in: every confirm used to get it, and a question that asks the
 * owner nothing came out wrong ("Leave without saving?" with a button reading
 * "Ask the owner" that threw the edits away; "Same person" against "Ask the
 * owner" where the answer was "Different act").
 */
export function confirmInReview(options: ConfirmOptions): ConfirmOptions {
  if (options.local) return options;
  if (options.review || options.asksOwner) return reviewConfirm(options);
  return workingCopyConfirm(options);
}

export function useConfirm() {
  const reviewing = useReview().active;
  const [pending, setPending] = useState<ConfirmOptions | null>(null);
  const resolveRef = useRef<((answer: boolean | null) => void) | null>(null);

  // A pending promise outlives the component if the screen changes under it
  // (navigating away, the show closing). Settle it as unanswered rather than
  // leaving a caller awaiting something that can never settle.
  useEffect(() => {
    return () => {
      resolveRef.current?.(null);
      resolveRef.current = null;
    };
  }, []);

  /** The confirm button's answer is true, the cancel button's false, and backing out null. */
  const ask = useCallback((options: ConfirmOptions | string) => {
    const given = typeof options === 'string' ? { message: options } : options;
    const opts = reviewing ? confirmInReview(given) : given;
    // A second question while one is open would strand the first promise.
    // The last one asked is the one on screen, so settle the earlier one.
    resolveRef.current?.(null);
    setPending(opts);
    return new Promise<boolean | null>((resolve) => {
      resolveRef.current = resolve;
    });
  }, [reviewing]);

  const confirm = useCallback(
    (options: ConfirmOptions | string) => ask(options).then((answer) => answer === true),
    [ask],
  );

  const settle = useCallback((answer: boolean | null) => {
    setPending(null);
    resolveRef.current?.(answer);
    resolveRef.current = null;
  }, []);

  // Portalled to <body> so the caller can drop {confirmDialog} anywhere in its
  // JSX without thinking about it. The overlay is fixed-position, and a fixed
  // element is positioned against the nearest ancestor with a transform or a
  // filter rather than the viewport — which, rendered in place, would make the
  // dialog's behaviour depend on whatever card or panel happened to contain it.
  const confirmDialog = pending ? createPortal(
    <Modal onClose={() => settle(null)} labelledBy="confirm-dialog-title">
      {/* No stock "Are you sure?" above a message that already asks a
          question — it just pushed the real words down a line. A caller with
          something to add sets a title; otherwise the question is the heading
          as far as assistive tech is concerned. */}
      {pending.title && (
        <h2 className="confirm-dialog__title" id="confirm-dialog-title">
          {pending.title}
        </h2>
      )}
      <p
        className="confirm-dialog__message"
        id={pending.title ? undefined : 'confirm-dialog-title'}
      >
        {pending.message}
      </p>
      <div className="confirm-dialog__actions">
        {/* Cancel comes first in the DOM so it takes the modal's initial
            focus. On a destructive prompt the safe answer is the one that
            should be a keystroke away, not the irreversible one. */}
        <button type="button" className="btn btn--ghost" onClick={() => settle(false)}>
          {pending.cancelLabel ?? 'Cancel'}
        </button>
        <button
          type="button"
          className={`btn ${pending.danger === false ? 'btn--primary' : 'btn--danger'}`}
          onClick={() => settle(true)}
        >
          {pending.confirmLabel ?? 'Delete'}
        </button>
      </div>
    </Modal>,
    document.body,
  ) : null;

  // For callers that run their own global keyboard shortcuts. A rendered
  // dialog doesn't stop a window-level keydown listener the way the old
  // blocking window.confirm did — that one froze the event loop, which is
  // precisely what made it safe and what made it unusable. Anything listening
  // outside the dialog has to know to stand down while a question is on screen.
  return { confirm, ask, confirmDialog, confirmOpen: pending !== null };
}
