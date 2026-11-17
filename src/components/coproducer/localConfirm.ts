import type { ConfirmOptions } from '../useConfirm';

/**
 * A question that changes nothing in the account: the co-producer's own unsent
 * work or requests (discard them, withdraw one), or something local to the
 * screen (leave a page, restart the clock, which of two acts this is).
 *
 * In co-producer view useConfirm words a confirm as an edit to the unsent
 * copy, or as a request to the owner when the caller says it is one. These
 * are neither, so they keep their own words and buttons.
 */
export function localConfirm(options: Omit<ConfirmOptions, 'review' | 'asksOwner' | 'local'>): ConfirmOptions {
  // Never red: these were never a request, and were not styled as one before.
  return { ...options, danger: options.danger ?? false, local: true };
}
