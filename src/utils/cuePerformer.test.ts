import { describe, it, expect } from 'vitest';
import { matchKnownName, withCueEdit, withMatchedPerformers } from './cuePerformer';
import type { ScheduleItem } from '../types';

const cue = (over: Partial<ScheduleItem>): ScheduleItem => ({
  id: 'c', time: '', description: '', ...over,
});

const ROLODEX = ['Ada Cole', 'Miles Trent', 'Jo Park', 'Riya Menon'];

describe('matchKnownName', () => {
  it('finds a name sitting in the middle of a line', () => {
    expect(matchKnownName('8:20 Ada Cole (10 min)', ROLODEX)).toBe('Ada Cole');
  });

  it('does not care about casing', () => {
    expect(matchKnownName('feature: miles trent', ROLODEX)).toBe('Miles Trent');
  });

  it('reads through the punctuation a run sheet is written with', () => {
    expect(matchKnownName('Headliner — Jo Park!', ROLODEX)).toBe('Jo Park');
    expect(matchKnownName('(Riya Menon) intro', ROLODEX)).toBe('Riya Menon');
    expect(matchKnownName('Ada Cole', ROLODEX)).toBe('Ada Cole');
  });

  it('says nothing when nobody is named', () => {
    expect(matchKnownName('Doors open', ROLODEX)).toBeNull();
    expect(matchKnownName('', ROLODEX)).toBeNull();
    expect(matchKnownName('Turnaround', [])).toBeNull();
  });

  it('will not match a name buried inside a longer word', () => {
    // "Jo" is not on file, but "Jo Park" is — and neither should fire here.
    expect(matchKnownName('Joanna does ten', ROLODEX)).toBeNull();
    expect(matchKnownName('Parking notes', ROLODEX)).toBeNull();
  });

  it('prefers the fuller name when both are on file', () => {
    expect(matchKnownName('Ada Cole closes', ['Ada', 'Ada Cole'])).toBe('Ada Cole');
  });

  it('takes whoever is named first when two are equally specific', () => {
    expect(matchKnownName('Ada Cole then Jo Park', ['Jo Park', 'Ada Cole'])).toBe('Ada Cole');
  });

  it('ignores names too short to be safe to match on', () => {
    expect(matchKnownName('Al already left', ['Al'])).toBeNull();
  });

  it('matches a short name when the caller asks it to, still as a whole word', () => {
    expect(matchKnownName('Intro — Al', ['Al'], 1)).toBe('Al');
    expect(matchKnownName('Already on', ['Al'], 1)).toBeNull();
  });

  it('treats a name with regex characters as literal text', () => {
    expect(matchKnownName('Set — J.C. Diaz', ['J.C. Diaz'])).toBe('J.C. Diaz');
    expect(matchKnownName('Set — JXC Diaz', ['J.C. Diaz'])).toBeNull();
  });

  it('matches a name with a non-ASCII letter', () => {
    expect(matchKnownName('Opener: Renée Dubois', ['Renée Dubois'])).toBe('Renée Dubois');
  });

  it('skips blank entries in the name list', () => {
    expect(matchKnownName('Doors', ['', '   '])).toBeNull();
  });
});

describe('withMatchedPerformers', () => {
  it('fills in the performer a cue only mentions in its text', () => {
    const out = withMatchedPerformers([cue({ id: 'a', description: 'Opener — Ada Cole' })], ROLODEX);
    expect(out[0].performer).toBe('Ada Cole');
  });

  it('never overwrites a performer that is already set', () => {
    const out = withMatchedPerformers(
      [cue({ id: 'a', description: 'Opener — Ada Cole', performer: 'Someone Else' })],
      ROLODEX,
    );
    expect(out[0].performer).toBe('Someone Else');
  });

  it('treats a whitespace-only performer as blank', () => {
    const out = withMatchedPerformers(
      [cue({ id: 'a', description: 'Opener — Ada Cole', performer: '   ' })],
      ROLODEX,
    );
    expect(out[0].performer).toBe('Ada Cole');
  });

  it('leaves cues that name nobody exactly as they were', () => {
    const items = [cue({ id: 'a', description: 'Doors' })];
    expect(withMatchedPerformers(items, ROLODEX)[0].performer).toBeUndefined();
  });

  it('returns the very same array when nothing matched, so no state churn', () => {
    const items = [cue({ id: 'a', description: 'Doors' })];
    expect(withMatchedPerformers(items, ROLODEX)).toBe(items);
    expect(withMatchedPerformers(items, [])).toBe(items);
  });

  it('handles a whole imported run sheet at once', () => {
    const out = withMatchedPerformers([
      cue({ id: 'a', description: 'Doors' }),
      cue({ id: 'b', description: 'Host intro — Riya Menon' }),
      cue({ id: 'c', description: 'Ada Cole 10' }),
      cue({ id: 'd', description: 'Turnaround' }),
      cue({ id: 'e', description: 'Headliner: Jo Park' }),
    ], ROLODEX);
    expect(out.map((c) => c.performer)).toEqual([
      undefined, 'Riya Menon', 'Ada Cole', undefined, 'Jo Park',
    ]);
  });

  it('does not mutate the cues it was given', () => {
    const items = [cue({ id: 'a', description: 'Ada Cole' })];
    withMatchedPerformers(items, ROLODEX);
    expect(items[0].performer).toBeUndefined();
  });
});

describe('withCueEdit', () => {
  // Saving a cue sends its text every time. Reading that as "the text was
  // rewritten" matched the name straight back in after "On stage: nobody",
  // so Run Show still put Ada on stage at intermission.
  it('keeps "On stage: nobody" when the text names someone known', () => {
    const before = cue({ description: "Intermission — Ada Cole's merch at the back", performer: 'Ada Cole' });
    const out = withCueEdit(before, {
      time: '', description: before.description, performer: undefined, performerId: undefined,
    }, ROLODEX);
    expect(out.performer).toBeUndefined();
  });

  it('keeps a cleared performer cleared when the text is reworded in the same edit', () => {
    const before = cue({ description: 'Ada Cole merch', performer: 'Ada Cole', performerId: 'p1' });
    const out = withCueEdit(before, {
      description: "Intermission — Ada Cole's merch at the back", performer: undefined, performerId: undefined,
    }, ROLODEX);
    expect(out.performer).toBeUndefined();
    expect(out.performerId).toBeUndefined();
  });

  it('does not fill a blank again when the text is saved unchanged', () => {
    const before = cue({ description: 'Ada Cole merch' });
    const out = withCueEdit(before, { time: '9:00 PM', description: 'Ada Cole merch', performer: undefined }, ROLODEX);
    expect(out.performer).toBeUndefined();
    expect(out.time).toBe('9:00 PM');
  });

  it('still fills a blank when the text is rewritten to name someone', () => {
    const before = cue({ description: 'Opener' });
    const out = withCueEdit(before, { description: 'Opener — Ada Cole', performer: undefined }, ROLODEX);
    expect(out.performer).toBe('Ada Cole');
  });

  it('never overwrites a performer the edit sets', () => {
    const before = cue({ description: 'Opener' });
    const out = withCueEdit(before, { description: 'Opener — Ada Cole', performer: 'Jo Park' }, ROLODEX);
    expect(out.performer).toBe('Jo Park');
  });
});
