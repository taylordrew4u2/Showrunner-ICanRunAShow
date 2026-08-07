/**
 * A colour per track, so a pad is found by looking rather than by reading.
 *
 * Derived from the track's key, never from its position on the board. A key is
 * `dj:<id>`, `performer:<id>` or `cue:<id>` — stable for the life of the song —
 * so the walk-on that was teal last Friday is teal tonight. Colouring by index
 * would reshuffle the whole wall the moment a cue moved, which is worse than no
 * colour at all: it would teach a habit and then break it mid-show.
 */

export interface PadColor {
  /** The lit facets of the brushed-metal sweep. */
  hi: string;
  /** The dark facets between them. */
  lo: string;
  /** The index line across the knob. */
  pointer: string;
}

/**
 * Ten knobs you can tell apart at arm's length under stage light.
 *
 * Ten rather than twelve on purpose. A longer list ran to near-twins —
 * indigo beside periwinkle, violet beside lavender — and two colours a
 * producer has to squint between are worth less than one they repeat. A repeat
 * across a board is harmless; a pair that looks alike is the thing this exists
 * to prevent. Bronze is kept well down from gold for the same reason.
 *
 * No green: green is the ring of a pad that is playing, and a green knob two
 * seats away from a lit one is a press you can't take back. Nothing near the
 * amber of a loading pad either. Every `lo` is dark enough that the white label
 * beneath it keeps its contrast against the deck.
 */
const PALETTE: PadColor[] = [
  { hi: '#7e94e2', lo: '#0d1440', pointer: '#ffe27a' }, // indigo
  { hi: '#e2848c', lo: '#3d0d17', pointer: '#ffd9de' }, // rose
  { hi: '#71c6c9', lo: '#06333a', pointer: '#d7fbff' }, // teal
  { hi: '#c79ae4', lo: '#2c0f45', pointer: '#f2e3ff' }, // violet
  { hi: '#e8bd72', lo: '#4a3208', pointer: '#fff3d0' }, // gold
  { hi: '#8fa8bd', lo: '#16242f', pointer: '#e6f1fa' }, // steel
  { hi: '#e09a6e', lo: '#401c07', pointer: '#ffe3cf' }, // copper
  { hi: '#d98fc4', lo: '#3d0c33', pointer: '#ffdcf4' }, // orchid
  { hi: '#7fb2d9', lo: '#0a2740', pointer: '#dff0ff' }, // sky
  { hi: '#9c8f6a', lo: '#241d09', pointer: '#efe6cb' }, // bronze
];

/** FNV-1a: cheap, and spreads short similar strings like `dj:1`, `dj:2`. */
function hash(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The colour for a soundboard key. Same key in, same colour out, always. */
export function padColor(key: string): PadColor {
  return PALETTE[hash(key) % PALETTE.length];
}

/** How many distinct colours exist — exported so a test can reason about spread. */
export const PAD_COLOR_COUNT = PALETTE.length;
