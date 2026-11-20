import { describe, expect, it } from 'vitest';
import { resolveTarget, scrollToClear, type Box, type TargetRoot } from './targets';

/** As much of an element as resolveTarget looks at. */
function element(name: string, options: { shown?: boolean; inside?: string } = {}): Element {
  return {
    name,
    getClientRects: () => ({ length: options.shown === false ? 0 : 1 }),
    closest: (selector: string) => (options.inside && selector.includes(options.inside) ? {} : null),
  } as unknown as Element;
}

function root(found: Record<string, Element[]>): TargetRoot {
  return { querySelectorAll: (selector: string) => found[selector] ?? [] };
}

const name = (target: Element | null) => (target as unknown as { name: string } | null)?.name ?? null;

describe('finding the control a step is about', () => {
  it('takes the first selector that has something on screen', () => {
    const page = root({ '[data-tour="a"]': [element('a')], '[data-tour="b"]': [element('b')] });
    expect(name(resolveTarget(['[data-tour="a"]', '[data-tour="b"]'], page))).toBe('a');
    expect(name(resolveTarget(['[data-tour="b"]', '[data-tour="a"]'], page))).toBe('b');
  });

  // The Rolodex tab inside the closed desktop menu has no boxes, so the step
  // points at the menu button instead, with no check of the screen's width.
  it('skips what is in the page but not on screen', () => {
    const page = root({
      '[data-tour="nav-rolodex"]': [element('tab', { shown: false })],
      '[data-tour="nav-toggle"]': [element('menu')],
    });
    expect(name(resolveTarget(['[data-tour="nav-rolodex"]', '[data-tour="nav-toggle"]'], page))).toBe('menu');
  });

  it('takes a later match of the same selector when the first is hidden', () => {
    const page = root({ '[data-tour="shows-new"]': [element('header', { shown: false }), element('empty-state')] });
    expect(name(resolveTarget(['[data-tour="shows-new"]'], page))).toBe('empty-state');
  });

  it('skips anything inert, and the lock note inside the guide’s own card', () => {
    const page = root({
      '[data-tour="x"]': [element('behind-a-dialog', { inside: '[inert]' })],
      '[data-tour="producer-lock"]': [element('in-the-card', { inside: '.guide-dock' }), element('on-the-page')],
    });
    expect(resolveTarget(['[data-tour="x"]'], page)).toBeNull();
    expect(name(resolveTarget(['[data-tour="x"]', '[data-tour="producer-lock"]'], page))).toBe('on-the-page');
  });

  it('finds nothing when nothing matches: the step still shows, without an outline', () => {
    expect(resolveTarget(['[data-tour="missing"]'], root({}))).toBeNull();
    expect(resolveTarget([], root({ '[data-tour="a"]': [element('a')] }))).toBeNull();
  });
});

describe('keeping the control clear of the card', () => {
  const box = (top: number, bottom: number, left = 16, right = 374): Box => ({ top, bottom, left, right });
  // An iPhone 13: the card's top edge a little over a third of the way down.
  const phoneCard = box(268, 600, 8, 382);
  const STATUS_BAND = 140;

  // "More sections": the button at 251-295 with the card's top at 268.
  it('scrolls a control that is under the card up to just above it', () => {
    expect(scrollToClear(box(251, 295), phoneCard, STATUS_BAND)).toBe(39);
    // Half under it, as the empty Music library's upload button was.
    expect(scrollToClear(box(240, 284), phoneCard, STATUS_BAND)).toBe(28);
  });

  it('scrolls a control sitting wholly behind the card or below the screen', () => {
    expect(scrollToClear(box(400, 444), phoneCard, STATUS_BAND)).toBe(188);
    expect(scrollToClear(box(900, 944), phoneCard, STATUS_BAND)).toBe(688);
  });

  it('leaves a control that is already clear alone', () => {
    expect(scrollToClear(box(150, 250), phoneCard, STATUS_BAND)).toBe(0);
    expect(scrollToClear(box(150, 256), phoneCard, STATUS_BAND)).toBe(0);
    expect(scrollToClear(box(150, 256.5), phoneCard, STATUS_BAND)).toBe(0);
  });

  it('never pushes the control up under the band at the top', () => {
    expect(scrollToClear(box(200, 500), phoneCard, STATUS_BAND)).toBe(60);
    expect(scrollToClear(box(120, 300), phoneCard, STATUS_BAND)).toBe(0);
  });

  // A laptop's card sits on the right: a control to its left is not under it.
  it('leaves a control beside the card alone', () => {
    const laptopCard = box(500, 860, 1036, 1416);
    expect(scrollToClear(box(700, 740, 300, 900), laptopCard, STATUS_BAND)).toBe(0);
    expect(scrollToClear(box(700, 740, 1100, 1300), laptopCard, STATUS_BAND)).toBe(252);
  });

  it('does nothing while the card is hidden, under a dialog', () => {
    expect(scrollToClear(box(400, 444), null, STATUS_BAND)).toBe(0);
    expect(scrollToClear(box(400, 444), box(0, 0, 0, 0), STATUS_BAND)).toBe(0);
  });
});
