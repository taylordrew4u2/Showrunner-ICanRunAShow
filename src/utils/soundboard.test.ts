import { describe, it, expect } from 'vitest';
import { buildSoundboard, cuePerformerName, resolveCuePerformer, soundboardSources } from './soundboard';
import type { DJSong, Performer, ScheduleItem } from '../types';

const cue = (over: Partial<ScheduleItem>): ScheduleItem => ({
  id: 'c', time: '', description: '', ...over,
});
const performer = (over: Partial<Performer> & { id: string; name: string }): Performer => ({ ...over });
const song = (over: Partial<DJSong> & { id: string }): DJSong => ({
  title: '', artist: '', ...over,
});

describe('resolveCuePerformer', () => {
  const roster = [performer({ id: 'p1', name: 'Ada Cole' })];

  it('follows the linked performer id', () => {
    expect(resolveCuePerformer(cue({ performerId: 'p1' }), roster)?.name).toBe('Ada Cole');
  });

  it('falls back to an exact name match, ignoring case and padding', () => {
    expect(resolveCuePerformer(cue({ performer: '  ada cole ' }), roster)?.id).toBe('p1');
  });

  it('will not guess from a partial name or a mention in the description', () => {
    expect(resolveCuePerformer(cue({ performer: 'Ada' }), roster)).toBeNull();
    expect(resolveCuePerformer(cue({ description: 'Ada Cole closes' }), roster)).toBeNull();
  });

  it('handles a missing cue and an unknown id', () => {
    expect(resolveCuePerformer(undefined, roster)).toBeNull();
    expect(resolveCuePerformer(cue({ performerId: 'nope' }), roster)).toBeNull();
  });
});

describe('cuePerformerName', () => {
  it('prefers the record, then the free-text name', () => {
    const roster = [performer({ id: 'p1', name: 'Ada Cole' })];
    expect(cuePerformerName(cue({ performerId: 'p1', performer: 'typo' }), roster)).toBe('Ada Cole');
    expect(cuePerformerName(cue({ performer: 'Guest Drop-In' }), roster)).toBe('Guest Drop-In');
    expect(cuePerformerName(cue({ description: 'Doors' }), roster)).toBe('');
  });
});

describe('buildSoundboard', () => {
  it('gives every performer with a walk-on one button, in running order', () => {
    const roster = [
      performer({ id: 'p1', name: 'Ada Cole', walkOnMusic: 'media:ada#1', walkOnMusicName: 'Intro', walkOnMusicArtist: 'The Band' }),
      performer({ id: 'p2', name: 'Jo Park', walkOnMusic: 'media:jo#1' }),
    ];
    const board = buildSoundboard(
      [cue({ id: 'c1', performerId: 'p2' }), cue({ id: 'c2', performerId: 'p1' })],
      roster,
    );
    expect(board.performers.map((t) => t.label)).toEqual(['Jo Park', 'Ada Cole']);
    expect(board.performers[1]).toMatchObject({
      key: 'performer:p1',
      src: 'media:ada#1',
      sublabel: 'Intro — The Band',
      initial: 'A',
      cueIndex: 1,
    });
  });

  it('lets a cue upload override that performer’s stored walk-on', () => {
    const roster = [performer({ id: 'p1', name: 'Ada Cole', walkOnMusic: 'media:walkon#1' })];
    const board = buildSoundboard(
      [cue({ id: 'c1', performerId: 'p1', music: 'media:special#1', musicName: 'Tonight only.mp3' })],
      roster,
    );
    expect(board.performers).toHaveLength(1);
    expect(board.performers[0]).toMatchObject({ src: 'media:special#1', sublabel: 'Tonight only.mp3' });
  });

  it('gives a performer with two cues only one button', () => {
    const roster = [performer({ id: 'p1', name: 'Ada Cole', walkOnMusic: 'media:ada#1' })];
    const board = buildSoundboard(
      [cue({ id: 'c1', performerId: 'p1' }), cue({ id: 'c2', performerId: 'p1' })],
      roster,
    );
    expect(board.performers).toHaveLength(1);
  });

  it('skips performers who have no song at all', () => {
    const board = buildSoundboard(
      [cue({ id: 'c1', performerId: 'p1' })],
      [performer({ id: 'p1', name: 'Ada Cole' })],
    );
    expect(board.performers).toEqual([]);
  });

  it('still gives a button to a performer the schedule never reaches', () => {
    const board = buildSoundboard(
      [cue({ id: 'c1', description: 'Doors' })],
      [performer({ id: 'p9', name: 'Late Add', walkOnMusic: 'media:late#1' })],
    );
    expect(board.performers.map((t) => t.key)).toEqual(['performer:p9']);
    expect(board.performers[0].cueIndex).toBeUndefined();
  });

  it('keeps ownerless cue uploads as their own bank', () => {
    const board = buildSoundboard(
      [
        cue({ id: 'c1', description: 'Walk-in music', music: 'media:walkin#1', musicName: 'Bed.mp3' }),
        cue({ id: 'c2', description: '', music: 'media:sting#1' }),
      ],
      [],
    );
    expect(board.cues.map((t) => t.key)).toEqual(['cue:c1', 'cue:c2']);
    expect(board.cues[0]).toMatchObject({ label: 'Walk-in music', sublabel: 'Bed.mp3' });
    expect(board.cues[1].label).toBe('Cue 2');
    expect(board.performers).toEqual([]);
  });

  it('does not put a performer’s cue music in the cue bank', () => {
    const board = buildSoundboard(
      [cue({ id: 'c1', performerId: 'p1', music: 'media:special#1' })],
      [performer({ id: 'p1', name: 'Ada Cole' })],
    );
    expect(board.cues).toEqual([]);
    expect(board.performers.map((t) => t.src)).toEqual(['media:special#1']);
  });

  it('builds DJ buttons only for songs that were actually uploaded', () => {
    const board = buildSoundboard([], [], [
      song({ id: 's1', title: 'Closer', artist: 'The Band', music: 'media:closer#1' }),
      song({ id: 's2', title: 'No upload' }),
      song({ id: 's3', title: '', musicName: 'untitled.mp3', music: 'media:x#1' }),
    ]);
    expect(board.dj.map((t) => t.key)).toEqual(['dj:s1', 'dj:s3']);
    expect(board.dj[0]).toMatchObject({ label: 'Closer', sublabel: 'The Band', initial: 'C' });
    expect(board.dj[1].label).toBe('untitled.mp3');
  });

  it('keeps the DJ bank separate from the performer bank', () => {
    const board = buildSoundboard(
      [cue({ id: 'c1', performerId: 'p1' })],
      [performer({ id: 'p1', name: 'Ada Cole', walkOnMusic: 'media:ada#1' })],
      [song({ id: 's1', title: 'Closer', music: 'media:closer#1' })],
    );
    expect(board.performers.map((t) => t.key)).toEqual(['performer:p1']);
    expect(board.dj.map((t) => t.key)).toEqual(['dj:s1']);
  });

  it('handles an empty show', () => {
    expect(buildSoundboard([], [])).toEqual({ performers: [], cues: [], dj: [] });
  });
});

describe('soundboardSources', () => {
  it('lists every source once, so a shared track only decodes once', () => {
    const board = buildSoundboard(
      [cue({ id: 'c1', description: 'Bed', music: 'media:shared#1' })],
      [performer({ id: 'p1', name: 'Ada Cole', walkOnMusic: 'media:shared#1' })],
      [song({ id: 's1', title: 'Closer', music: 'media:closer#1' })],
    );
    expect(soundboardSources(board).sort()).toEqual(['media:closer#1', 'media:shared#1']);
  });
});
