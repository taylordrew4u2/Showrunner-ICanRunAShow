import { describe, it, expect } from 'vitest';
import { liveMediaIds, orphanedRefs, settingsMediaRefs, showMediaRefs, unreferencedMedia } from './mediaCleanup';
import { DEFAULT_SETTINGS } from '../types';
import type { AppSettings, Show } from '../types';

const show = (over: Partial<Show> = {}): Show => ({
  id: 's1', name: 'Show', date: '', time: '', location: '', venueName: '',
  status: 'upcoming', performers: [], artists: [], schedule: [], hosts: [],
  djSongs: [], staff: [], vendors: [], expenses: [],
  createdAt: '', updatedAt: '', ...over,
});

const settings = (over: Partial<AppSettings> = {}): AppSettings => ({
  ...DEFAULT_SETTINGS, ...over,
});

describe('showMediaRefs', () => {
  it('finds headshots and walk-ons on the bill', () => {
    const s = show({
      performers: [{ id: 'p', name: 'Ada', photo: 'media:a#1', walkOnMusic: 'media:b#2' }],
    });
    expect(showMediaRefs(s).sort()).toEqual(['media:a#1', 'media:b#2']);
  });

  it('finds audio attached to a cue', () => {
    const s = show({ schedule: [{ id: 'c', time: '', description: 'Intro', music: 'media:c#1' }] });
    expect(showMediaRefs(s)).toEqual(['media:c#1']);
  });

  it('ignores links and plain data URLs, which are not stored files', () => {
    const s = show({
      performers: [{ id: 'p', name: 'Ada', walkOnMusicLink: 'https://example.com/x' }],
      schedule: [{ id: 'c', time: '', description: 'x', music: 'data:audio/mp3;base64,AAA' }],
    });
    expect(showMediaRefs(s)).toEqual([]);
  });

  it('leaves library audio alone — the show is borrowing it', () => {
    const s = show({
      djSongs: [{ id: 'd', title: 'Bed', artist: '', music: 'media:lib#3', libraryId: 't1' }],
    });
    expect(showMediaRefs(s)).toEqual([]);
  });

  it('claims audio uploaded straight into the show', () => {
    const s = show({ djSongs: [{ id: 'd', title: 'Sting', artist: '', music: 'media:own#3' }] });
    expect(showMediaRefs(s)).toEqual(['media:own#3']);
  });

  it('does not repeat a file two people share', () => {
    const s = show({
      performers: [
        { id: 'p1', name: 'Ada', walkOnMusic: 'media:same#1' },
        { id: 'p2', name: 'Bo', walkOnMusic: 'media:same#1' },
      ],
    });
    expect(showMediaRefs(s)).toEqual(['media:same#1']);
  });
});

describe('settingsMediaRefs', () => {
  it('counts the library, the rolodex and contracts', () => {
    const s = settings({
      musicLibrary: [{ id: 't', title: 'Bed', artist: '', music: 'media:lib#1', addedAt: '' }],
      potentialComics: [{ id: 'c', name: 'Ada', walkOnMusic: 'media:rolo#1' }],
      contracts: [{ id: 'k', name: 'Deal', fileRef: 'media:doc#1', fileName: 'd.pdf', sizeBytes: 1, uploadedAt: '' }],
    });
    expect(settingsMediaRefs(s).sort()).toEqual(['media:doc#1', 'media:lib#1', 'media:rolo#1']);
  });

  it('counts shows sitting in the trash, because they can be restored', () => {
    const s = settings({
      trash: [{
        id: 't1', type: 'show',
        data: show({ performers: [{ id: 'p', name: 'Ada', walkOnMusic: 'media:trashed#1' }] }),
        deletedAt: '',
      }],
    });
    expect(settingsMediaRefs(s)).toEqual(['media:trashed#1']);
  });
});

