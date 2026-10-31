/**
 * Mark the page while a modal dialog is open, for engines that cannot ask
 * CSS whether one is.
 *
 * The status rail steps out of the way of anything modal with
 * `body:has([aria-modal='true'])` (App.css). An engine without :has() — iOS
 * before 15.4, which the App Store build installs on, and Firefox before 121
 * — drops that rule whole, so the rail's opaque band and the sync pill sat
 * over the top of Run Show and every sheet. Where :has() works this does
 * nothing at all. Elsewhere it watches dialogs come and go and puts the same
 * answer on a class, so no dialog has to know the rail exists either way.
 */

/** On <body> while a modal dialog is open, where :has() can't say so. */
export const MODAL_OPEN_CLASS = 'has-modal';

export function markOpenDialogs(doc: Document = document): void {
  if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('selector(:has(*))')) return;
  if (typeof MutationObserver === 'undefined') return;
  const update = () => {
    doc.body.classList.toggle(MODAL_OPEN_CLASS, doc.querySelector('[aria-modal="true"]') !== null);
  };
  // Dialogs mount and unmount anywhere in the page, and one could turn
  // aria-modal on or off in place.
  new MutationObserver(update).observe(doc.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-modal'],
  });
  update();
}
