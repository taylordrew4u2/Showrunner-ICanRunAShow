import { describe, it, expect } from 'vitest';
import { lineupProgress } from './lineupTarget';

describe('lineupProgress', () => {
  it('has no "full" without a target', () => {
    // A lineup with no target can't be full, however many are booked.
    const p = lineupProgress(9, undefined);
    expect(p.targetSet).toBe(false);
    expect(p.full).toBe(false);
    expect(p.label).toBe('');
    expect(p.shortLabel).toBe('');
  });

  it('treats a zero or negative target as no target at all', () => {
    expect(lineupProgress(3, 0).targetSet).toBe(false);
    expect(lineupProgress(3, -2).targetSet).toBe(false);
  });

  it('counts down the spots left', () => {
    const p = lineupProgress(3, 5);
    expect(p.full).toBe(false);
    expect(p.spotsLeft).toBe(2);
    expect(p.label).toBe('3 of 5 booked · 2 spots left');
    expect(p.shortLabel).toBe('3 of 5 booked');
  });

  it('says spot, not spots, for the last one', () => {
    expect(lineupProgress(4, 5).label).toBe('4 of 5 booked · 1 spot left');
  });

  it('is full the moment the target is met', () => {
    const p = lineupProgress(5, 5);
    expect(p.full).toBe(true);
    expect(p.spotsLeft).toBe(0);
    expect(p.over).toBe(0);
    expect(p.label).toBe('Full — 5 of 5 booked');
    expect(p.shortLabel).toBe('Full · 5 of 5');
  });

  it('stays full when overbooked, and says by how many', () => {
    const p = lineupProgress(7, 5);
    expect(p.full).toBe(true);
    expect(p.over).toBe(2);
    expect(p.label).toBe('Full — 7 booked, 2 over');
    expect(p.shortLabel).toBe('Full · 7 of 5, 2 over');
  });

  it('is not full with an empty lineup', () => {
    const p = lineupProgress(0, 5);
    expect(p.full).toBe(false);
    expect(p.shortLabel).toBe('0 of 5 booked');
  });
});
