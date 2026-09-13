import { describe, expect, it } from 'vitest';
import { describeGaps, lineupGaps, performerReadiness } from './performerReadiness';
import type { Performer } from '../types';

function performer(overrides: Partial<Performer> = {}): Performer {
  return { id: 'p1', name: 'Mona Sable', ...overrides };
}

describe('performerReadiness', () => {
  it('is complete when email and social handle are saved', () => {
    const readiness = performerReadiness(
      performer({ email: 'mona@example.com', socialMedia: '@monasable' }),
    );

    expect(readiness).toEqual({
      canSendContract: true,
      canTag: true,
      gaps: [],
      percent: 100,
    });
  });

  it('allows a contract link without an email while reporting incomplete contact details', () => {
    const readiness = performerReadiness(performer({ socialMedia: '@monasable' }));

    expect(readiness.canSendContract).toBe(true);
    expect(readiness.gaps).toEqual(['email']);
    expect(readiness.percent).toBe(50);
  });

  it('allows contract links even when the saved email is blank or invalid', () => {
    expect(performerReadiness(performer({ email: 'ask her' })).canSendContract).toBe(true);
    expect(performerReadiness(performer({ email: 'mona@' })).canSendContract).toBe(true);
    expect(performerReadiness(performer({ email: '  ' })).canSendContract).toBe(true);
  });

  it('counts a pasted profile link as taggable', () => {
    const readiness = performerReadiness(
      performer({ email: 'mona@example.com', socialMedia: 'https://instagram.com/monasable' }),
    );

    expect(readiness.canTag).toBe(true);
  });

  it('reports both gaps for someone booked off a text message', () => {
    const readiness = performerReadiness(performer({ name: 'Dev Okonjo' }));

    expect(readiness.gaps).toEqual(['email', 'social']);
    expect(readiness.percent).toBe(0);
  });
});

describe('describeGaps', () => {
  it('reads as something to put in front of a producer', () => {
    expect(describeGaps(['email', 'social'])).toBe('Email, Social handle');
    expect(describeGaps([])).toBe('');
  });
});

describe('lineupGaps', () => {
  const lineup: Performer[] = [
    performer({ id: 'p1', name: 'Renata Cruz', email: 'renata@example.com', socialMedia: '@renata' }),
    performer({ id: 'p2', name: 'Mona Sable', email: 'mona@example.com' }),
    performer({ id: 'p3', name: 'Dev Okonjo' }),
    performer({ id: 'p4', name: 'Bex Halloran', socialMedia: '@bex' }),
  ];

  it('leaves out everyone who is ready', () => {
    expect(lineupGaps(lineup).map((entry) => entry.performer.name)).not.toContain('Renata Cruz');
  });

  it('puts profiles with the most missing details first', () => {
    expect(lineupGaps(lineup).map((entry) => entry.performer.name)).toEqual([
      'Dev Okonjo',
      'Bex Halloran',
      'Mona Sable',
    ]);
  });

  it('returns nothing when the whole lineup is ready', () => {
    expect(lineupGaps([lineup[0]])).toEqual([]);
  });
});
