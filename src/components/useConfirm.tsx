import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Modal } from './Modal';
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
}

export function useConfirm() {
  const [pending, setPending] = useState<ConfirmOptions | null>(null);
  const resolveRef = useRef<((ok: boolean) => void) | null>(null);

  // A pending promise outlives the component if the screen changes under it
  // (navigating away, the show closing). Answer it "no" rather than leaving a
  // caller awaiting something that can never settle.
  useEffect(() => {
    return () => {
      resolveRef.current?.(false);
      resolveRef.current = null;
    };
  }, []);

  const confirm = useCallback((options: ConfirmOptions | string) => {
    const opts = typeof options === 'string' ? { message: options } : options;
    // A second question while one is open would strand the first promise.
    // The last one asked is the one on screen, so settle the earlier one.
    resolveRef.current?.(false);
    setPending(opts);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const settle = useCallback((ok: boolean) => {
    setPending(null);
    resolveRef.current?.(ok);
    resolveRef.current = null;
  }, []);

  // Portalled to <body> so the caller can drop {confirmDialog} anywhere in its
  // JSX without thinking about it. The overlay is fixed-position, and a fixed
  // element is positioned against the nearest ancestor with a transform or a
  // filter rather than the viewport — which, rendered in place, would make the
  // dialog's behaviour depend on whatever card or panel happened to contain it.
  const confirmDialog = pending ? createPortal(
    <Modal onClose={() => settle(false)} labelledBy="confirm-dialog-title">
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
  return { confirm, confirmDialog, confirmOpen: pending !== null };
}
