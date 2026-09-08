import { describe, expect, it } from 'vitest';
import {
  formatClock,
  generateSchedule,
  handoverRuntime,
  parseClock,
  scheduleEndTime,
  scheduleRuntime,
} from './generateSchedule';
import type { Performer } from '../types';

function performer(id: string, name: string): Performer {
  return { id, name };
}

const ACTS = [
  { performer: performer('p1', 'Dev Okonjo'), durationMin: 10, role: 'Guest' },
  { performer: performer('p2', 'Mona Sable'), durationMin: 15, role: 'Feature' },
  { performer: performer('p3', 'Kit Anders'), durationMin: 25, role: 'Headliner' },
];

describe('parseClock', () => {
  it('reads the time a show is stored with', () => {
    expect(parseClock('20:00')).toBe(1200);
    expect(parseClock('09:30')).toBe(570);
    expect(parseClock('0:05')).toBe(5);
  });

  it('rejects what is not a time rather than guessing at it', () => {
    expect(parseClock('')).toBeNull();
    expect(parseClock('8pm')).toBeNull();
    expect(parseClock('25:00')).toBeNull();
    expect(parseClock('20:75')).toBeNull();
  });
});

describe('formatClock', () => {
  it('pads to HH:MM so times line up in a column', () => {
    expect(formatClock(1200)).toBe('20:00');
    expect(formatClock(570)).toBe('09:30');
  });

  it('wraps past midnight, because late shows do', () => {
    expect(formatClock(1500)).toBe('01:00');
  });
});

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

    expect(items.map((item) => `${item.time} ${item.description}`)).toEqual([
      '20:00 Doors — house music',
      '20:30 Welcome, rules, first intro',
      '20:35 Guest',
      '20:45 Intro — Mona Sable',
      '20:46 Feature',
      '21:01 Intro — Kit Anders',
      '21:02 Headliner',
      '21:27 Outro and plugs',
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

  it('returns nothing rather than hanging a night off the wrong hour', () => {
    expect(generateSchedule({ startTime: 'doors at 8', acts: ACTS })).toEqual([]);
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
    expect(scheduleEndTime('20:00', items)).toBe('21:33');
  });

  it('counts the handover time separately, since that is the surprise', () => {
    expect(handoverRuntime(items)).toBe(4);
  });
});
