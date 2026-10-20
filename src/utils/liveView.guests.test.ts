import { describe, expect, it } from 'vitest';
import { cueInitial, guestsOnStageBy, isRevealedGuest, publicCue, publicLineup } from './liveView';
import { generateSchedule } from './generateSchedule';
import type { Performer, ScheduleItem } from '../types';

const ada: Performer = { id: 'ada', name: 'Ada Cole', credits: 'Just For Laughs' };
const jo: Performer = { id: 'jo', name: 'Jo Park' };
const miles: Performer = { id: 'miles', name: 'Miles Trent', credits: 'Netflix special', surpriseGuest: true };
const bill = [ada, miles, jo];

const cue = (over: Partial<ScheduleItem>): ScheduleItem => ({ id: 'c', time: '', description: '', ...over });
const nobody = new Set<string>();

describe('publicLineup', () => {
  it('posts the bill in its order, without the surprise guests', () => {
    expect(publicLineup(bill)).toEqual([
      { name: 'Ada Cole', credits: 'Just For Laughs' },
      { name: 'Jo Park', credits: undefined },
    ]);
  });

  it('leaves no trace of a guest anywhere in what it publishes', () => {
    expect(JSON.stringify(publicLineup(bill))).not.toMatch(/Miles|Netflix/);
  });
});

describe('publicCue', () => {
  it('says who is on and what the segment is, for anyone on the posted bill', () => {
    expect(publicCue(cue({ description: 'Opener', performerId: 'ada' }), bill, nobody)).toEqual({
      name: 'Ada Cole',
      description: 'Opener',
      credits: 'Just For Laughs',
    });
  });

  it('is nothing at all past the last cue', () => {
    expect(publicCue(undefined, bill, nobody)).toEqual({});
  });

  it('holds a guest back as "Surprise guest" until they are on, with nothing else of theirs', () => {
    const held = publicCue(cue({ description: 'Miles Trent — 10 min', performerId: 'miles' }), bill, nobody);
    expect(held).toEqual({ name: 'Surprise guest', surprise: true });
  });

  it('says who they are once they have walked on', () => {
    const revealed = publicCue(
      cue({ description: 'Surprise set', performerId: 'miles' }),
      bill,
      new Set(['miles']),
    );
    expect(revealed).toEqual({
      name: 'Miles Trent',
      description: 'Surprise set',
      credits: 'Netflix special',
      surprise: true,
    });
  });

  it('holds back a guest named on the cue but never linked to them', () => {
    expect(publicCue(cue({ description: 'Set', performer: 'miles trent' }), bill, nobody))
      .toEqual({ name: 'Surprise guest', surprise: true });
    // Nobody on the cue, and the only words on it are the guest's name.
    expect(publicCue(cue({ description: 'Miles Trent drops in' }), bill, nobody))
      .toEqual({ name: 'Surprise guest', surprise: true });
  });

  it('keeps the host on screen for their handover and holds back the line that names the guest', () => {
    const intro = cue({ description: 'Intro — Miles Trent', performer: 'Sam Host' });
    expect(publicCue(intro, bill, nobody)).toEqual({ name: 'Sam Host', credits: undefined });
    expect(publicCue(intro, bill, new Set(['miles']))).toEqual({
      name: 'Sam Host',
      description: 'Intro — Miles Trent',
      credits: undefined,
    });
  });

  it('holds back a line naming a guest whose stage name is too short for the Rolodex matcher', () => {
    const mo: Performer = { id: 'mo', name: 'Mo', surpriseGuest: true };
    const intro = cue({ description: 'Intro — Mo', performer: 'Sam Host' });
    expect(publicCue(intro, [ada, mo], nobody)).toEqual({ name: 'Sam Host', credits: undefined });
    expect(publicCue(cue({ description: 'Mo drops in' }), [ada, mo], nobody))
      .toEqual({ name: 'Surprise guest', surprise: true });
  });

  it('keeps a generated running order clean of the guest until their set, cue by cue', () => {
    // The generator writes the host's handover as "Intro — <name>", so the
    // cue before a guest's set names them as surely as the set does.
    const schedule = generateSchedule({
      acts: [{ performer: ada }, { performer: miles }, { performer: jo }],
      hostName: 'Sam Host',
    });
    const room = schedule.map((item, i) => {
      const revealed = new Set(guestsOnStageBy(schedule, bill, i, true));
      return JSON.stringify({
        segment: publicCue(item, bill, revealed),
        next: publicCue(schedule[i + 1], bill, revealed),
      });
    });
    const guestSet = schedule.findIndex((item) => item.performerId === 'miles');
    room.slice(0, guestSet).forEach((published) => expect(published).not.toMatch(/Miles|Netflix/));
    expect(room[guestSet]).toContain('Miles Trent');
  });
});

describe('guestsOnStageBy', () => {
  const schedule = [
    cue({ id: 'a', performerId: 'ada' }),
    cue({ id: 'm', performerId: 'miles' }),
    cue({ id: 'j', performerId: 'jo' }),
  ];

  it('is nobody before the show has started, wherever the board is pointing', () => {
    // An operator stepping through the order to check it is not the guest
    // walking on.
    expect(guestsOnStageBy(schedule, bill, 2, false)).toEqual([]);
  });

  it('is the guests whose cue is on now or already passed, once the show is running', () => {
    expect(guestsOnStageBy(schedule, bill, 0, true)).toEqual([]);
    expect(guestsOnStageBy(schedule, bill, 1, true)).toEqual(['miles']);
    expect(guestsOnStageBy(schedule, bill, 2, true)).toEqual(['miles']);
  });

  it('finds a guest by the name on the cue, the way Run Show does', () => {
    expect(guestsOnStageBy([cue({ performer: 'Miles Trent' })], bill, 0, true)).toEqual(['miles']);
  });

  it('ignores performers on the posted bill: there is nothing about them to reveal', () => {
    expect(guestsOnStageBy([cue({ performerId: 'ada' }), cue({ performerId: 'jo' })], bill, 1, true)).toEqual([]);
  });
});

describe('the face on a viewer card', () => {
  it('is a question mark for a guest still held back', () => {
    const held = { name: 'Surprise guest', surprise: true };
    expect(isRevealedGuest(held)).toBe(false);
    expect(cueInitial(held, '—')).toBe('?');
  });

  it('is their initial once they are revealed, up next for a second spot as much as on stage', () => {
    const back = { name: 'Miles Trent', description: 'Encore', surprise: true };
    expect(isRevealedGuest(back)).toBe(true);
    expect(cueInitial(back, '—')).toBe('M');
  });

  it('is the name or the fallback for everyone else', () => {
    expect(isRevealedGuest({ name: 'Ada Cole' })).toBe(false);
    expect(cueInitial({ name: 'ada Cole' }, '—')).toBe('A');
    expect(cueInitial({}, '—')).toBe('—');
  });
});
