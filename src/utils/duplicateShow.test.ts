import { describe, it, expect } from 'vitest';
import { duplicateShow } from './duplicateShow';
import { generateSchedule } from './generateSchedule';
import { publicCue } from './liveView';
import { withWalkOnSongs } from './walkOnSongs';
import type { Show } from '../types';

const original = {
  id: 'show-1',
  name: 'Late Night Laughs',
  date: '2026-04-07',
  time: '20:00',
  location: 'Portland, OR',
  venueName: 'The Basement',
  status: 'completed',
  performers: [{ id: 'p1', name: 'Ada Cole' }],
  artists: [],
  schedule: [{ id: 's1', time: '0:00', description: 'Doors', durationMin: 10 }],
  hosts: [],
  djSongs: [],
  staff: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  viewToken: 'live-token',
  viewerKey: 'audio-key',
  viewNote: 'Doors at 7:30',
  recap: { attendance: 60 },
} as unknown as Show;

describe('duplicateShow', () => {
  it('keeps the show setup and starts a fresh lineup', () => {
    const copy = duplicateShow(original);
    expect(copy.performers).toEqual([]);
    expect(copy.artists).toEqual([]);
    expect(copy.schedule).toEqual(original.schedule);
    expect(copy.venueName).toBe('The Basement');
    expect(copy.time).toBe('20:00');
  });

  it('drops what belonged to that one night', () => {
    const copy = duplicateShow(original);
    // A copy carrying the viewer token would publish over the original's
    // live page.
    expect(copy.viewToken).toBeUndefined();
    expect(copy.viewerKey).toBeUndefined();
    expect(copy.viewNote).toBeUndefined();
    expect(copy.recap).toBeUndefined();
    expect(copy.status).toBe('upcoming');
    expect(copy.id).not.toBe(original.id);
  });

  it('clears the date when there is no new one, so the app asks for one', () => {
    expect(duplicateShow(original).date).toBe('');
    expect(duplicateShow(original).name).toBe('Late Night Laughs (copy)');
  });

  it('takes a date and keeps the name for a booked repeat', () => {
    const copy = duplicateShow(original, { name: original.name, date: '2026-04-14' });
    expect(copy.date).toBe('2026-04-14');
    expect(copy.name).toBe('Late Night Laughs');
    expect(copy.performers).toEqual([]);
    expect(original.performers).toHaveLength(1);
  });

  it('is a deep copy — editing the copy cannot reach back into the original', () => {
    const copy = duplicateShow(original);
    copy.schedule[0].description = 'Different doors';
    copy.performers.push({ id: 'p2', name: 'Someone Else' });
    expect(original.schedule[0].description).toBe('Doors');
    expect(original.performers).toEqual([{ id: 'p1', name: 'Ada Cole' }]);
  });

  it('gives every copy its own id', () => {
    const ids = new Set(Array.from({ length: 20 }, () => duplicateShow(original).id));
    expect(ids.size).toBe(20);
  });
});

for (const options of [{}, { name: original.name, date: '2026-04-14' }]) {
  it(`starts the scenes and to-dos over for ${options.date ? 'a repeat' : 'a duplicate'}`, () => {
    const source: Show = {
      ...original,
      scenes: [
        { id: 'sc1', title: 'Cold open', description: '', duration: 5, status: 'done', order: 0 },
        { id: 'sc2', title: 'Headliner', description: '', duration: 20, status: 'filmed', order: 1 },
      ],
      todos: [
        { id: 't1', text: 'Print the set list', completed: true },
        { id: 't2', text: 'Test the mics', completed: false },
      ],
    };
    const before = structuredClone(source);
    const copy = duplicateShow(source, options);
    // Last week's ticks would show a full progress bar on a night that has
    // not been planned yet.
    expect(copy.scenes?.map((scene) => scene.status)).toEqual(['planned', 'planned']);
    expect(copy.scenes?.map((scene) => scene.title)).toEqual(['Cold open', 'Headliner']);
    expect(copy.todos?.map((todo) => todo.completed)).toEqual([false, false]);
    expect(copy.todos?.map((todo) => todo.text)).toEqual(['Print the set list', 'Test the mics']);
    expect(source).toEqual(before);
  });

  it(`leaves scenes and to-dos alone when the show never used them, for ${options.date ? 'a repeat' : 'a duplicate'}`, () => {
    // `scenes: undefined` means the section was never opened, and an empty
    // array would make it appear on the copy.
    const copy = duplicateShow(original, options);
    expect(copy.scenes).toBeUndefined();
    expect(copy.todos).toBeUndefined();
  });

  it(`clears artist bookings and old cue assignments for ${options.date ? 'a repeat' : 'a duplicate'}`, () => {
    const source: Show = {
      ...original,
      artists: [{ id: 'a1', name: 'Jo Park' }],
      schedule: [
        { id: 's1', time: '0:00', description: 'Doors', music: 'media:house' },
        { id: 's2', time: '10:00', description: 'Opening set', performerId: 'p1', performer: 'Ada Cole', durationMin: 10 },
        { id: 's3', time: '20:00', description: 'Feature', performer: '  JO   park ', durationMin: 15 },
        { id: 's4', time: '35:00', description: 'Welcome', performer: 'Host' },
      ],
      completions: { performers: true, artists: true, schedule: true, basic: true },
    };
    const before = structuredClone(source);
    const copy = duplicateShow(source, options);
    expect(copy.performers).toEqual([]);
    expect(copy.artists).toEqual([]);
    expect(copy.schedule).toEqual([
      source.schedule[0],
      { id: 's2', time: '10:00', description: 'Opening set', durationMin: 10 },
      { id: 's3', time: '20:00', description: 'Feature', durationMin: 15 },
      source.schedule[3],
    ]);
    expect(copy.completions).toEqual({ performers: false, artists: false, schedule: false, basic: true });
    expect(source).toEqual(before);
  });
}

