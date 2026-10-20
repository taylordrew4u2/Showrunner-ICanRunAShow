import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exportShowToPDF, exportDJListToPDF } from './pdfExport';
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
    const credits = 'As seen on Comedy Central’s Up Next, Just For Laughs New Faces, opening for Maria Bamford on tour, host of the #1 comedy podcast Loud & Clear, Edinburgh Fringe and Melbourne International Comedy Festival alum.';
    const longShow = { ...show, performers: [{ ...show.performers[0], credits }] } as Show;
    const html = captureExport(() => exportShowToPDF(longShow, settings));

    // The credits get a box of their own that stops short of the foot.
    expect(html).toContain('class="card card--foot"');
    expect(ruleFor(html, '.card')).toContain('flex-direction: column');
    expect(ruleFor(html, '.card--foot')).toMatch(/padding-bottom: \d+px/);
    expect(ruleFor(html, '.card__credits')).toContain('min-height: 0');
    expect(ruleFor(html, '.card__credits')).toContain('overflow: hidden');
  });

  it('gives the credits the whole card when there is no foot to clear', () => {
    const bare = { ...show, performers: [{ id: 'p1', name: 'Ada Cole', credits: 'Netflix' }] } as unknown as Show;
    const html = captureExport(() => exportShowToPDF(bare, settings));
    expect(html).toContain('class="card"');
    expect(html).not.toContain('card--foot"');
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
});
