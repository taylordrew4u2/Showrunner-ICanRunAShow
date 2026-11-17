import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Show } from '../types';
import { fullPerformer, fullShow } from '../coproducer/testFixtures';
import { publicHosts, publicLineup, type LiveViewPayload } from './liveView';
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
        // The hosts are newer than the move, and are checked on their own below.
        const { hosts, ...asItWas } = scheduledViewerPayload(show, note);
        expect(asItWas).toEqual(closureBuilt(show, note));
        expect(hosts).toEqual(publicHosts(show));
      }
    });
  }

  it('names the hosts, one or two, with the handle and the profile each is tagged by', () => {
    const two = fullShow({
      host: ' Jo Park ', hostSocial: '@jopark', hostComicId: 'c-jo',
      coHost: 'Dev Okonjo', coHostSocial: 'https://www.tiktok.com/@dev.okonjo', coHostComicId: undefined,
    });
    expect(scheduledViewerPayload(two, undefined).hosts).toEqual([
      { name: 'Jo Park', handle: '@jopark', link: 'https://instagram.com/jopark' },
      { name: 'Dev Okonjo', handle: '@dev.okonjo', link: 'https://www.tiktok.com/@dev.okonjo' },
    ]);
    const one = fullShow({ host: 'Jo Park', hostSocial: undefined, coHost: undefined, coHostSocial: undefined });
    expect(scheduledViewerPayload(one, undefined).hosts).toEqual([{ name: 'Jo Park', handle: undefined, link: undefined }]);
    // The Rolodex link is the producer's own bookkeeping, not the room's.
    expect(JSON.stringify(scheduledViewerPayload(two, undefined))).not.toContain('c-jo');
  });

  it('sends no hosts at all for a show with nobody hosting, as before there were any to send', () => {
    const nobody = fullShow({ host: undefined, hostSocial: undefined, coHost: undefined, coHostSocial: undefined });
    expect(scheduledViewerPayload(nobody, undefined)).not.toHaveProperty('hosts');
  });

  it('holds back a host who is on the bill as a surprise guest', () => {
    const show = fullShow({
      host: 'Secret', hostSocial: '@secretguest', coHost: 'Dev Okonjo', coHostSocial: undefined,
      performers: [fullPerformer({ name: 'Secret', surpriseGuest: true })],
    });
    const payload = scheduledViewerPayload(show, undefined);
    expect(payload.hosts).toEqual([{ name: 'Dev Okonjo', handle: undefined, link: undefined }]);
    expect(JSON.stringify(payload)).not.toMatch(/Secret|secretguest/);
  });

  it('keeps surprise guests and the link secrets out of it', () => {
    const show = fullShow({ performers: [fullPerformer({ name: 'Secret', surpriseGuest: true })] });
    const json = JSON.stringify(scheduledViewerPayload(show, 'Hi'));
    expect(json).not.toContain('Secret');
    expect(json).not.toContain(show.viewerKey);
    expect(json).not.toContain(show.viewToken);
  });
});
