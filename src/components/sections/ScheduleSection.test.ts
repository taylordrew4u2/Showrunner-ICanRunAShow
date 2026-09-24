import { describe, expect, it } from 'vitest';
import type { DJSong, ScheduleItem } from '../../types';
import { replaceWarning, undoableReplace } from './ScheduleSection';

function cue(partial: Partial<ScheduleItem> & { id: string }): ScheduleItem {
  return { time: '', description: 'Segment', ...partial };
}

describe('replacing a running order with a generated or template one', () => {
  it('tells the producer the cues come back with Undo', () => {
    const before = [cue({ id: 'a' }), cue({ id: 'b' }), cue({ id: 'c' })];
    expect(replaceWarning(before, [])).toBe('Undo brings the 3 cues back.');
    expect(replaceWarning([cue({ id: 'a' })], [])).toBe('Undo brings the 1 cue back.');
  });

  it('warns that music uploaded straight onto a cue is deleted and does not come back', () => {
    // The app frees an upload the moment nothing on the show points at it, so
    // the cues can be restored but the walk-in bed on them cannot.
    const before = [
      cue({ id: 'a', music: 'media:aaa#1', musicName: 'walk-in.mp3' }),
      cue({ id: 'b' }),
      cue({ id: 'c', music: 'media:ccc#2' }),
    ];
    expect(replaceWarning(before, [])).toBe(
      'Undo brings the 3 cues back, but not the music uploaded to 2 of them. That is deleted.',
    );
    expect(replaceWarning([before[0], before[1]], [])).toBe(
      'Undo brings the 2 cues back, but not the music uploaded to one of them. That is deleted.',
    );
  });

  it('does not count a cue that plays a song from the DJ list, whose file the song keeps', () => {
    const song: DJSong = { id: 's1', title: 'Intermission bed', artist: '', music: 'media:bed#1' };
    const before = [cue({ id: 'a', music: 'media:bed#1' }), cue({ id: 'b' })];
    expect(replaceWarning(before, [song])).toBe('Undo brings the 2 cues back.');
  });
});

describe('the way back after a running order was replaced', () => {
  const previous = [cue({ id: 'old-1' }), cue({ id: 'old-2' })];
  const stash = { cues: previous, byIds: ['new-1', 'new-2', 'new-3'] };

  it('is still offered when the section is opened again on the replaced order', () => {
    // The section unmounts when it is collapsed, so this is what survives a
    // look at the bill in between.
    const now = [cue({ id: 'new-1' }), cue({ id: 'new-2' }), cue({ id: 'new-3' })];
    expect(undoableReplace(now, stash)).toBe(stash);
  });

  it('survives the producer editing the new order a little', () => {
    const now = [cue({ id: 'new-1' }), cue({ id: 'added' })];
    expect(undoableReplace(now, stash)).toBe(stash);
  });

  it('is not offered on a different show, whose cues it would overwrite', () => {
    const otherShow = [cue({ id: 'x' }), cue({ id: 'y' })];
    expect(undoableReplace(otherShow, stash)).toBeNull();
  });

  it('is not offered once the replaced order is itself gone', () => {
    expect(undoableReplace([], stash)).toBeNull();
    expect(undoableReplace([cue({ id: 'new-1' })], null)).toBeNull();
  });
});
