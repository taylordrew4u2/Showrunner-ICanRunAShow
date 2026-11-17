import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Show } from '../types';
import { fullPerformer, fullShow } from '../coproducer/testFixtures';
import { publicLineup, type LiveViewPayload } from './liveView';
import { showStartISO } from './showDate';
import { loadColorScheme } from './theme';
import { scheduledViewerPayload } from './viewerPayload';

/**
 * The payload as ShowDetail built it before it moved here, kept word for word
 * so the move is checked against what it replaced.
 */
function closureBuilt(show: Show, note: string | undefined): LiveViewPayload {
  function buildStartsAtISO(): string | undefined {
    return showStartISO(show.date, show.time);
  }
  function buildLineup(): LiveViewPayload['lineup'] {
    return publicLineup(show.performers);
  }
  return {
    showName: show.name,
    status: 'scheduled',
    startsAt: buildStartsAtISO(),
    note: note?.trim() || undefined,
    theme: loadColorScheme(),
    lineup: buildLineup(),
    lastUpdateMs: Date.now(),
  };
}

describe('the pre-show viewer payload', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  const shows: [string, Show][] = [
    ['a full show', fullShow()],
    ['a surprise guest on the bill', fullShow({ performers: [fullPerformer(), fullPerformer({ id: 'p2', name: 'Secret', surpriseGuest: true })] })],
    ['no date or time', fullShow({ date: '', time: '' })],
    ['nobody booked', fullShow({ performers: [] })],
  ];

  for (const [what, show] of shows) {
    it(`matches what the show page built, for ${what}`, () => {
      for (const note of [undefined, '', '   ', ' Doors at 7:30 ']) {
        expect(scheduledViewerPayload(show, note)).toEqual(closureBuilt(show, note));
      }
    });
  }

  it('keeps surprise guests and the link secrets out of it', () => {
    const show = fullShow({ performers: [fullPerformer({ name: 'Secret', surpriseGuest: true })] });
    const json = JSON.stringify(scheduledViewerPayload(show, 'Hi'));
    expect(json).not.toContain('Secret');
    expect(json).not.toContain(show.viewerKey);
    expect(json).not.toContain(show.viewToken);
  });
});
