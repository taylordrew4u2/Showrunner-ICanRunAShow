import { describe, expect, it } from 'vitest';
import {
  generateSchedule,
  handoverRuntime,
  scheduleEndTime,
  scheduleRuntime,
} from './generateSchedule';
import { clockLabel } from './showTimeline';
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
    const items = generateSchedule({ startTime: '20:00', acts: ACTS, hostName: 'Renata Cruz' });
    const intros = items.filter((item) => item.description.startsWith('Intro — '));

    // three acts, but the first is introduced inside the welcome
    expect(intros).toHaveLength(2);
    expect(intros[0].description).toBe('Intro — Mona Sable');
    expect(intros[1].description).toBe('Intro — Kit Anders');
  });

  it('times every cue from doors, so the running order is real clock time', () => {
    const items = generateSchedule({
      startTime: '20:00',
      acts: ACTS,
      hostName: 'Renata Cruz',
      doorsMin: 30,
      welcomeMin: 5,
      introMin: 1,
    });

    // clockLabel renders in the viewer's locale, so the expectation is built
    // the same way the app builds it rather than hard-coding one region's format.
    expect(items.map((item) => `${item.time} ${item.description}`)).toEqual([
      `${clockLabel(20 * 60)} Doors — house music`,
      `${clockLabel(20 * 60 + 30)} Welcome, rules, first intro`,
      `${clockLabel(20 * 60 + 35)} Guest`,
      `${clockLabel(20 * 60 + 45)} Intro — Mona Sable`,
      `${clockLabel(20 * 60 + 46)} Feature`,
      `${clockLabel(21 * 60 + 1)} Intro — Kit Anders`,
      `${clockLabel(21 * 60 + 2)} Headliner`,
      `${clockLabel(21 * 60 + 27)} Outro and plugs`,
    ]);
  });

  it('links each act back to its performer, so walk-on music still fires', () => {
    const items = generateSchedule({ startTime: '20:00', acts: ACTS, hostName: 'Renata Cruz' });
    const feature = items.find((item) => item.description === 'Feature');

    expect(feature?.performerId).toBe('p2');
    expect(feature?.performer).toBe('Mona Sable');
  });

  it('drops an interval in where asked, but never after the closer', () => {
    const withBreak = generateSchedule({
      startTime: '20:00',
      acts: ACTS,
      hostName: 'Renata Cruz',
      intermissionAfter: 2,
    });
    expect(withBreak.filter((item) => item.description === 'Intermission')).toHaveLength(1);

    const afterLast = generateSchedule({
      startTime: '20:00',
      acts: ACTS,
      hostName: 'Renata Cruz',
      intermissionAfter: 3,
    });
    expect(afterLast.filter((item) => item.description === 'Intermission')).toHaveLength(0);
  });

  it('writes no handovers when nobody is hosting', () => {
    const items = generateSchedule({ startTime: '20:00', acts: ACTS });

    expect(items.some((item) => item.description.startsWith('Intro — '))).toBe(false);
    expect(items.some((item) => item.description === 'Outro and plugs')).toBe(false);
  });

  it('falls back to a default length for an act with no set time', () => {
    const items = generateSchedule({
      startTime: '20:00',
      acts: [{ performer: performer('p9', 'Priya Raman') }],
      defaultSetMin: 8,
    });

    expect(items.find((item) => item.performer === 'Priya Raman')?.durationMin).toBe(8);
  });

  it('gives every cue its own id, so two generates never collide', () => {
    const items = generateSchedule({ startTime: '20:00', acts: ACTS, hostName: 'Renata Cruz' });
    const ids = new Set(items.map((item) => item.id));

    expect(ids.size).toBe(items.length);
  });

  it('reads the start time however the show stored it', () => {
    const evening = generateSchedule({ startTime: '8:00 PM', acts: ACTS });
    const twentyFour = generateSchedule({ startTime: '20:00', acts: ACTS });
    const terse = generateSchedule({ startTime: '8pm', acts: ACTS });

    expect(evening[0].time).toBe(clockLabel(20 * 60));
    expect(twentyFour[0].time).toBe(evening[0].time);
    expect(terse[0].time).toBe(evening[0].time);
  });

  it('returns nothing rather than hanging a night off the wrong hour', () => {
    expect(generateSchedule({ startTime: 'doors at 8', acts: ACTS })).toEqual([]);
    expect(generateSchedule({ startTime: '', acts: ACTS })).toEqual([]);
  });
});

describe('runtime reporting', () => {
  const items = generateSchedule({
    startTime: '20:00',
    acts: ACTS,
    hostName: 'Renata Cruz',
    introMin: 2,
  });

  it('adds the night up', () => {
    expect(scheduleRuntime(items)).toBe(30 + 5 + 10 + 2 + 15 + 2 + 25 + 4);
  });

  it('says when the room gets its stage back', () => {
    expect(scheduleEndTime('20:00', items)).toBe(clockLabel(21 * 60 + 33));
    expect(scheduleEndTime('not a time', items)).toBe('');
  });

  it('counts the handover time separately, since that is the surprise', () => {
    expect(handoverRuntime(items)).toBe(4);
  });
});
