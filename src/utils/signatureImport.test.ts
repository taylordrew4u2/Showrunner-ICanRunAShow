import { describe, expect, it } from 'vitest';
import {
  applyFiledHeadshot,
  applyProfileChanges,
  headshotsToFile,
  describeChanges,
  profileChanges,
  profileFromAnswers,
} from './signatureImport';

const answers = (...pairs: [string, string][]) => pairs.map(([label, value]) => ({ label, value }));

describe('reading a signed contract as a profile', () => {
  it('picks up the details a comic filled in when they signed', () => {
    const profile = profileFromAnswers(
      answers(
        ['Email', 'mona@sable.example'],
        ['Phone', '555 0142'],
        ['Instagram', '@monasable'],
        ['How to credit you', 'Mona Sable, she/her, Netflix'],
      ),
    );

    expect(profile).toEqual({
      email: 'mona@sable.example',
      phone: '555 0142',
      socialMedia: '@monasable',
      credits: 'Mona Sable, she/her, Netflix',
    });
  });

  it('reads a pasted profile URL as a handle, the way the post copy does', () => {
    const profile = profileFromAnswers(answers(['Socials', 'instagram.com/monasable/']));
    expect(profile.socialMedia).toBe('@monasable');
  });

  it('matches the producer’s own wording for the question', () => {
    const profile = profileFromAnswers(
      answers(
        ['Best e-mail for you', 'dev@okonjo.example'],
        ['Number we can text on the night', '555 0199'],
        ['Where can people find you', '@devokonjo'],
        ['Your bio for the intro', 'Ten years in clubs'],
      ),
    );

    expect(profile.email).toBe('dev@okonjo.example');
    expect(profile.phone).toBe('555 0199');
    expect(profile.socialMedia).toBe('@devokonjo');
    expect(profile.credits).toBe('Ten years in clubs');
  });

  it('leaves a typo where a real address should be rather than filing it', () => {
    // Better an empty email field than one that silently fails on the night
    // you email the whole bill.
    expect(profileFromAnswers(answers(['Email', 'mona at sable dot com'])).email).toBeUndefined();
  });

  it('does not rename anyone from their stage name', () => {
    // They are booked, and on running orders, under the name the producer
    // knows them by.
    const profile = profileFromAnswers(answers(['Stage name', 'The Velvet Hammer']));
    expect(profile).toEqual({});
  });

  it('ignores questions that have nothing to do with the profile', () => {
    const profile = profileFromAnswers(
      answers(['Show date', 'Friday 3 April'], ['Venue', 'The Cellar'], ['Fee', '$50']),
    );
    expect(profile).toEqual({});
  });

  it('is fine with a contract that asked nothing at all', () => {
    expect(profileFromAnswers(undefined)).toEqual({});
    expect(profileFromAnswers([])).toEqual({});
  });
});

describe('deciding what to offer the producer', () => {
  it('offers only what is new or different', () => {
    const changes = profileChanges(
      { email: 'mona@sable.example', credits: 'Netflix' },
      { email: 'mona@sable.example', phone: '555 0142', credits: 'Netflix, Comedy Central' },
    );

    expect(changes).toEqual([
      { key: 'phone', label: 'Phone', from: undefined, to: '555 0142' },
      { key: 'credits', label: 'Credits', from: 'Netflix', to: 'Netflix, Comedy Central' },
    ]);
  });

  it('never treats a skipped question as an instruction to delete', () => {
    // The one thing this must not do is empty a field the producer filled in
    // because the signer left the box blank.
    const changes = profileChanges({ phone: '555 0142', email: 'mona@sable.example' }, { email: 'mona@sable.example' });
    expect(changes).toEqual([]);
  });

  it('has something to offer for someone with no profile yet', () => {
    const changes = profileChanges(undefined, { email: 'new@comic.example' });
    expect(changes).toHaveLength(1);
    expect(changes[0].from).toBeUndefined();
  });

  it('says whether an import fills gaps or replaces what is there', () => {
    expect(describeChanges([])).toBe('Nothing new to save');
    expect(
      describeChanges(profileChanges({ credits: 'Netflix' }, { phone: '555 0142', credits: 'Comedy Central' })),
    ).toBe('1 to fill in, 1 to replace');
  });
});

