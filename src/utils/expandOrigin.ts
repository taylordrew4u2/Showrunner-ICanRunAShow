// Where the show-detail expand animation should grow from: the centre of the
// card you tapped, expressed as a percentage of the main scroll area so the
// CSS can use it directly.
//
// This lives apart from the click handler because it is decoration, and
// decoration must not be able to break navigation. Anything unusable — a
// zero-size container, a detached element, a NaN — returns null so the caller
// can skip the animation and still open the show.

/** The part of DOMRect this needs, so it can be exercised without a browser. */
export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ExpandOrigin {
  x: number;
  y: number;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function expandOriginFrom(card: RectLike | null | undefined, main: RectLike | null | undefined): ExpandOrigin | null {
  if (!card || !main) return null;
  // A container with no area gives no meaningful origin, and dividing by it
  // yields Infinity or NaN — which reaches CSS as an invalid custom property
  // and silently disables the very animation this is for.
  if (!(main.width > 0) || !(main.height > 0)) return null;

  const x = ((card.left + card.width / 2 - main.left) / main.width) * 100;
  const y = ((card.top + card.height / 2 - main.top) / main.height) * 100;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  return { x: clampPercent(x), y: clampPercent(y) };
}
