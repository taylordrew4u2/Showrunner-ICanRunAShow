/**
 * How a lineup is doing against the number of performers it's booking for.
 *
 * Two screens ask this now — the Performers section, which has room for a
 * sentence, and the show card on the grid, which has one line and a colour.
 * They have to agree on what "full" means, so neither computes it: both call
 * this.
 *
 * Only performers count toward the target. The field is "Performers wanted",
 * and a show can carry artists as well — folding those in would let a bill fill
 * up without a single performer booked.
 */

export interface LineupProgress {
  /** False when no target is set: a lineup with no target has no "full". */
  targetSet: boolean;
  booked: number;
  target: number;
  /** Negative once the bill is overbooked. */
  spotsLeft: number;
  full: boolean;
  /** How many past the target, 0 when not over. */
  over: number;
  /** The long form: "3 of 5 booked · 2 spots left". Empty with no target. */
  label: string;
  /** The one-line form for a card: "3 of 5 booked" / "Full · 5 of 5". */
  shortLabel: string;
}

export function lineupProgress(booked: number, target: number | undefined): LineupProgress {
  const targetSet = typeof target === 'number' && Number.isFinite(target) && target > 0;
  if (!targetSet) {
    return {
      targetSet: false,
      booked,
      target: 0,
      spotsLeft: 0,
      full: false,
      over: 0,
      label: '',
      shortLabel: '',
    };
  }

  const spotsLeft = target - booked;
  const over = spotsLeft < 0 ? -spotsLeft : 0;
  const full = spotsLeft <= 0;

  return {
    targetSet: true,
    booked,
    target,
    spotsLeft,
    full,
    over,
    label: full
      ? over > 0
        ? `Full — ${booked} booked, ${over} over`
        : `Full — ${booked} of ${target} booked`
      : `${booked} of ${target} booked · ${spotsLeft} spot${spotsLeft === 1 ? '' : 's'} left`,
    // The card has one line shared with the runtime and the host, so the count
    // carries the meaning and the colour carries "full".
    shortLabel: full
      ? over > 0
        ? `Full · ${booked} of ${target}, ${over} over`
        : `Full · ${booked} of ${target}`
      : `${booked} of ${target} booked`,
  };
}
