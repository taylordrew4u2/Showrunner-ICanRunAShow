/**
 * Finding the real control a step is about, and outlining it.
 *
 * Controls carry a `data-tour` id. A step lists a few in order of preference
 * and the first one actually on screen wins, so the same step points at the
 * Rolodex tab on a phone and at the menu button on a laptop, and at the lock
 * note where a Producer-only control is not rendered at all. No match is
 * fine: the step still shows, without an outline.
 */

/** Set on the outlined element. guide.css draws the outline from it. */
export const OUTLINE_ATTRIBUTE = 'data-tour-on';

/** The least a root has to do, so a test can hand in a fake one. */
export interface TargetRoot {
  querySelectorAll(selector: string): ArrayLike<Element>;
}

/** On screen, not inert, and not part of the guide's own card (which can show a lock note of its own). */
function onScreen(element: Element): boolean {
  return element.getClientRects().length > 0 && element.closest('[inert], .guide-dock') === null;
}

/** The first element, across the selectors in order, that is on screen and not inert. */
export function resolveTarget(selectors: readonly string[], root: TargetRoot = document): HTMLElement | null {
  for (const selector of selectors) {
    const matches = root.querySelectorAll(selector);
    for (let i = 0; i < matches.length; i++) {
      if (onScreen(matches[i])) return matches[i] as HTMLElement;
    }
  }
  return null;
}

export function applyOutline(element: HTMLElement): void {
  element.setAttribute(OUTLINE_ATTRIBUTE, '');
}

export function clearOutline(element: HTMLElement | null): void {
  element?.removeAttribute(OUTLINE_ATTRIBUTE);
}

/** The edges of a box on screen, as getBoundingClientRect gives them. */
export interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Room kept between the control and the top of the card. */
export const CARD_GAP = 12;

/**
 * How far to scroll the page down so the control ends above the card.
 *
 * Zero when it is already clear, when it sits beside the card rather than
 * under it (a laptop's card is on the right), or when the card is hidden.
 * Never so far that the control's top goes above `topLimit`, the band at the
 * top of the screen its scroll margin keeps clear.
 */
export function scrollToClear(target: Box, card: Box | null, topLimit: number, gap = CARD_GAP): number {
  if (!card || card.bottom <= card.top) return 0;
  if (target.right <= card.left || target.left >= card.right) return 0;
  const over = target.bottom - (card.top - gap);
  if (over < 1) return 0;
  const room = target.top - topLimit;
  return Math.max(0, Math.ceil(Math.min(over, room)));
}

/** The box that scrolls the element: the nearest scrolling ancestor, else the page. */
function scrollerOf(element: HTMLElement): Element {
  for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node;
  }
  return document.scrollingElement ?? document.documentElement;
}

/**
 * Scroll the control up out from under the page's guide card, if it is under
 * it. Says whether it scrolled. The live board's card is in the flow and
 * covers nothing, so there is nothing to do there.
 */
export function scrollClearOfCard(target: HTMLElement, behavior: ScrollBehavior): boolean {
  if (target.closest('.run-show')) return false;
  const card = document.querySelector('.guide-dock--app');
  const topLimit = parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
  const by = scrollToClear(target.getBoundingClientRect(), card?.getBoundingClientRect() ?? null, topLimit);
  if (by <= 0) return false;
  scrollerOf(target).scrollBy({ top: by, behavior });
  return true;
}

const FOCUSABLE ='button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** What "Jump to the control" focuses: the target itself, else the first control inside it. */
export function focusableIn(target: HTMLElement): HTMLElement | null {
  if (target.matches(FOCUSABLE)) return target;
  const inside = target.querySelectorAll<HTMLElement>(FOCUSABLE);
  for (let i = 0; i < inside.length; i++) {
    if (onScreen(inside[i])) return inside[i];
  }
  return null;
}