describe('duplicating the sample show', () => {
  it('makes a real night that counts in the season report', () => {
    const copy = duplicateShow({ ...original, sample: true } as Show);
    expect(copy.sample).toBeUndefined();
  });
});

describe('duplicating a show with a surprise guest', () => {
  it('books nobody on the copy, guests included, and unlinks the guest from their cue', () => {
    // The cast never carries over to a new night, so there is no flag to
    // keep: a guest on one night is booked afresh, on whichever tab, for the
    // next. What must not survive is a cue still pointing at them.
    const copy = duplicateShow({
      ...original,
      performers: [
        { id: 'p1', name: 'Ada Cole' },
        { id: 'g1', name: 'Miles Trent', surpriseGuest: true },
      ],
      schedule: [{ id: 's1', time: '0:00', description: 'Surprise set', performerId: 'g1', performer: 'Miles Trent' }],
    } as Show);
    expect(copy.performers).toEqual([]);
    expect(copy.schedule).toEqual([{ id: 's1', time: '0:00', description: 'Surprise set' }]);
  });
});

describe('duplicating a running order built from the lineup', () => {
  const ada = { id: 'p1', name: 'Ada Cole' };
  const miles = { id: 'g1', name: 'Miles Trent', surpriseGuest: true };
  const built: Show = {
    ...original,
    performers: [ada, miles],
    schedule: generateSchedule({ hostName: 'Hal', acts: [{ performer: ada }, { performer: miles }] }),
  };

  it('keeps the host’s handover but takes off the name of the act it introduced', () => {
    // The intro line is the host's cue, so unlinking the old cast left it
    // naming last night's act, a surprise guest included, on the copy's
    // running order and in its viewer payload.
    const copy = duplicateShow(built, { name: built.name, date: '2026-04-14' });
    expect(copy.schedule.map((cue) => [cue.description, cue.performer, cue.durationMin])).toEqual(
      built.schedule.map((cue) => [
        cue.description === 'Intro — Miles Trent' ? 'Intro — next act' : cue.description,
        cue.performer === 'Hal' ? 'Hal' : undefined,
        cue.durationMin,
      ]),
    );
    expect(JSON.stringify(copy.schedule)).not.toMatch(/Ada Cole|Miles Trent/);
    const intro = copy.schedule.find((cue) => cue.description.startsWith('Intro — '));
    expect(publicCue(intro, copy.performers, new Set())).toEqual({ name: 'Hal', description: 'Intro — next act' });
  });

  it('leaves a cue the producer wrote alone, and an intro of someone who was not on the bill', () => {
    const copy = duplicateShow({
      ...built,
      schedule: [
        { id: 's1', time: '0:00', description: 'Intro — Jo Park', performer: 'Hal' },
        { id: 's2', time: '5:00', description: "Intermission — Ada Cole's merch at the back" },
      ],
    });
    expect(copy.schedule.map((cue) => cue.description)).toEqual([
      'Intro — Jo Park', "Intermission — Ada Cole's merch at the back",
    ]);
  });
});

describe('duplicating a show whose acts had walk-ons on the DJ list', () => {
  const ada = { id: 'p1', name: 'Ada Cole', walkOnMusicName: 'Song A.mp3' };
  const miles = { id: 'a1', name: 'Miles Trent', walkOnMusicName: 'Song M.mp3' };
  const house = { id: 'house', title: 'House music', artist: 'DJ' };

  it('takes the old cast’s walk-ons off the copy’s DJ list and keeps the rest', () => {
    // Nobody is booked on the copy, so the cleanup that runs when an act
    // leaves the bill never saw them go, and the DJ was handed their songs.
    const withWalkOns = withWalkOnSongs(withWalkOnSongs([house], [], [ada]), [], [miles]);
    const source: Show = { ...original, performers: [ada], artists: [miles], djSongs: withWalkOns };
    const copy = duplicateShow(source, { name: source.name, date: '2026-04-14' });
    expect(copy.djSongs).toEqual([house]);
    expect(source.djSongs).toHaveLength(3);
  });

  it('keeps a walk-on row the producer put audio on', () => {
    const owned = { id: 'own', title: 'Song A', artist: 'Ada Cole', notes: 'Walk-on: Ada Cole', music: 'media:song-a' };
    const copy = duplicateShow({ ...original, performers: [ada], djSongs: [house, owned] });
    expect(copy.djSongs).toEqual([house, owned]);
  });
});
