import { describe, expect, it } from 'vitest';
import { generateSchedule, handoverRuntime, scheduleRuntime } from './generateSchedule';
import type { Performer } from '../types';

function performer(id: string, name: string): Performer {
  return { id, name };
}

const ACTS = [
  { performer: performer('p1', 'Dev Okonjo'), durationMin: 10, role: 'Guest' },
  { performer: performer('p2', 'Mona Sable'), durationMin: 15, role: 'Feature' },
  { performer: performer('p3', 'Kit Anders'), durationMin: 25, role: 'Headliner' },
];

describe('generateSchedule', () => {
  it('writes the host a handover before every act after the first', () => {
    const items = generateSchedule({ acts: ACTS, hostName: 'Renata Cruz' });
    const intros = items.filter((item) => item.description.startsWith('Intro — '));

    // three acts, but the first is introduced inside the welcome
    expect(intros).toHaveLength(2);
    expect(intros[0].description).toBe('Intro — Mona Sable');
    expect(intros[1].description).toBe('Intro — Kit Anders');
  });

  /**
   * The sheet counts from the top of the night rather than off the clock.
   * Shows do not start when the poster says, and from the moment the first one
   * slips a sheet of wall-clock times is wrong on every row for the rest of the
   * night — so the rows say how far in they are instead.
   */
  it('times every cue by how far into the show it lands', () => {
    const items = generateSchedule({
      acts: ACTS,
      hostName: 'Renata Cruz',
      doorsMin: 30,
      welcomeMin: 5,
      introMin: 1,
    });

    expect(items.map((item) => `${item.time} ${item.description}`)).toEqual([
      '0:00 Doors — house music',
      '0:30 Welcome, rules, first intro',
      '0:35 Guest',
      '0:45 Intro — Mona Sable',
      '0:46 Feature',
      '1:01 Intro — Kit Anders',
      '1:02 Headliner',
      '1:27 Outro and plugs',
    ]);
  });

  it('starts the sheet at the first cue when there are no doors', () => {
    const items = generateSchedule({ acts: ACTS, doorsMin: 0 });
    expect(items[0].time).toBe('0:00');
    expect(items[0].description).toBe('Guest');
  });

  it('links each act back to its performer, so walk-on music still fires', () => {
    const items = generateSchedule({ acts: ACTS, hostName: 'Renata Cruz' });
    const feature = items.find((item) => item.description === 'Feature');

    expect(feature?.performerId).toBe('p2');
    expect(feature?.performer).toBe('Mona Sable');
  });

  it('drops an interval in where asked, but never after the closer', () => {
    const withBreak = generateSchedule({
      acts: ACTS,
      hostName: 'Renata Cruz',
      intermissionAfter: 2,
    });
    expect(withBreak.filter((item) => item.description === 'Intermission')).toHaveLength(1);

    const afterLast = generateSchedule({
      acts: ACTS,
      hostName: 'Renata Cruz',
      intermissionAfter: 3,
    });
    expect(afterLast.filter((item) => item.description === 'Intermission')).toHaveLength(0);
  });

  it('writes no handovers when nobody is hosting', () => {
    const items = generateSchedule({ acts: ACTS });

    expect(items.some((item) => item.description.startsWith('Intro — '))).toBe(false);
    expect(items.some((item) => item.description === 'Outro and plugs')).toBe(false);
  });

  it('falls back to a default length for an act with no set time', () => {
    const items = generateSchedule({
      acts: [{ performer: performer('p9', 'Priya Raman') }],
      defaultSetMin: 8,
    });

    expect(items.find((item) => item.performer === 'Priya Raman')?.durationMin).toBe(8);
  });

  it('gives every cue its own id, so two generates never collide', () => {
    const items = generateSchedule({ acts: ACTS, hostName: 'Renata Cruz' });
    const ids = new Set(items.map((item) => item.id));

    expect(ids.size).toBe(items.length);
  });

  // Nothing to hang a sheet off and nothing to hang on it.
  it('has nothing to write for an empty bill and no host', () => {
    expect(generateSchedule({ acts: [], doorsMin: 0 })).toEqual([]);
  });

  it('still opens the room when the bill is empty but doors are set', () => {
    const items = generateSchedule({ acts: [], doorsMin: 30 });
    expect(items.map((i) => i.description)).toEqual(['Doors — house music']);
  });
});

describe('runtime reporting', () => {
  const items = generateSchedule({
    acts: ACTS,
    hostName: 'Renata Cruz',
    introMin: 2,
  });

  it('adds the night up', () => {
    expect(scheduleRuntime(items)).toBe(30 + 5 + 10 + 2 + 15 + 2 + 25 + 4);
  });

  it('counts the handover time separately, since that is the surprise', () => {
    expect(handoverRuntime(items)).toBe(4);
  });
});
