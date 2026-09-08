import { describe, expect, it } from 'vitest';
import { describeGaps, lineupGaps, performerReadiness } from './performerReadiness';
import type { Performer } from '../types';

function performer(overrides: Partial<Performer> = {}): Performer {
  return { id: 'p1', name: 'Mona Sable', ...overrides };
}

describe('performerReadiness', () => {
  it('is complete when there is somewhere to send and something to tag', () => {
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

  it('blocks the contract when there is no address to send it to', () => {
    const readiness = performerReadiness(performer({ socialMedia: '@monasable' }));

    expect(readiness.canSendContract).toBe(false);
    expect(readiness.gaps).toEqual(['email']);
    expect(readiness.percent).toBe(50);
  });

  it('does not accept something that is not an address', () => {
    expect(performerReadiness(performer({ email: 'ask her' })).canSendContract).toBe(false);
    expect(performerReadiness(performer({ email: 'mona@' })).canSendContract).toBe(false);
    expect(performerReadiness(performer({ email: '  ' })).canSendContract).toBe(false);
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

  it('puts the people who cannot be contracted first', () => {
    expect(lineupGaps(lineup).map((entry) => entry.performer.name)).toEqual([
      'Bex Halloran',
      'Dev Okonjo',
      'Mona Sable',
    ]);
  });

  it('returns nothing when the whole lineup is ready', () => {
    expect(lineupGaps([lineup[0]])).toEqual([]);
  });
});
