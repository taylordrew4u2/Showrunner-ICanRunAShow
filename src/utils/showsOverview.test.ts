import { describe, it, expect } from 'vitest';
import { buildOverview, whenLabel, daysUntil, showsOnDay, showReadiness } from './showsOverview';
import type { Show } from '../types';

const TODAY = new Date(2026, 7, 14); // Fri 14 Aug 2026, local midnight

const show = (over: Partial<Show>): Show => ({
  id: 's', name: 'Show', date: '', time: '', location: '', venueName: '',
  status: 'upcoming', performers: [], artists: [], schedule: [], hosts: [],
  djSongs: [], staff: [], vendors: [], expenses: [], scenes: [],
  createdAt: '', updatedAt: '', ...over,
});

const performer = { id: 'p', name: 'Ada Cole' };
const cue = { id: 'c', time: '', description: 'Doors' };

describe('daysUntil', () => {
  it('ignores the time of day on either side', () => {
    expect(daysUntil(new Date(2026, 7, 15, 23, 59), new Date(2026, 7, 14, 0, 1))).toBe(1);
  });

  it('goes negative for a date already gone', () => {
    expect(daysUntil(new Date(2026, 7, 10), TODAY)).toBe(-4);
  });
});

describe('whenLabel', () => {
  it('says tonight rather than "in 0 days"', () => {
    expect(whenLabel(new Date(2026, 7, 14), TODAY)).toBe('Tonight');
  });

  it('names the near days instead of counting them', () => {
    expect(whenLabel(new Date(2026, 7, 15), TODAY)).toBe('Tomorrow');
    expect(whenLabel(new Date(2026, 7, 13), TODAY)).toBe('Yesterday');
  });

  it('counts while counting still means something', () => {
    expect(whenLabel(new Date(2026, 7, 20), TODAY)).toBe('In 6 days');
    expect(whenLabel(new Date(2026, 7, 21), TODAY)).toBe('In 7 days');
  });

  it('switches to a date once the count stops being useful', () => {
    expect(whenLabel(new Date(2026, 7, 22), TODAY)).toMatch(/Aug/);
  });

  it('never reports a negative countdown for a past show', () => {
    expect(whenLabel(new Date(2026, 6, 1), TODAY)).not.toMatch(/-/);
  });
});

describe('buildOverview', () => {
  it('has nothing to report with no shows', () => {
    const o = buildOverview([], TODAY);
    expect(o.nextShow).toBeNull();
    expect(o.nextShowWhen).toBeNull();
    expect(o.upcomingCount).toBe(0);
  });

  it('picks the soonest show, not the first in the list', () => {
    const o = buildOverview([
      show({ id: 'later', date: '2026-09-01' }),
      show({ id: 'sooner', date: '2026-08-20' }),
    ], TODAY);
    expect(o.nextShow?.id).toBe('sooner');
    expect(o.nextShowWhen).toBe('In 6 days');
  });

  it('does not call a finished or cancelled show next', () => {
    const o = buildOverview([
      show({ id: 'done', date: '2026-08-16', status: 'completed' }),
      show({ id: 'off', date: '2026-08-17', status: 'cancelled' }),
      show({ id: 'live', date: '2026-08-20' }),
    ], TODAY);
    expect(o.nextShow?.id).toBe('live');
    expect(o.upcomingCount).toBe(1);
  });

  it('leaves a show that has already happened out of what is ahead', () => {
    const o = buildOverview([show({ id: 'past', date: '2026-08-01' })], TODAY);
    expect(o.upcomingCount).toBe(0);
    expect(o.nextShow).toBeNull();
  });

  it('counts tonight as still ahead', () => {
    const o = buildOverview([show({ id: 'tonight', date: '2026-08-14' })], TODAY);
    expect(o.upcomingCount).toBe(1);
    expect(o.nextShowWhen).toBe('Tonight');
  });

  it('keeps an undated show on the books but not as "next"', () => {
    const o = buildOverview([
      show({ id: 'tbd', date: '' }),
      show({ id: 'dated', date: '2026-08-20' }),
    ], TODAY);
    expect(o.upcomingCount).toBe(2);
    expect(o.nextShow?.id).toBe('dated');
  });

  it('flags an upcoming show with nobody booked', () => {
    const o = buildOverview([show({ id: 'empty', date: '2026-08-20' })], TODAY);
    expect(o.needsLineup.map((s) => s.id)).toEqual(['empty']);
  });

  it('counts an artist as a lineup, not just performers', () => {
    const o = buildOverview([
      show({ id: 'drag', date: '2026-08-20', artists: [{ id: 'a', name: 'Kiki Sol' }] }),
    ], TODAY);
    expect(o.needsLineup).toHaveLength(0);
  });

  it('asks for a running order only once there is a bill to order', () => {
    const o = buildOverview([
      show({ id: 'empty', date: '2026-08-20' }),
      show({ id: 'booked', date: '2026-08-21', performers: [performer] }),
    ], TODAY);
    // The empty one needs a lineup first; nagging for its schedule is noise.
    expect(o.needsSchedule.map((s) => s.id)).toEqual(['booked']);
  });

  it('stops asking once the running order exists', () => {
    const o = buildOverview([
      show({ id: 'ready', date: '2026-08-20', performers: [performer], schedule: [cue] }),
    ], TODAY);
    expect(o.needsSchedule).toHaveLength(0);
    expect(o.needsLineup).toHaveLength(0);
  });

  it('does not nag about shows that already happened', () => {
    const o = buildOverview([show({ id: 'past', date: '2026-08-01' })], TODAY);
    expect(o.needsLineup).toHaveLength(0);
    expect(o.needsSchedule).toHaveLength(0);
  });
});

