import { describe, expect, it } from 'vitest';
import { groupKeyForSettings, groupKeyForShow, sameMeaning, sameValue, seg, underPath } from './paths';
import { fullShow } from './testFixtures';

describe('paths', () => {
  it('keeps any id to one segment', () => {
    expect(seg('a/b')).toBe('a%2Fb');
    expect(seg('a#b')).toBe('a%23b');
    expect(seg('__proto__')).toBe('__proto__');
    expect(seg('fan@example.com')).toBe('fan%40example.com');
    expect(`performers/${seg('x/y#z')}/email`.split('/')).toHaveLength(3);
  });

  it('finds keys under a place and nothing beside it', () => {
    expect(underPath('performers', 'performers')).toBe(true);
    expect(underPath('performers/p1/email', 'performers')).toBe(true);
    expect(underPath('performers#order', 'performers')).toBe(true);
    expect(underPath('performers/p1', 'performers/p1')).toBe(true);
    expect(underPath('performers/p10', 'performers/p1')).toBe(false);
    expect(underPath('performersX', 'performers')).toBe(false);
    expect(underPath('recap/attendance', 'recap')).toBe(true);
  });

  it('names groups', () => {
    expect(groupKeyForShow('s/1')).toBe('show:s/1');
    expect(groupKeyForSettings('brandName')).toBe('settings:workspace');
    expect(groupKeyForSettings('producers')).toBe('settings:workspace');
    expect(groupKeyForSettings('potentialComics')).toBe('settings:potentialComics');
    expect(groupKeyForSettings('contracts')).toBe('settings:contracts');
  });

  it('compares own keys only, in order for lists', () => {
    expect(sameValue({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
    expect(sameValue([1, 2], [2, 1])).toBe(false);
    expect(sameValue({ a: undefined }, {})).toBe(true);
    // An inherited property is not a value the object holds.
    expect(sameValue({ toString: undefined }, {})).toBe(true);
    expect(sameValue(Object.create({ a: 1 }), {})).toBe(true);
    expect(sameValue({ a: 1 }, Object.create({ a: 1 }))).toBe(false);
    expect(sameValue(NaN, NaN)).toBe(true);
    expect(sameValue('1', 1)).toBe(false);
    expect(sameValue(null, {})).toBe(false);
    expect(sameValue([], {})).toBe(false);
  });

  it('reads a show saved again, or given a viewer link, as the same show', () => {
    const show = fullShow();
    expect(sameMeaning(show, { ...show, updatedAt: 'later', createdAt: 'earlier', viewToken: undefined, viewerKey: undefined })).toBe(true);
    expect(sameMeaning(show, { ...show, recap: { ...show.recap, profitLoss: 1 } })).toBe(true);
    expect(sameMeaning(show, { ...show, venueName: 'Elsewhere' })).toBe(false);
    expect(sameMeaning(show, { ...show, recap: { ...show.recap, attendance: 1 } })).toBe(false);
  });
});
