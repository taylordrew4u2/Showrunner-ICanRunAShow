/**
 * Reading a start time out of whatever a producer actually typed.
 *
 * A run sheet does not say "21:00". It says "Doors 8:30 Show 9", "8pm doors,
 * 8:30 show", "9pm". The field asked for one clock time and refused everything
 * else, which meant the most natural thing to type was the one thing that
 * stopped the job — and the producer was sent to another screen to retype a
 * fact they had already written down.
 *
 * So this reads the sentence instead of demanding a format. Two things come
 * out of it, because both are in what they typed: when the show starts, and
 * how long doors are open before it.
 *
 * Nothing here guesses silently. The caller shows back what was read, in
 * words, so an inference that went the wrong way is visible and one edit from
 * being right.
 */

import { clockLabel } from './showTimeline';

export interface ShowStart {
  /** Minutes since midnight for the top of the show. */
  startMinutes: number;
  /** Minutes the room is open first, when the text said so. */
  doorsMin?: number;
  /** The show time, normalised: "9:00 PM". */
  label: string;
  /** Doors, normalised, when there was a doors time. */
  doorsLabel?: string;
  /** True when a bare hour was taken as evening rather than morning. */
  assumedEvening: boolean;
}

interface Token {
  hour: number;
  minutes: number;
  /** 'am' | 'pm' as written, or null when the text didn't say. */
  meridiem: 'am' | 'pm' | null;
  /** What the words around it called this time. */
  role: 'doors' | 'show' | null;
}

/**
 * A time, as loosely as one gets written: "9", "9:", "9:00", "9pm", "9:00 P.M.".
 *
 * One pattern rather than several, because two passes let "9:00" be matched by
 * the colon rule and its " PM" then be read as a separate thing — which turns
 * a nine o'clock show into a nine in the morning one.
 */
const TOKEN = /(\d{1,2})(?:\s*:\s*(\d{2})?)?\s*(a\.?m\.?|p\.?m\.?)?/gi;

const DOORS_WORDS = /doors?|house\s*opens?/gi;
const SHOW_WORDS = /show(?:time)?|starts?|curtain|first\s*act|begins?/gi;

const LABEL_REACH = 16;

interface Label {
  role: 'doors' | 'show';
  from: number;
  to: number;
}

function readLabels(text: string): Label[] {
  const labels: Label[] = [];
  for (const m of text.matchAll(DOORS_WORDS)) {
    labels.push({ role: 'doors', from: m.index ?? 0, to: (m.index ?? 0) + m[0].length });
  }
  for (const m of text.matchAll(SHOW_WORDS)) {
    labels.push({ role: 'show', from: m.index ?? 0, to: (m.index ?? 0) + m[0].length });
  }
  return labels;
}

/**
 * What the words around a time call it — the nearest label wins.
 *
 * Measuring in one direction does not work, because both orders get written:
 * "Doors 8:30 Show 9" puts the label in front, "8pm doors, 8:30 show" puts it
 * behind. A fixed window in either direction reaches past its own time into
 * the next one's label, which swaps doors and show and hangs the night off the
 * wrong hour. Nearest-wins is the rule that reads both the same way.
 */
function roleFor(labels: Label[], from: number, to: number): Token['role'] {
  let best: Label | null = null;
  let bestDistance = Infinity;

  for (const label of labels) {
    // Gap between the two spans; 0 when they touch.
    const distance = label.to <= from ? from - label.to : label.from >= to ? label.from - to : 0;
    if (distance > LABEL_REACH) continue;
    // A label in front of the time wins a tie: run sheets are written that way
    // far more often than the other.
    const leads = label.to <= from;
    const bestLeads = best ? best.to <= from : false;
    if (distance < bestDistance || (distance === bestDistance && leads && !bestLeads)) {
      best = label;
      bestDistance = distance;
    }
  }

  return best?.role ?? null;
}

function readTokens(text: string): Token[] {
  const labels = readLabels(text);
  const found: Token[] = [];

  for (const m of text.matchAll(TOKEN)) {
    const hour = parseInt(m[1], 10);
    const minutes = m[2] ? parseInt(m[2], 10) : 0;
    if (hour > 23 || minutes > 59) continue;
    const from = m.index ?? 0;
    // The meridiem is optional but the space before it is not, so "8:30 Show"
    // matches with a trailing space — which pushes the token's span up against
    // the *next* label and hands it that label's name.
    const to = from + m[0].trimEnd().length;
    found.push({
      hour,
      minutes,
      // "PM", "p.m." and "p" all mean the same thing; only the first letter
      // carries it. Comparing the written form against 'pm' matches nothing
      // and quietly turns a nine o'clock show into nine in the morning.
      meridiem: m[3] ? (m[3][0].toLowerCase() === 'p' ? 'pm' : 'am') : null,
      role: roleFor(labels, from, to),
    });
  }

  return found;
}

/**
 * Minutes since midnight, resolving a bare hour the way a show runs.
 *
 * An unqualified 9 on a run sheet is nine at night — matinees exist, so this is
 * reported back rather than assumed quietly. Anything already in 24-hour form
 * is left alone, because someone writing 20:00 has said what they mean.
 */
function toMinutes(token: Token, borrowed: 'am' | 'pm' | null): { minutes: number; assumed: boolean } {
  const meridiem = token.meridiem ?? borrowed;
  let hour = token.hour;
  let assumed = false;

  if (meridiem === 'pm' && hour < 12) hour += 12;
  else if (meridiem === 'am' && hour === 12) hour = 0;
  else if (!meridiem && hour >= 1 && hour <= 11) {
    hour += 12;
    assumed = true;
  }

  return { minutes: hour * 60 + token.minutes, assumed };
}

const MAX_DOORS_MIN = 180;

/**
 * The show's start, and its doors, out of free text. Null when there is no
 * time in there at all.
 */
export function readShowStart(text: string | undefined): ShowStart | null {
  if (!text || !text.trim()) return null;
  const tokens = readTokens(text);
  if (tokens.length === 0) return null;

  // A meridiem written once covers the whole line: "doors 8:30, show 9pm" says
  // nine at night, and so says half past eight at night.
  const borrowed = tokens.find((t) => t.meridiem)?.meridiem ?? null;

  const labelled = tokens.find((t) => t.role === 'show');
  const unlabelled = tokens.filter((t) => t.role !== 'doors');
  // The show is the one called the show; failing that the one not called
  // doors; failing that the last time written, since a line that names two
  // times is nearly always doors-then-show.
  const showToken = labelled ?? unlabelled[unlabelled.length - 1] ?? tokens[tokens.length - 1];
  const show = toMinutes(showToken, borrowed);

  const doorsToken = tokens.find((t) => t.role === 'doors') ?? null;
  let doorsMin: number | undefined;
  let doorsLabel: string | undefined;
  if (doorsToken && doorsToken !== showToken) {
    const doors = toMinutes(doorsToken, borrowed);
    const gap = show.minutes - doors.minutes;
    // Doors after the show, or half a day before it, is a misread rather than
    // a very patient audience.
    if (gap > 0 && gap <= MAX_DOORS_MIN) {
      doorsMin = gap;
      doorsLabel = clockLabel(doors.minutes);
    }
  }

  return {
    startMinutes: show.minutes,
    doorsMin,
    label: clockLabel(show.minutes),
    doorsLabel,
    assumedEvening: show.assumed,
  };
}

/** The same text, rewritten as the clock time the rest of the app reads. */
export function normaliseShowTime(text: string | undefined): string | null {
  return readShowStart(text)?.label ?? null;
}
