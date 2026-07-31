import { describe, it, expect } from 'vitest';
import { buildTimeline, segmentLength, billBalance, clockLabel } from './showTimeline';
import type { ScheduleItem } from '../types';

const cue = (over: Partial<ScheduleItem>): ScheduleItem => ({
  id: 'c', time: '', description: '', ...over,
});

describe('buildTimeline', () => {
  it('has nothing to draw for an empty schedule', () => {
    expect(buildTimeline([])).toBeNull();
  });

  it('lays segments end to end, so the strip has no invented gaps', () => {
    const t = buildTimeline([
      cue({ id: 'a', description: 'Doors', durationMin: 15 }),
      cue({ id: 'b', description: 'Set', durationMin: 15 }),
    ])!;
    expect(t.segments.map((s) => s.startSec)).toEqual([0, 900]);
    expect(t.totalSec).toBe(1800);
  });

  it('sizes each segment by its share of the night', () => {
    const t = buildTimeline([
      cue({ id: 'a', description: 'Short', durationMin: 10 }),
      cue({ id: 'b', description: 'Long', durationMin: 30 }),
    ])!;
    expect(t.segments[0].widthPct).toBeCloseTo(25);
    expect(t.segments[1].widthPct).toBeCloseTo(75);
    expect(t.segments[0].startPct).toBeCloseTo(0);
    expect(t.segments[1].startPct).toBeCloseTo(25);
  });

  it('the widths add up to the whole strip', () => {
    const t = buildTimeline([
      cue({ id: 'a', description: 'A', durationMin: 7 }),
      cue({ id: 'b', description: 'B', durationMin: 11 }),
      cue({ id: 'c', description: 'C', durationMin: 13 }),
    ])!;
    const total = t.segments.reduce((sum, s) => sum + s.widthPct, 0);
    expect(total).toBeCloseTo(100);
  });

  it('separates who is on stage from what is only turnaround', () => {
    const t = buildTimeline([
      cue({ id: 'a', description: 'Doors', durationMin: 15 }),
      cue({ id: 'b', description: 'First set', durationMin: 10, performer: 'Ada Cole' }),
      cue({ id: 'c', description: 'Reset', durationMin: 5, performer: '   ' }),
    ])!;
    expect(t.segments.map((s) => s.kind)).toEqual(['break', 'set', 'break']);
  });

  it('names the longest segment, which is what the eye anchors on', () => {
    const t = buildTimeline([
      cue({ id: 'a', description: 'A', durationMin: 5 }),
      cue({ id: 'b', description: 'B', durationMin: 25 }),
      cue({ id: 'c', description: 'C', durationMin: 10 }),
    ])!;
    expect(t.longestId).toBe('b');
  });

  it('gives every segment a wall clock once one cue carries a time', () => {
    const t = buildTimeline([
      cue({ id: 'a', time: '20:00', description: 'Doors', durationMin: 15 }),
      cue({ id: 'b', description: 'First set', durationMin: 15 }),
    ])!;
    expect(t.segments[0].clock).toBe(clockLabel(20 * 60));
    expect(t.segments[1].clock).toBe(clockLabel(20 * 60 + 15));
  });

  it('works back from the first timed cue when earlier ones have no time', () => {
    // Doors is untimed and 30 min long; the first timed cue is 8:30 PM, so the
    // night starts at 8:00 PM.
    const t = buildTimeline([
      cue({ id: 'a', description: 'Doors', durationMin: 30 }),
      cue({ id: 'b', time: '20:30', description: 'First set', durationMin: 10 }),
    ])!;
    expect(t.startMinutes).toBe(20 * 60);
    expect(t.segments[0].clock).toBe(clockLabel(20 * 60));
  });

  it('falls back to the show start time when no cue carries one', () => {
    const t = buildTimeline([cue({ id: 'a', description: 'Doors', durationMin: 30 })], '19:30')!;
    expect(t.startMinutes).toBe(19 * 60 + 30);
  });

  it('has no clocks at all when nothing supplies a time', () => {
    const t = buildTimeline([cue({ id: 'a', description: 'Doors', durationMin: 30 })])!;
    expect(t.startMinutes).toBeNull();
    expect(t.endMinutes).toBeNull();
    expect(t.segments[0].clock).toBeNull();
  });

  it('reports the end of the night, not just the start', () => {
    const t = buildTimeline([
      cue({ id: 'a', time: '20:00', description: 'Doors', durationMin: 30 }),
      cue({ id: 'b', description: 'Set', durationMin: 30 }),
    ])!;
    expect(t.endMinutes).toBe(21 * 60);
  });

  it('labels an untitled cue rather than drawing a nameless block', () => {
    const t = buildTimeline([cue({ id: 'a', description: '  ', durationMin: 5 })])!;
    expect(t.segments[0].label).toBe('Untitled cue');
  });
});

describe('clockLabel', () => {
  it('wraps a show that runs past midnight instead of reading 25:00', () => {
    expect(clockLabel(24 * 60 + 30)).toBe(clockLabel(30));
  });
});

describe('segmentLength', () => {
  it('never rounds a real cue down to nothing', () => {
    expect(segmentLength(30)).toBe('1 min');
  });

  it('reads in hours once it runs long', () => {
    expect(segmentLength(3600)).toBe('1 hr');
    expect(segmentLength(3900)).toBe('1 hr 5 min');
  });
});

describe('billBalance', () => {
  const sets = (mins: number[]) =>
    buildTimeline(mins.map((m, i) => cue({ id: `s${i}`, description: `Set ${i}`, durationMin: m, performer: `P${i}` })))!.segments;

  it('compares the longest set against the shortest', () => {
    const b = billBalance(sets([10, 20]))!;
    expect(b.ratio).toBeCloseTo(2);
    expect(b.longest.performer).toBe('P1');
    expect(b.shortest.performer).toBe('P0');
  });

  it('ignores turnarounds, which are meant to be short', () => {
    const segments = buildTimeline([
      cue({ id: 'a', description: 'Doors', durationMin: 1 }),
      cue({ id: 'b', description: 'Set', durationMin: 10, performer: 'Ada' }),
      cue({ id: 'c', description: 'Set', durationMin: 10, performer: 'Miles' }),
    ])!.segments;
    expect(billBalance(segments)!.ratio).toBeCloseTo(1);
  });

  it('has nothing to say about a single-act bill', () => {
    expect(billBalance(sets([10]))).toBeNull();
  });
});