describe('orphanedRefs', () => {
  it('returns a file nothing points at any more', () => {
    expect(orphanedRefs(['media:gone#1'], [], settings())).toEqual(['media:gone#1']);
  });

  it('keeps a file a duplicated show still uses', () => {
    // structuredClone gives the copy the same media ids as the original, so
    // deleting one show must not take audio the other still plays.
    const copy = show({ id: 's2', performers: [{ id: 'p', name: 'Ada', walkOnMusic: 'media:shared#1' }] });
    expect(orphanedRefs(['media:shared#1'], [copy], settings())).toEqual([]);
  });

  it('keeps a file the music library owns', () => {
    const s = settings({
      musicLibrary: [{ id: 't', title: 'Bed', artist: '', music: 'media:lib#1', addedAt: '' }],
    });
    expect(orphanedRefs(['media:lib#1'], [], s)).toEqual([]);
  });

  it('keeps a file a trashed show would need if restored', () => {
    const s = settings({
      trash: [{
        id: 't1', type: 'show',
        data: show({ schedule: [{ id: 'c', time: '', description: 'x', music: 'media:keep#1' }] }),
        deletedAt: '',
      }],
    });
    expect(orphanedRefs(['media:keep#1'], [], s)).toEqual([]);
  });

  it('separates the orphans from the shared ones in a single pass', () => {
    const remaining = show({ id: 's2', performers: [{ id: 'p', name: 'Ada', photo: 'media:kept#1' }] });
    expect(orphanedRefs(['media:kept#1', 'media:gone#1'], [remaining], settings()))
      .toEqual(['media:gone#1']);
  });

  it('ignores anything that is not a stored file', () => {
    expect(orphanedRefs(['https://example.com/a.mp3', 'data:audio/mp3;base64,AA'], [], settings()))
      .toEqual([]);
  });

  it('does not ask for the same delete twice', () => {
    expect(orphanedRefs(['media:x#1', 'media:x#1'], [], settings())).toEqual(['media:x#1']);
  });
});

describe('liveMediaIds', () => {
  it('reduces references to the ids the server stores under', () => {
    const s = show({ performers: [{ id: 'p', name: 'Ada', photo: 'media:abc#4' }] });
    expect([...liveMediaIds([s], settings())]).toEqual(['abc']);
  });

  it('sees the same file referenced at a different chunk count as one id', () => {
    const a = show({ id: 'a', performers: [{ id: 'p', name: 'Ada', photo: 'media:abc#4' }] });
    const b = show({ id: 'b', performers: [{ id: 'q', name: 'Bo', photo: 'media:abc#9' }] });
    expect(liveMediaIds([a, b], settings()).size).toBe(1);
  });
});

describe('unreferencedMedia', () => {
  const stored = [
    { id: 'kept', chunks: 1, bytes: 100 },
    { id: 'orphan', chunks: 2, bytes: 900 },
  ];

  it('finds files left behind by a show deleted before cleanup existed', () => {
    const s = show({ performers: [{ id: 'p', name: 'Ada', photo: 'media:kept#1' }] });
    expect(unreferencedMedia(stored, [s], settings()).map((m) => m.id)).toEqual(['orphan']);
  });

  it('keeps everything when every stored file is still in use', () => {
    const s = show({
      performers: [{ id: 'p', name: 'Ada', photo: 'media:kept#1', walkOnMusic: 'media:orphan#2' }],
    });
    expect(unreferencedMedia(stored, [s], settings())).toEqual([]);
  });

  it('counts a file the trash still needs as in use', () => {
    const s = settings({
      trash: [{
        id: 't', type: 'show',
        data: show({ performers: [{ id: 'p', name: 'Ada', photo: 'media:orphan#2' }] }),
        deletedAt: '',
      }],
    });
    expect(unreferencedMedia(stored, [], s).map((m) => m.id)).toEqual(['kept']);
  });

  it('reports everything as unused when the account genuinely has no data', () => {
    // The dangerous case: this is also what a half-loaded client looks like,
    // which is why the caller must only sweep with complete data in hand.
    expect(unreferencedMedia(stored, [], settings()).map((m) => m.id)).toEqual(['kept', 'orphan']);
  });
});