describe('showsOnDay', () => {
  it('matches on the local day, not a UTC timestamp', () => {
    const found = showsOnDay([show({ id: 'a', date: '2026-08-14' })], TODAY);
    expect(found.map((s) => s.id)).toEqual(['a']);
  });

  it('skips undated shows rather than throwing', () => {
    expect(showsOnDay([show({ id: 'tbd', date: '' })], TODAY)).toEqual([]);
  });
});

describe('attention queue', () => {
  it('merges both follow-up lists, soonest first', () => {
    const soon = show({ id: 'soon', date: '2026-08-16', performers: [performer] }); // needs schedule
    const later = show({ id: 'later', date: '2026-08-30' });                        // needs lineup
    const middle = show({ id: 'middle', date: '2026-08-20' });                      // needs lineup
    const { attention } = buildOverview([later, soon, middle], TODAY);
    expect(attention.map((a) => a.show.id)).toEqual(['soon', 'middle', 'later']);
  });

  it('names what each show is missing', () => {
    const noBill = show({ id: 'a', date: '2026-08-16' });
    const noOrder = show({ id: 'b', date: '2026-08-17', performers: [performer] });
    const { attention } = buildOverview([noBill, noOrder], TODAY);
    expect(attention).toEqual([
      { show: noBill, reason: 'lineup', label: 'No lineup yet' },
      { show: noOrder, reason: 'schedule', label: 'No running order' },
    ]);
  });

  it('puts an undated show at the back rather than the front', () => {
    // '' parses to no date; sorting it as a raw string would float it to the
    // top and claim the most urgent slot.
    const undated = show({ id: 'undated', date: '' });
    const dated = show({ id: 'dated', date: '2026-08-20' });
    const { attention } = buildOverview([undated, dated], TODAY);
    expect(attention.map((a) => a.show.id)).toEqual(['dated', 'undated']);
  });

  it('is empty when every upcoming show is ready', () => {
    const ready = show({ date: '2026-08-16', performers: [performer], schedule: [cue] });
    expect(buildOverview([ready], TODAY).attention).toEqual([]);
  });
});

describe('showReadiness', () => {
  it('reports an empty show as not ready on both counts', () => {
    const lines = showReadiness(show({}));
    expect(lines.map((l) => [l.key, l.label, l.ready])).toEqual([
      ['lineup', 'Nobody booked yet', false],
      ['schedule', 'No running order', false],
    ]);
  });

  it('counts performers and artists together as the bill', () => {
    const s = show({ performers: [performer], artists: [{ id: 'a', name: 'DJ' }] });
    expect(showReadiness(s)[0]).toMatchObject({ label: '2 on the bill', ready: true });
  });

  it('says one cue rather than 1 cues', () => {
    expect(showReadiness(show({ schedule: [cue] }))[1].label).toBe('1 cue');
  });

  it('leaves walk-ons out entirely when there are no performers', () => {
    // "0 of 0 walk-ons set" is a complaint about an empty list.
    expect(showReadiness(show({})).map((l) => l.key)).not.toContain('walkon');
  });

  it('is only ready on walk-ons once every performer has one', () => {
    const withMusic = { id: 'p1', name: 'Ada', walkOnMusicName: 'intro.mp3' };
    const without = { id: 'p2', name: 'Bo' };
    const lines = showReadiness(show({ performers: [withMusic, without] }));
    expect(lines.find((l) => l.key === 'walkon')).toMatchObject({ label: '1 of 2 walk-ons set', ready: false });
    const all = showReadiness(show({ performers: [withMusic] }));
    expect(all.find((l) => l.key === 'walkon')).toMatchObject({ ready: true });
  });
});
