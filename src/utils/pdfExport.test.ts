import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exportShowToPDF, exportDJListToPDF, creditsFontPx } from './pdfExport';
import type { Show, AppSettings } from '../types';

const show = {
  id: 'show-1',
  name: 'Late Night Laughs',
  date: '2026-04-07',
  time: '20:00',
  location: 'Portland, OR',
  venueName: 'The Basement',
  status: 'upcoming',
  performers: [{ id: 'p1', name: 'Ada Cole', walkOnMusicName: 'Intro', walkOnMusicTimestamp: '0:12' }],
  artists: [],
  schedule: [{ id: 's1', time: '8:00 PM', description: 'Doors', durationMin: 10 }],
  hosts: [],
  djSongs: [{ id: 'd1', title: 'Opener', artist: 'The Band', notes: '' }],
  staff: [],
  expenses: [{ id: 'e1', category: 'Venue', itemName: 'Rental', cost: 200, date: '', notes: '' }],
} as unknown as Show;

const settings = {
  brandName: 'Basement Comedy',
  producers: [],
  rules: '',
  musicLibrary: [],
} as unknown as AppSettings;

/**
 * The export writes its page into a new window and prints it. Capture what
 * it wrote so the stylesheet can be read back.
 */
function captureExport(run: () => void): string {
  let written = '';
  const printWindow = {
    document: {
      write: (html: string) => {
        written += html;
      },
      close: () => {},
    },
    print: () => {},
  };
  vi.stubGlobal('window', { open: () => printWindow });
  run();
  return written;
}

