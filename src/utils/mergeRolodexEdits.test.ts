import { describe, expect, it } from 'vitest';
import type { PotentialComic } from '../types';
import { mergeRolodexEdits } from './mergeRolodexEdits';

const ada: PotentialComic = {
  id: 'ada', name: 'Ada Cole', photo: 'media:old-headshot', socialMedia: '@ada',
  email: 'ada@example.com', credits: 'Late Night', notes: 'Original note',
};
const jo: PotentialComic = { id: 'jo', name: 'Jo Park' };

describe('mergeRolodexEdits', () => {
  it('keeps a newer headshot when a stale refresh did not edit the comic', () => {
    const current = [{ ...ada, photo: 'media:new-headshot' }];
    const merged = mergeRolodexEdits([ada], [{ ...ada }], current);
    expect(merged).toBe(current);
    expect(merged[0].photo).toBe('media:new-headshot');
  });

  it('applies only the edited fields, preserving newer unrelated metadata', () => {
    const current = [{
      ...ada, photo: 'media:new-headshot', phone: '+1 555 0100',
      videoLink: 'https://example.com/new-video', notes: 'Current note',
    }];
    const merged = mergeRolodexEdits([ada], [{ ...ada, email: 'new@example.com' }], current);
    expect(merged).toEqual([{ ...current[0], email: 'new@example.com' }]);
    expect(current[0].email).toBe('ada@example.com');
  });

  it('applies explicit field clears, including properties omitted by serialization', () => {
    const incoming = { ...ada, photo: undefined, credits: undefined };
    delete incoming.socialMedia;
    const current = [{ ...ada, notes: 'Newer notes' }];
    const merged = mergeRolodexEdits([ada], [incoming], current);
    expect(merged[0]).toMatchObject({
      photo: undefined, socialMedia: undefined, credits: undefined, notes: 'Newer notes',
    });
  });

  it('applies explicit deletion while keeping comics added after the snapshot', () => {
    const current = [{ ...ada, photo: 'media:new-headshot' }, jo];
    const merged = mergeRolodexEdits([ada], [], current);
    expect(merged).toEqual([jo]);
    expect(merged[0]).toBe(jo);
  });

  it('does not resurrect a comic removed from current, even with stale profile edits', () => {
    const current = [jo];
    expect(mergeRolodexEdits([ada], [{ ...ada, notes: 'Stale edit' }], current)).toBe(current);
  });

  it('keeps concurrent additions and files genuinely new incoming entries', () => {
    const newComic: PotentialComic = { id: 'new', name: 'Sam Lee', photo: 'media:sam' };
    const current = [jo, { ...ada, photo: 'media:new-headshot' }];
    const merged = mergeRolodexEdits([ada], [newComic, ada], current);
    expect(merged).toEqual([newComic, ...current]);
    expect(merged[0]).toBe(newComic);
    expect(merged[1]).toBe(jo);
    expect(merged[2]).toBe(current[1]);
  });

  it('does not overwrite a matching concurrent addition absent from the baseline', () => {
    const current = [{ ...jo, photo: 'media:jo-new' }];
    expect(mergeRolodexEdits([], [jo], current)).toBe(current);
  });

  it('preserves array and unchanged record identity when an edit already matches current', () => {
    const edited = { ...ada, name: 'Ada Renamed' };
    const current = [jo, edited];
    expect(mergeRolodexEdits([ada], [edited], current)).toBe(current);
  });

  it('preserves untouched record identity while updating another comic', () => {
    const current = [ada, jo];
    const merged = mergeRolodexEdits([ada, jo], [{ ...ada, name: 'Ada Renamed' }, jo], current);
    expect(merged).not.toBe(current);
    expect(merged[0].name).toBe('Ada Renamed');
    expect(merged[1]).toBe(jo);
  });
});
