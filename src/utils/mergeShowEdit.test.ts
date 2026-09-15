import { describe, expect, it } from 'vitest';
import type { Artist, Performer, Show } from '../types';
import { mergeShowEdit } from './mergeShowEdit';

const ada: Performer = { id: 'ada-slot', comicId: 'ada', name: 'Ada Cole', photo: 'media:old-photo', email: 'ada@example.com' };
const jo: Performer = { id: 'jo-slot', comicId: 'jo', name: 'Jo Park', socialMedia: '@jo' };
const newSlot: Performer = { id: 'new-slot', comicId: 'new', name: 'Sam Lee' };
const show = (over: Partial<Show> = {}): Show => ({
  id: 'show', name: 'Comedy Night', date: '2026-12-01', time: '20:00', location: '', venueName: '', status: 'upcoming',
  performers: [ada, jo], artists: [], schedule: [], hosts: [], djSongs: [], staff: [], expenses: [],
  createdAt: '2026-09-15', updatedAt: '2026-09-15', ...over,
});

describe('mergeShowEdit', () => {
  it('keeps current profiles when a stale to-do edit finishes', () => {
    const baseline = show({ todos: [{ id: 'todo', text: 'Check lights', completed: false }] });
    const current = { ...baseline, performers: [{ ...ada, photo: 'media:new-photo' }, jo] };
    const merged = mergeShowEdit(baseline, { ...baseline, todos: [] }, current);
    expect(merged.todos).toEqual([]);
    expect(merged.performers).toBe(current.performers);
  });

  it('applies one performer field without reverting another performer or new slots', () => {
    const baseline = show();
    const current = { ...baseline, performers: [{ ...ada, photo: 'media:new-photo' }, { ...jo, socialMedia: '@newjo' }, newSlot] };
    const incoming = { ...baseline, performers: [{ ...ada, email: 'new@example.com' }, jo] };
    const merged = mergeShowEdit(baseline, incoming, current);
    expect(merged.performers).toEqual([{ ...current.performers[0], email: 'new@example.com' }, current.performers[1], newSlot]);
    expect(merged.performers[1]).toBe(current.performers[1]);
    expect(merged.performers[2]).toBe(newSlot);
  });

  it('applies explicit removal while retaining a concurrent addition', () => {
    const baseline = show();
    const current = { ...baseline, performers: [ada, jo, newSlot] };
    expect(mergeShowEdit(baseline, { ...baseline, performers: [jo] }, current).performers).toEqual([jo, newSlot]);
  });

  it('does not resurrect a removed slot through a late upload', () => {
    const baseline = show();
    const current = { ...baseline, performers: [jo] };
    const incoming = { ...baseline, performers: [{ ...ada, photo: 'media:late-upload' }, jo] };
    expect(mergeShowEdit(baseline, incoming, current)).toBe(current);
  });

  it('retains a concurrent reorder when the stale editor changed only a field', () => {
    const baseline = show();
    const current = { ...baseline, performers: [jo, ada] };
    const incoming = { ...baseline, performers: [{ ...ada, email: 'new@example.com' }, jo] };
    expect(mergeShowEdit(baseline, incoming, current).performers).toEqual([jo, { ...ada, email: 'new@example.com' }]);
  });

  it('applies an intentional reorder without dropping concurrent slots', () => {
    const baseline = show();
    const current = { ...baseline, performers: [ada, newSlot, jo] };
    expect(mergeShowEdit(baseline, { ...baseline, performers: [jo, ada] }, current).performers).toEqual([jo, newSlot, ada]);
  });

  it('inserts genuinely new incoming slots while preserving concurrent additions', () => {
    const baseline = show();
    const anotherSlot: Performer = { id: 'another-slot', name: 'Lee Tan' };
    const current = { ...baseline, performers: [ada, newSlot, jo] };
    const incoming = { ...baseline, performers: [ada, anotherSlot, jo] };
    expect(mergeShowEdit(baseline, incoming, current).performers).toEqual([ada, anotherSlot, newSlot, jo]);
  });

  it('merges artist type and clears without reverting newer shared metadata', () => {
    const artist: Artist = { ...ada, artistType: 'Singer' };
    const baseline = show({ artists: [artist], productionNotes: 'Old note' });
    const current = { ...baseline, artists: [{ ...artist, photo: 'media:new-photo', phone: '+1 555 0100' }], venueName: 'New room' };
    const incoming = { ...baseline, artists: [{ ...artist, artistType: 'Musician', email: undefined }], productionNotes: undefined };
    const merged = mergeShowEdit(baseline, incoming, current);
    expect(merged.artists).toEqual([{ ...current.artists[0], artistType: 'Musician', email: undefined }]);
    expect(merged.productionNotes).toBeUndefined();
    expect(merged.venueName).toBe('New room');
  });

  it('preserves identity for cloned but unchanged incoming snapshots', () => {
    const baseline = show();
    const current = { ...baseline, performers: [{ ...ada, photo: 'media:new-photo' }, jo], venueName: 'New room' };
    expect(mergeShowEdit(baseline, structuredClone(baseline), current)).toBe(current);
  });

  it("updates the edited show's linked cue label when a comic is renamed", () => {
    const cue = { id: 'cue', time: '20:00', description: 'Comedy set', performerId: ada.id, performer: ada.name };
    const baseline = show({ schedule: [cue] });
    const incoming = { ...baseline, performers: [{ ...ada, name: 'Ada Renamed' }, jo] };
    const merged = mergeShowEdit(baseline, incoming, baseline);
    expect(merged.schedule[0]).toEqual({ ...cue, performer: 'Ada Renamed' });
  });

  it('preserves custom cue labels during a rename and unrelated cue edits', () => {
    const cue = { id: 'cue', time: '20:00', description: 'Comedy set', performerId: ada.id, performer: ada.name };
    const baseline = show({ schedule: [cue] });
    const current = { ...baseline, schedule: [{ ...cue, performer: 'Surprise guest' }] };
    const incoming = {
      ...baseline, performers: [{ ...ada, name: 'Ada Renamed' }, jo],
      schedule: [{ ...cue, time: '20:15' }],
    };
    const merged = mergeShowEdit(baseline, incoming, current);
    expect(merged.schedule[0]).toEqual({ ...cue, time: '20:15', performer: 'Surprise guest' });
  });

});
