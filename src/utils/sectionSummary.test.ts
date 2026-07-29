import { describe, it, expect } from 'vitest';
import {
  joinNames,
  formatRuntime,
  scheduleSummary,
  staffSummary,
  vendorsSummary,
} from './sectionSummary';
import type { ScheduleItem, StaffMember, Vendor } from '../types';

const cue = (over: Partial<ScheduleItem>): ScheduleItem => ({
  id: 'c', time: '', description: '', ...over,
});

describe('joinNames', () => {
  it('lists everything while the list is still glanceable', () => {
    expect(joinNames(['Alice', 'Bea', 'Cal'])).toBe('Alice, Bea, Cal');
  });

  it('caps the list rather than running off the card', () => {
    expect(joinNames(['Alice', 'Bea', 'Cal', 'Dee', 'Eli'])).toBe('Alice, Bea, Cal +2');
  });

  it('ignores blanks instead of emitting stray commas', () => {
    expect(joinNames(['Alice', '', undefined, '  ', 'Bea'])).toBe('Alice, Bea');
  });

  it('returns null when there is nothing to say', () => {
    expect(joinNames([])).toBeNull();
    expect(joinNames(['', '   ', undefined])).toBeNull();
  });

  it('counts the overflow against real entries only', () => {
    expect(joinNames(['Alice', 'Bea', 'Cal', '', 'Dee'], 3)).toBe('Alice, Bea, Cal +1');
  });
});

describe('formatRuntime', () => {
  it('reads naturally at each scale', () => {
    expect(formatRuntime(45 * 60)).toBe('45 min');
    expect(formatRuntime(60 * 60)).toBe('1 hr');
    expect(formatRuntime(70 * 60)).toBe('1 hr 10 min');
    expect(formatRuntime(125 * 60)).toBe('2 hr 5 min');
  });

  // "0 hr 70 min" and "1 hr 0 min" are the classic ways this goes wrong.
  it('never emits a zero component', () => {
    expect(formatRuntime(120 * 60)).toBe('2 hr');
    expect(formatRuntime(30 * 60)).not.toContain('hr');
  });

  it('has nothing to report for an empty show', () => {
    expect(formatRuntime(0)).toBeNull();
    expect(formatRuntime(-10)).toBeNull();
  });
});

describe('scheduleSummary', () => {
  it('gives the start time and the total runtime', () => {
    const schedule = [
      cue({ time: '20:00', description: 'Doors', durationMin: 15 }),
      cue({ time: '20:15', description: 'Host', durationMin: 5 }),
      cue({ time: '20:20', description: 'Headliner', durationMin: 50 }),
    ];
    expect(scheduleSummary(schedule)).toBe('8:00 PM · 1 hr 10 min');
  });

  it('still says something useful when cues have no clock times', () => {
    const summary = scheduleSummary([cue({ description: 'Doors' }), cue({ description: 'Set' })]);
    expect(summary).toBeTruthy();
  });

  it('is silent for an empty schedule', () => {
    expect(scheduleSummary([])).toBeNull();
  });
});

describe('staffSummary', () => {
  it('pairs each person with their role', () => {
    const staff: StaffMember[] = [
      { id: '1', role: 'Sound', personName: 'Emmy Cho' },
      { id: '2', role: 'Door', personName: 'Ana Diaz' },
    ];
    expect(staffSummary(staff)).toBe('Emmy Cho — Sound, Ana Diaz — Door');
  });

  it('drops the dash when there is no role to show', () => {
    expect(staffSummary([{ id: '1', role: '', personName: 'Emmy Cho' }])).toBe('Emmy Cho');
  });
});

describe('vendorsSummary', () => {
  const vendor = (over: Partial<Vendor>): Vendor => ({ id: 'v', name: 'Vendor', ...over });

  it('adds up what the vendors cost', () => {
    const vendors = [vendor({ name: 'Tacos', cost: 220 }), vendor({ name: 'Sound', cost: 200 })];
    expect(vendorsSummary(vendors)).toBe('Tacos, Sound · $420');
  });

  it('omits the total when nothing has a cost yet', () => {
    expect(vendorsSummary([vendor({ name: 'Tacos' })])).toBe('Tacos');
  });

  it('groups thousands so a big number is still readable at a glance', () => {
    expect(vendorsSummary([vendor({ name: 'Stage', cost: 4200 })])).toBe('Stage · $4,200');
  });

  it('is silent with no vendors', () => {
    expect(vendorsSummary([])).toBeNull();
  });
});