describe('writing the details onto the entry', () => {
  it('changes exactly what the producer was shown and nothing else', () => {
    const entry = { id: 'c1', name: 'Mona Sable', notes: 'Great closer', email: 'old@sable.example' };
    const changes = profileChanges(entry, { email: 'mona@sable.example', phone: '555 0142' });

    const next = applyProfileChanges(entry, changes);

    expect(next).toEqual({
      id: 'c1',
      name: 'Mona Sable',
      notes: 'Great closer',
      email: 'mona@sable.example',
      phone: '555 0142',
    });
    // The original is untouched, so declining costs nothing.
    expect(entry.email).toBe('old@sable.example');
  });

  it('lets the producer take one detail and leave another', () => {
    const entry = { id: 'c1', name: 'Mona Sable', credits: 'Netflix' };
    const all = profileChanges(entry, { phone: '555 0142', credits: 'Something worse' });

    const next = applyProfileChanges(entry, all.filter((c) => c.key === 'phone'));

    expect(next.phone).toBe('555 0142');
    expect(next.credits).toBe('Netflix');
  });
});

describe('a walk-on song, as words', () => {
  it('lands on the profile as the song name, not as audio', () => {
    // The producer still has to find the track. What this saves is asking
    // what it was.
    const profile = profileFromAnswers(answers(['Walk-on song', 'Get Ur Freak On — Missy Elliott']));
    expect(profile.walkOnMusicName).toBe('Get Ur Freak On — Missy Elliott');
  });

  it('is offered as a change beside the others', () => {
    const changes = profileChanges({}, { walkOnMusicName: 'Roundabout — Yes' });
    expect(changes).toEqual([
      { key: 'walkOnMusicName', label: 'Walk-on', from: undefined, to: 'Roundabout — Yes' },
    ]);
  });
});

describe('a headshot that came back with a signature', () => {
  const key = (name: string) => name.trim().toLowerCase();
  const PHOTO = 'data:image/jpeg;base64,abcd';
  const request = (over: Partial<{ token: string; contactId?: string; signerName: string; signed?: { headshot?: string } }> = {}) => ({
    token: 'tok', signerName: 'Ada Reyes', signed: { headshot: PHOTO }, ...over,
  });

  it('is filed without the producer having to press anything', () => {
    const comics = [{ id: 'c1', name: 'Ada Reyes' }];
    const [shot] = headshotsToFile([request()], comics, key);
    expect(shot).toMatchObject({ token: 'tok', entryId: 'c1', wantsPhoto: true });
    expect(applyFiledHeadshot(comics, shot, 'media:face#2', () => 'new')).toEqual([
      { id: 'c1', name: 'Ada Reyes', photo: 'media:face#2' },
    ]);
  });

  it('never displaces a picture the producer chose themselves', () => {
    const comics = [{ id: 'c1', name: 'Ada Reyes', photo: 'media:chosen#1' }];
    const [shot] = headshotsToFile([request()], comics, key);
    expect(shot.wantsPhoto).toBe(false);
    expect(applyFiledHeadshot(comics, shot, 'media:face#2', () => 'new')).toEqual(comics);
  });

  it('files someone who signed but was never added to the rolodex', () => {
    const [shot] = headshotsToFile([request()], [], key);
    expect(applyFiledHeadshot([], shot, 'media:face#2', () => 'new')).toEqual([
      { id: 'new', name: 'Ada Reyes', photo: 'media:face#2' },
    ]);
  });

  it('goes to the entry the contract was sent to, not to a matching name', () => {
    const comics = [{ id: 'sent', name: 'A. Reyes' }, { id: 'other', name: 'Ada Reyes' }];
    const [shot] = headshotsToFile([request({ contactId: 'sent' })], comics, key);
    expect(shot.entryId).toBe('sent');
  });

  it('is left alone once it has been filed, so the same face is stored once', () => {
    expect(headshotsToFile([request({ signed: { headshot: 'media:face#2' } })], [], key)).toEqual([]);
  });

  it('is not looked for on a contract nobody has signed yet', () => {
    expect(headshotsToFile([request({ signed: undefined })], [], key)).toEqual([]);
  });
});