/** The declarations of one CSS rule, by its selector, or '' when there is none. */
function ruleFor(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|[\\s}])${escaped}\\s*\\{([^}]*)\\}`));
  return match ? match[1] : '';
}

/** About five lines' worth at 13px: the length that used to run over the walk-on cue. */
const LONG_CREDITS = 'As seen on Comedy Central’s Up Next, Just For Laughs New Faces, opening for Maria Bamford on tour, host of the #1 comedy podcast Loud & Clear, Edinburgh Fringe and Melbourne International Comedy Festival alum.';
/** More than a card holds at any size. */
const VERY_LONG_CREDITS = [LONG_CREDITS, LONG_CREDITS, LONG_CREDITS].join(' ');

/** The opening tag of the credits on the one card printed for an act like this. */
function creditsTagOf(act: Record<string, unknown>): string {
  const solo = { ...show, performers: [{ id: 'p1', name: 'Ada Cole', ...act }] } as unknown as Show;
  const html = captureExport(() => exportShowToPDF(solo, settings));
  return html.match(/<div class="card__credits[^>]*>/)?.[0] ?? '';
}

/** How many lines that card's credits are clamped to, or 0 when they are not. */
function clampOf(act: Record<string, unknown>): number {
  return Number(creditsTagOf(act).match(/-webkit-line-clamp: (\d+)/)?.[1] ?? 0);
}

describe('the printed runsheet', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps its table headers when the printer strips background colours', () => {
    const html = captureExport(() => exportShowToPDF(show, settings));
    // Print dialogs drop backgrounds by default. The header text is white on
    // that fill, so without this the header row prints as a blank strip.
    const th = ruleFor(html, 'th');
    expect(th).toContain('background');
    expect(th).toContain('print-color-adjust: exact');
    expect(th).toContain('-webkit-print-color-adjust: exact');
  });

  it('keeps the shaded total row and badges on paper too', () => {
    const html = captureExport(() => exportShowToPDF(show, settings));
    expect(ruleFor(html, '.total-row td')).toContain('print-color-adjust: exact');
    expect(ruleFor(html, '.badge')).toContain('print-color-adjust: exact');
  });

  it('prints recap notes without the trailing space and blank lines they were typed with', () => {
    // Notes are stored as typed, so the field can be edited without losing
    // the space after a word. The printed page is where they are tidied.
    const recapped = {
      ...show,
      recap: { performerNotes: 'Great room\n\n', improvementNotes: 'Start on time ' },
    } as Show;
    const html = captureExport(() => exportShowToPDF(recapped, settings));
    expect(html).toContain('<strong>Performer Notes:</strong>\nGreat room</div>');
    expect(html).toContain('<strong>Improvement Notes:</strong>\nStart on time</div>');
  });

  /** The recap box's figures as label → value, in the order they print. */
  function recapStats(html: string): [string, string][] {
    const box = html.slice(html.indexOf('<h2>Show Recap</h2>'));
    return [...box.matchAll(/recap-stat__label">([^<]*)<\/div><div class="recap-stat__value">([^<]*)</g)]
      .map((m) => [m[1], m[2]]);
  }

  it('prints the night’s money from its vendors and recap, not a stored profit gone stale', () => {
    // The stored 620 was saved before the vendors were costed. The sheet's
    // own Itemized Expenses (the old per-show list) is not the night's cost:
    // those expenses live on the account's Expenses page now.
    const recapped = {
      ...show,
      vendors: [{ id: 'v1', name: 'Room', cost: 300 }, { id: 'v2', name: 'Sound', cost: 50 }],
      recap: { attendance: 90, ticketSales: 500, merchSales: 120, otherCosts: 100, profitLoss: 620 },
    } as Show;
    const html = captureExport(() => exportShowToPDF(recapped, settings));
    expect(recapStats(html)).toEqual([
      ['Attendance', '90'],
      ['Ticket Sales', '$500.00'],
      ['Merch Sales', '$120.00'],
      ['Vendor Costs', '$350.00'],
      ['Other Costs', '$100.00'],
      ['Profit / Loss', '$170.00'],
    ]);
  });

  it('prints a losing night with the sign before the dollar', () => {
    // An old recap: merch only, and the profit it stored when expenses read $0.
    const recapped = {
      ...show,
      vendors: [{ id: 'v1', name: 'Room', cost: 250 }],
      recap: { merchSales: 80, profitLoss: 80 },
    } as Show;
    const html = captureExport(() => exportShowToPDF(recapped, settings));
    expect(recapStats(html)).toEqual([
      ['Merch Sales', '$80.00'],
      ['Vendor Costs', '$250.00'],
      ['Profit / Loss', '-$170.00'],
    ]);
  });

  it('leaves the money off a recap that recorded none', () => {
    const recapped = { ...show, recap: { performerNotes: 'Great room' } } as Show;
    const html = captureExport(() => exportShowToPDF(recapped, settings));
    expect(recapStats(html)).toEqual([]);
  });

  it('keeps the DJ list headers when the printer strips background colours', () => {
    const html = captureExport(() => exportDJListToPDF(show, []));
    const th = ruleFor(html, 'th');
    expect(th).toContain('background');
    expect(th).toContain('print-color-adjust: exact');
    expect(th).toContain('-webkit-print-color-adjust: exact');
  });

  it('still prints in the iOS shell, where window.open returns null', () => {
    // Capacitor hands every window.open to the system and returns null, so
    // the sheet is printed from a hidden frame in this document instead —
    // and the frame is gone again once the print dialog closes.
    let written = '';
    const listeners: Record<string, () => void> = {};
    const frameWindow = {
      focus: vi.fn(),
      print: vi.fn(),
      addEventListener: (name: string, fn: () => void) => { listeners[name] = fn; },
    };
    const frame = {
      style: { cssText: '' },
      setAttribute: () => {},
      contentDocument: { open: () => {}, write: (html: string) => { written += html; }, close: () => {} },
      contentWindow: frameWindow,
      remove: vi.fn(),
    };
    const appended: unknown[] = [];
    vi.stubGlobal('window', { open: () => null });
    vi.stubGlobal('document', { createElement: () => frame, body: { appendChild: (el: unknown) => appended.push(el) } });

    exportShowToPDF(show, settings);
    expect(appended).toEqual([frame]);
    expect(written).toContain('Late Night Laughs');
    vi.advanceTimersByTime(300);
    expect(frameWindow.print).toHaveBeenCalledOnce();
    expect(frame.remove).not.toHaveBeenCalled();
    listeners.afterprint();
    expect(frame.remove).toHaveBeenCalledOnce();
  });

  it('keeps a long introduction from printing over the walk-on cue', () => {
    // The card is a fixed height and its foot sits at the bottom. Credits
    // that ran six lines used to print straight over the walk-on line, so the
    // host could read neither.
    const longShow = { ...show, performers: [{ ...show.performers[0], credits: LONG_CREDITS }] } as Show;
    const html = captureExport(() => exportShowToPDF(longShow, settings));

    // The credits get a box of their own that stops short of the foot.
    expect(html).toContain('class="card__foot"');
    expect(ruleFor(html, '.card')).toContain('flex-direction: column');
    expect(ruleFor(html, '.card__credits')).toContain('min-height: 0');
    expect(ruleFor(html, '.card__credits')).toContain('overflow: hidden');
    // And the foot is in that column, as tall as its lines, rather than
    // pinned over the bottom of the card with a fixed 36px kept clear for
    // it (.card--foot), which a walk-on wrapping to two lines overran.
    expect(ruleFor(html, '.card__foot')).toContain('flex: none');
    expect(ruleFor(html, '.card__foot')).not.toContain('position: absolute');
    expect(ruleFor(html, '.card--foot')).toBe('');
    expect(html).not.toContain('card--foot');
    expect(ruleFor(html, '.card')).not.toMatch(/padding-bottom: 36px|padding: [^;]*36px/);
  });

  it('gives the credits the whole card when there is no foot to clear', () => {
    const bare = { ...show, performers: [{ id: 'p1', name: 'Ada Cole', credits: 'Netflix' }] } as unknown as Show;
    const html = captureExport(() => exportShowToPDF(bare, settings));
    expect(html).toContain('class="card"');
    expect(html).not.toContain('class="card__foot"');
    // So long credits get a line more before they are cut than over a foot.
    expect(clampOf({ credits: VERY_LONG_CREDITS })).toBe(clampOf({ credits: VERY_LONG_CREDITS, walkOnMusicName: 'Intro' }) + 1);
  });

  it('keeps a surprise guest on the producer’s sheet and the host’s card, marked', () => {
    // The runsheet is the producer's and the cards are the host's: the two
    // people who need the name. Both say it is a surprise.
    const withGuest = {
      ...show,
      performers: [
        ...show.performers,
        { id: 'g1', name: 'Miles Trent', socialMedia: '@milestrent', surpriseGuest: true },
      ],
    } as Show;
    const html = captureExport(() => exportShowToPDF(withGuest, settings));
    expect(html).toMatch(/<td>Miles Trent<span class="badge">Surprise guest<\/span><\/td>/);
    expect(html).toMatch(/<td>Ada Cole<\/td>/);
    expect(html).toMatch(/<span class="card__kind">Surprise guest · @milestrent<\/span>/);
  });

  it('leaves short credits at the house size, on the ruling, unclamped', () => {
    expect(creditsTagOf({ credits: 'Netflix, Comedy Central', walkOnMusicName: 'Intro' })).toBe('<div class="card__credits">');
    const html = captureExport(() => exportShowToPDF(show, settings));
    const credits = ruleFor(html, '.card__credits');
    expect(credits).toContain('font-size: 13px');
    expect(credits).toContain('line-height: 28px');
    // A rule to every line: the ruling's pitch is the line height.
    expect(credits).toContain('background-size: 100% 28px');
  });

  it('sets longer credits a step smaller, ruled closer to match', () => {
    expect(creditsTagOf({ credits: LONG_CREDITS, walkOnMusicName: 'Intro' })).toContain('card__credits--12');
    const html = captureExport(() => exportShowToPDF(show, settings));
    const step = ruleFor(html, '.card__credits--12');
    expect(step).toContain('font-size: 12px');
    expect(step).toContain('line-height: 24px');
    expect(step).toContain('background-size: 100% 24px');
  });

  it('sets credits too long for the card at the smallest size, ending in an ellipsis on its last line', () => {
    const tag = creditsTagOf({ credits: VERY_LONG_CREDITS, walkOnMusicName: 'Intro' });
    expect(tag).toContain('card__credits--11');
    expect(tag).toContain('card__credits--clamp');
    // Eight 18px lines between a one-line name and a one-line foot, and a
    // box no taller, so nothing of a ninth shows under the ellipsis.
    expect(tag).toContain('style="-webkit-line-clamp: 8; max-height: 144px"');

    const html = captureExport(() => exportShowToPDF(show, settings));
    const step = ruleFor(html, '.card__credits--11');
    expect(step).toContain('font-size: 11px');
    expect(step).toContain('line-height: 18px');
    expect(step).toContain('background-size: 100% 18px');
    const clamp = ruleFor(html, '.card__credits--clamp');
    expect(clamp).toContain('display: -webkit-box');
    expect(clamp).toContain('-webkit-box-orient: vertical');
  });

  it('clamps short credits nowhere', () => {
    expect(clampOf({ credits: 'Netflix', walkOnMusicName: 'Intro' })).toBe(0);
    expect(creditsTagOf({ credits: 'Netflix' })).not.toContain('style=');
  });

  it('takes the lines a wrapping walk-on needs from the credits, so the clamp still lands on a line that shows', () => {
    // A walk-on title that wraps to a second line makes the foot taller; the
    // credits above give it the room rather than print under it.
    const longWalkOn = {
      walkOnMusicName: 'Mr. Brightside (Jacques Lu Cont Remix)',
      walkOnMusicArtist: 'The Killers',
      walkOnMusicTimestamp: '1:02',
      socialMedia: '@milestrent',
    };
    expect(clampOf({ credits: VERY_LONG_CREDITS, ...longWalkOn })).toBeLessThan(clampOf({ credits: VERY_LONG_CREDITS, walkOnMusicName: 'Intro' }));
  });

  it('takes the line a two-line name needs from the credits too', () => {
    const name = 'The Improvised Shakespeare Company';
    expect(clampOf({ name, credits: VERY_LONG_CREDITS, walkOnMusicName: 'Intro' })).toBeLessThan(clampOf({ credits: VERY_LONG_CREDITS, walkOnMusicName: 'Intro' }));
  });

  it('counts a name in capitals at the width capitals take', () => {
    // Twenty capitals of Cormorant run wider than the card and wrap, so the
    // credits lose a line to the name; counted at the width of lower case,
    // the name kept to one line on paper and the clamped last line, with
    // its ellipsis, printed off the bottom of the card.
    const usual = clampOf({ credits: VERY_LONG_CREDITS, walkOnMusicName: 'Intro' });
    expect(clampOf({ name: 'THE AMAZING MARVELLA', credits: VERY_LONG_CREDITS, walkOnMusicName: 'Intro' })).toBeLessThan(usual);
    // A name as long in lower case still fits on one line.
    expect(clampOf({ name: 'Christopher Robinson', credits: VERY_LONG_CREDITS, walkOnMusicName: 'Intro' })).toBe(usual);
  });

  it('says "No credits on file" at the house size when there are none', () => {
    expect(creditsTagOf({ walkOnMusicName: 'Intro' })).toBe('<div class="card__credits card__credits--none">');
  });
});

describe('creditsFontPx', () => {
  it('keeps credits that fit at the house 13px', () => {
    expect(creditsFontPx('')).toBe(13);
    expect(creditsFontPx('Netflix, Comedy Central, HBO Max')).toBe(13);
  });

  it('steps down to 12px and then 11px as credits get longer, and no further', () => {
    expect(creditsFontPx(LONG_CREDITS)).toBe(12);
    expect(creditsFontPx(VERY_LONG_CREDITS)).toBe(11);
    expect(creditsFontPx(VERY_LONG_CREDITS.repeat(5))).toBe(11);
  });

  it('never sets longer credits larger than shorter ones', () => {
    let last = Infinity;
    for (let length = 0; length <= VERY_LONG_CREDITS.length; length += 10) {
      const px = creditsFontPx(VERY_LONG_CREDITS.slice(0, length));
      expect(px).toBeLessThanOrEqual(last);
      last = px;
    }
  });

  it('steps down sooner on a card that leaves the credits less room', () => {
    // The default room is a card with a one-line name and a one-line foot.
    expect(creditsFontPx(LONG_CREDITS, 100)).toBeLessThan(creditsFontPx(LONG_CREDITS));
    expect(creditsFontPx(LONG_CREDITS, 200)).toBe(13);
  });
});
