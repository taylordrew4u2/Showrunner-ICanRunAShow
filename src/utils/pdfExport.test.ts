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

  it('keeps the DJ list headers when the printer strips background colours', () => {
    const html = captureExport(() => exportDJListToPDF(show, []));
    const th = ruleFor(html, 'th');
    expect(th).toContain('background');
    expect(th).toContain('print-color-adjust: exact');
    expect(th).toContain('-webkit-print-color-adjust: exact');
  });
});
