/**
 * The only places the app reaches the clipboard or the share sheet to hand
 * something over, and the gate that holds them shut in co-producer view.
 *
 * In the owner's app the gate is open and these behave exactly as the calls
 * they replace. In co-producer view (enterReviewMode turns the gate on) they
 * refuse, and so do the file helpers that check deliveryAllowed(), unless
 * they run inside withApprovedDelivery: the one way an approved share or
 * download hands its item over, from the tap that asked for it.
 *
 * Imports nothing from review mode, which imports this, so the module graph
 * stays a tree.
 */
import { ReviewModeBlockedError } from './errors';

let gateOn = false;
let allowances = 0;

/** Turned on by enterReviewMode. */
export function setDeliveryGate(on: boolean): void {
  gateOn = on;
}

/** True while the gate is off (outside review mode), and inside withApprovedDelivery when it is on. */
export function deliveryAllowed(): boolean {
  return !gateOn || allowances > 0;
}

/**
 * Run `deliver` synchronously with delivery allowed. Only what it does before
 * returning is allowed: the file helpers and these two check the gate before
 * their first await, which is also what keeps them inside the tap that iOS
 * needs for the share sheet and downloads.
 */
export function withApprovedDelivery<T>(deliver: () => T): T {
  allowances += 1;
  try {
    return deliver();
  } finally {
    allowances -= 1;
  }
}

/** navigator.clipboard.writeText. Rejects with ReviewModeBlockedError when !deliveryAllowed(), and when there is no clipboard. */
export function copyText(text: string): Promise<void> {
  if (!deliveryAllowed()) return Promise.reject(new ReviewModeBlockedError());
  const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
  if (!clipboard) return Promise.reject(new Error('No clipboard here.'));
  return clipboard.writeText(text);
}

/** Whether this browser has a share sheet for links. */
export function canShareLinks(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

/**
 * Hand a link over: the share sheet where there is one, else the clipboard.
 *
 * Title and URL only. A `text` beside them is not an addition: share targets
 * pick between the members they support, and one that takes only text sends
 * the sentence and drops the link. Closing the share sheet is 'cancelled',
 * not a failure; anything else that goes wrong rejects. Same refusal as
 * copyText, checked before anything else.
 */
export async function shareLink(title: string, url: string): Promise<'shared' | 'copied' | 'cancelled'> {
  if (!deliveryAllowed()) throw new ReviewModeBlockedError();
  if (canShareLinks()) {
    try {
      await navigator.share({ title, url });
      return 'shared';
    } catch (err) {
      if ((err as Error | null)?.name === 'AbortError') return 'cancelled';
      throw err;
    }
  }
  await copyText(url);
  return 'copied';
}
