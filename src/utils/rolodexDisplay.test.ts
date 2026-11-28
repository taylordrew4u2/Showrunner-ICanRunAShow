import { describe, expect, it } from 'vitest';
import { MONOGRAM_TONES, monogramInitials, monogramTone, rolodexFacts, rolodexSummary } from './rolodexDisplay';
import type { PotentialComic } from '../types';

const comic = (over: Partial<PotentialComic> = {}): PotentialComic => ({ id: 'c1', name: 'Mona Sable', ...over });

describe('the monogram that stands in for a headshot', () => {
  it('is the first and last initial, in capitals', () => {
    expect(monogramInitials('Mona Sable')).toBe('MS');
    expect(monogramInitials('  priya   raghunathan ')).toBe('PR');
    expect(monogramInitials('Ada Maria Brightwater')).toBe('AB');
  });

  it('is one letter for a single name', () => {
    expect(monogramInitials('Jo')).toBe('J');
    expect(monogramInitials('cher')).toBe('C');
  });

  it('does not take a generational suffix for a surname', () => {
    expect(monogramInitials('Bartholomew Featherstonehaugh-Montgomery III')).toBe('BF');
    expect(monogramInitials('Sam Lee Jr.')).toBe('SL');
    // A suffix on its own is the whole name, so it is all there is to show.
    expect(monogramInitials('III')).toBe('I');
  });

  it('reads past punctuation to the letter', () => {
    expect(monogramInitials('"Big" Lou Park')).toBe('BP');
    expect(monogramInitials("D'Arcy O'Neil")).toBe('DO');
    expect(monogramInitials('Lou & the Band')).toBe('LB');
    expect(monogramInitials('2 Tone Tina')).toBe('2T');
  });

  it('marks a name in a joined script by its first letter alone', () => {
    // Two Arabic initials set together fuse into a shape that is neither.
    expect(monogramInitials('نور حداد')).toBe('ن');
    expect(monogramInitials('Élodie Çelik')).toBe('ÉÇ');
  });

  it('is empty when there is no letter to show', () => {
    expect(monogramInitials('')).toBe('');
    expect(monogramInitials('   ')).toBe('');
    expect(monogramInitials('— —')).toBe('');
  });
});

describe('the tint under a monogram', () => {
  it('is one of the tints the stylesheet defines', () => {
    for (const name of ['Mona Sable', 'Dev Okonjo', 'Jo', '', 'نور حداد', 'Bartholomew Featherstonehaugh-Montgomery III']) {
      const tone = monogramTone(name);
      expect(Number.isInteger(tone), name).toBe(true);
      expect(tone, name).toBeGreaterThanOrEqual(1);
      expect(tone, name).toBeLessThanOrEqual(MONOGRAM_TONES);
    }
  });

  it('is the same for the same person every time, however the name is cased or padded', () => {
    expect(monogramTone('Mona Sable')).toBe(monogramTone('Mona Sable'));
    expect(monogramTone('  mona sable ')).toBe(monogramTone('Mona Sable'));
  });

  it('is dealt across the tints, not one tint for everybody', () => {
    const names = ['Mona Sable', 'Dev Okonjo', 'Priya Raghunathan', 'Sam Lee', 'Ada Brightwater', 'Lou Park', 'Theo Marsh', 'Wren Castellanos', 'Imani Rhodes', 'Jo'];
    expect(new Set(names.map(monogramTone)).size).toBeGreaterThan(1);
  });
});

describe('the quiet line under a Rolodex name', () => {
  it('is empty for a bare name', () => {
    expect(rolodexFacts(comic())).toEqual([]);
  });

  it('leads with the handle, then the tape, then the walk-on', () => {
    expect(rolodexFacts(comic({
      socialMedia: '@monasable', videoLink: 'https://youtu.be/mona', tapeMinutes: 10,
      walkOnMusicName: 'Opening track', walkOnMusicArtist: 'The House Band',
    }))).toEqual(['@monasable', '10-minute tape', 'Opening track — The House Band']);
  });

  it('shows a profile link as the handle it carries', () => {
    expect(rolodexFacts(comic({ socialMedia: 'https://www.instagram.com/mona.sable.official' }))).toEqual(['@mona.sable.official']);
    expect(rolodexFacts(comic({ socialMedia: 'monasable' }))).toEqual(['@monasable']);
  });

  it('shows what was typed when it is not a handle', () => {
    expect(rolodexFacts(comic({ socialMedia: 'ask her manager' }))).toEqual(['ask her manager']);
  });

  it('says there is a tape even when its length was never set', () => {
    expect(rolodexFacts(comic({ videoLink: 'https://youtu.be/mona' }))).toEqual(['Tape']);
    expect(rolodexFacts(comic({ tapeMinutes: 5 }))).toEqual(['5-minute tape']);
  });

  it('never carries their email, phone or notes', () => {
    const facts = rolodexFacts(comic({ email: 'mona@example.com', phone: '212-555-0198', notes: 'Closes strong.', credits: 'Host of the Late Set' }));
    expect(facts).toEqual([]);
  });
});

describe('the count above the Rolodex', () => {
  const term = { singular: 'Comic', plural: 'Comics' };
  const complete = { email: 'a@example.com', socialMedia: '@a' };

  it('counts the people, in the word this producer uses for them', () => {
    expect(rolodexSummary([comic(complete)], term)).toBe('1 comic');
    expect(rolodexSummary([comic(complete), comic({ id: 'c2', ...complete })], term)).toBe('2 comics');
    expect(rolodexSummary([comic(complete), comic({ id: 'c2', ...complete })], { singular: 'Queen', plural: 'Queens' })).toBe('2 queens');
  });

  it('says how many still have a detail to get, by the rule each row uses', () => {
    expect(rolodexSummary([comic(complete), comic({ id: 'c2' }), comic({ id: 'c3', email: 'c@example.com' })], term))
      .toBe('3 comics · 2 missing details');
  });

  it('says nothing about gaps when there are none', () => {
    expect(rolodexSummary([comic(complete)], term)).not.toContain('missing');
  });
});
