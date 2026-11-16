import type { PotentialComic } from '../types';
import { describe, expect, it } from 'vitest';
import {
  signatureVisitPatch,
  applyFiledHeadshot,
  applyProfileChanges,
  fillRolodexFromSignatures,
  headshotsToFile,
  signedProfilePatch,
  describeChanges,
  profileChanges,
  profileFromAnswers,
  asksForIdNumber,
  asksForPayment,
  readAnswers,
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

  it('does not file a yes to posting their photo as their handle', () => {
    // Filed as "@Yes", which the post copy then tagged.
    const profile = profileFromAnswers(answers(
      ['OK to post your photo on social media?', 'Yes'],
      ['Instagram or main social', '@janedoe'],
    ));
    expect(profile.socialMedia).toBe('@janedoe');
    expect(profileFromAnswers(answers(['OK to post your photo on social media?', 'Yes'])).socialMedia).toBeUndefined();
  });

  it('does not file a plain yes or no as a handle', () => {
    expect(profileFromAnswers(answers(['Are you on Instagram?', 'No'])).socialMedia).toBeUndefined();
    expect(profileFromAnswers(answers(['Your socials', 'yes.'])).socialMedia).toBeUndefined();
  });

  it('keeps a link it cannot read a handle from, as they typed it', () => {
    // Filed as "@channel" before, and the link they gave was lost.
    const profile = profileFromAnswers(answers(['Socials', 'https://youtube.com/channel/UC123']));
    expect(profile.socialMedia).toBe('https://youtube.com/channel/UC123');
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

  it('never files a social security or bank number as a phone or a handle', () => {
    // A release can ask for these. "Number" and "social" are in the labels,
    // but the answer is nobody's phone and must not end up tagged in a post.
    const profile = profileFromAnswers(
      answers(
        ['Social Security Number', '123-45-6789'],
        ['Social security', '987-65-4321'],
        ['Bank account number', '00012345678'],
        ['Routing number', '021000021'],
        ['Card number', '4111 1111 1111 1111'],
        ['Tax ID', '12-3456789'],
        ['Passport number', 'X1234567'],
        ["Driver's licence number", 'D1234567'],
      ),
    );
    expect(profile).toEqual({});
  });

  it('still reads an Instagram account and a phone number the ordinary way', () => {
    const profile = profileFromAnswers(
      answers(['Instagram account', '@monasable'], ['Phone number', '555 0142']),
    );
    expect(profile).toEqual({ socialMedia: '@monasable', phone: '555 0142' });
  });

  it('does not take someone else’s number, or an ID number, as theirs', () => {
    // A performer agreement asks for these too. Each one has "phone" or
    // "number" in it, and none of them is how to reach the performer.
    const profile = profileFromAnswers(
      answers(
        ['Emergency contact phone', 'Mum 07700 900123'],
        ['Next of kin phone', '07700 900456'],
        ['Agent phone', '555 0100'],
        ['Equity membership number', 'M123456'],
        ['Social insurance number', '046 454 286'],
        ['IRD number', '49-091-850'],
        ['Invoice number', 'INV-0042'],
      ),
    );
    expect(profile).toEqual({});
  });

  it('does not take the photographer’s credit as the performer’s introduction', () => {
    const profile = profileFromAnswers(
      answers(['Headshot photo credit', 'Photo by Jane Smith'], ['Photographer’s Instagram', '@janesmithphoto']),
    );
    expect(profile).toEqual({});
  });

  it('still reads a number that asks how to reach them', () => {
    expect(profileFromAnswers(answers(['Contact number', '555 0142'])).phone).toBe('555 0142');
    expect(profileFromAnswers(answers(['Best number to call you on', '555 0143'])).phone).toBe('555 0143');
    expect(profileFromAnswers(answers(['Cell', '555 0144'])).phone).toBe('555 0144');
    // Read as a phone before bare "number" stopped counting; still one.
    expect(profileFromAnswers(answers(['Best number for show-day texts', '555 0145'])).phone).toBe('555 0145');
    expect(profileFromAnswers(answers(['Number for calling on the night', '555 0146'])).phone).toBe('555 0146');
    expect(profileFromAnswers(answers(['WhatsApp number', '555 0147'])).phone).toBe('555 0147');
  });

  it('does not read a question about cancellation as a cell number', () => {
    expect(profileFromAnswers(answers(['Cancellation notice given', 'Yes, a week'])).phone).toBeUndefined();
  });

  it('never files an ID number anywhere, however briefly the question asks for it', () => {
    // "Social # (for the 1099)" was filed as the handle "@012-34-5678", and
    // shown wherever the Rolodex is.
    const profile = profileFromAnswers(
      answers(
        ['Social # (for the 1099)', '012-34-5678'],
        ['Social sec. no.', '012-34-5678'],
        ['SS#', '012-34-5678'],
        ['NI number', 'QQ 12 34 56 C'],
        ['Acct # for your fee', '00012345678'],
        ['Lic #', 'D1234567'],
        ['Your social', '@monasable'],
      ),
    );
    expect(profile).toEqual({ socialMedia: '@monasable' });
  });

  it('never files a social security number asked for as just "social"', () => {
    // Each was filed as the handle "@123-45-6789", or "@6789", and shown by
    // the Rolodex, the show and every assistant tool that reads them.
    for (const label of [
      'Social (for the 1099)', 'Social (W-9)', 'Social (for payroll)', 'Social - needed for the 1099', 'Full social',
      'Last 4 of social', 'Last four digits of your social', 'Número de Seguro Social', 'Seguro Social', 'Social or ein',
      'W9 info: name, address, social',
    ]) {
      expect(profileFromAnswers(answers(['Phone', '312-555-0199'], [label, '123-45-6789']))).toEqual({ phone: '312-555-0199' });
    }
    // Asked before the handle, it no longer takes the handle's place.
    expect(profileFromAnswers(answers(['Social (W-9)', '123-45-6789'], ['Instagram', '@samcomedy'])))
      .toEqual({ socialMedia: '@samcomedy' });
  });

  it('never files how they are paid', () => {
    // "Venmo handle" was filed as their social handle and the Instagram answer
    // dropped; a credit union account was filed as their introduction.
    expect(profileFromAnswers(answers(['Venmo handle (for your fee)', '@sam-okafor-pay'], ['Instagram', '@samcomedy'])))
      .toEqual({ socialMedia: '@samcomedy' });
    expect(profileFromAnswers(answers(['PayPal handle', '@sampay']))).toEqual({});
    expect(profileFromAnswers(answers(['Payment handle (Venmo / Cash App)', '$sampay']))).toEqual({});
    expect(profileFromAnswers(answers(['PayPal email', 'pay-sam@example.com'], ['Email', 'sam@example.com'])))
      .toEqual({ email: 'sam@example.com' });
    expect(profileFromAnswers(answers(
      ['Credit union account (for direct deposit)', 'Alliant CU 0047712345 routing 271081528'],
      ['Credit union acct (direct deposit)', '000123456789'],
      ['Credit union info for direct deposit', 'Alliant 000123456789 / 271081528'],
      ['Credits for your stage introduction', 'As seen on Comedy Central'],
    ))).toEqual({ credits: 'As seen on Comedy Central' });
  });

  it('still reads the ordinary ways of asking for socials', () => {
    for (const label of [
      'Social media', 'Socials', 'Social handle', 'Instagram or main social', 'Social media account details',
      'Social #1', 'Main social, no links', 'Full social media link',
    ]) {
      expect(profileFromAnswers(answers([label, '@monasable'])).socialMedia).toBe('@monasable');
    }
    expect(profileFromAnswers(answers(['Where can people find you online?', '@monasable'])).socialMedia).toBe('@monasable');
  });

  it('reads a record whatever shape it arrived in', () => {
    // The signer's browser writes the record, so nothing about it is promised.
    for (const fields of [undefined, null, 'Email', 42, {}, { length: 2 }, [[]], [null, 7, 'Email']]) {
      expect(profileFromAnswers(fields)).toEqual({});
    }
    const profile = profileFromAnswers([
      null, 7, 'Email: a@b.example', ['Email', 'a@b.example'],
      { label: 5, value: 'mona@sable.example' }, { value: 'mona@sable.example' },
      { label: 'Email' }, { label: 'Email', value: { address: 'mona@sable.example' } },
      { label: 'Phone', value: null }, { label: 'Phone', value: 5550142 },
      { label: 'Instagram', value: Number.NaN }, { label: 'Instagram', value: '@monasable' },
    ]);
    expect(profile).toEqual({ phone: '5550142', socialMedia: '@monasable' });
  });
});

describe('a record’s answers, as far as they can be read', () => {
  it('keeps every labelled answer, and reads anything but text or a number as unanswered', () => {
    expect(readAnswers([
      { label: 'Email', value: 'mona@sable.example' }, { label: 'Phone', value: 5550142 },
      { label: 'Fee', value: Infinity }, { label: 'Notes', value: null }, { label: 'Bio', value: ['x'] }, { label: 'Song' },
      { label: 7, value: 'x' }, null, 'Email', ['Email', 'x'],
    ])).toEqual([
      { label: 'Email', value: 'mona@sable.example' }, { label: 'Phone', value: '5550142' },
      { label: 'Fee', value: '' }, { label: 'Notes', value: '' }, { label: 'Bio', value: '' }, { label: 'Song', value: '' },
    ]);
    expect(readAnswers({ 0: { label: 'Email', value: 'x' }, length: 1 })).toEqual([]);
    expect(readAnswers(undefined)).toEqual([]);
  });
});

describe('questions that ask for an ID number', () => {
  it.each([
    'Social security number', 'Social Security #', 'Last 4 of your social security', 'Social sec. no.', 'Soc. Sec. #', 'soc sec number',
    'Social # (for the 1099)', 'Social no.', 'Social number', 'SS#', 'SS #', 'SSN', 'Your ssn', 'S.S.N.',
    'Social insurance number', 'SIN', 'SIN (Canada)', 'National Insurance number', 'NI number', 'NI no.', 'N.I. no', 'NINO',
    'Tax ID', 'Tax ID (EIN or SSN)', 'Tax identification number', 'Tax number', 'TIN', 'EIN', 'ITIN', 'Taxpayer reference', 'Employer identification number',
    'Passport', 'Passport number', "Driver's license number", 'Driver’s licence #', 'Drivers license', 'Driving licence number', 'Lic #', 'Lic. no', 'License number', 'DL #', 'DL no.', 'DL number',
    'Bank account', 'Bank account number', 'Bank details (for your fee)', 'Checking account', 'Account number', 'Account #', 'Acct #', 'Acct no.',
    'Routing number', 'ABA routing #', 'Sort code', 'IBAN', 'SWIFT', 'SWIFT/BIC', 'Swift code', 'BSB',
    // "Social" alone, beside a tax form, payroll, a tax ID or its digits.
    'Social (for the 1099)', 'Social (W-9)', 'Social (W9)', 'Social (for payroll)', 'Social - needed for the 1099', 'Social (for tax purposes)',
    'Social or ein', 'Social or EIN', 'Social or ITIN', 'W9 info: name, address, social', 'Last 4 of social', 'Last four digits of your social',
    'Social (9 digits, no dashes)', 'Full social', 'Full social (no dashes)', 'Social no', 'Social no (for the 1099)',
    'Número de Seguro Social', 'Seguro Social', 'Número de la Seguridad Social', 'Numéro de sécurité sociale',
    'Credit union account', 'Credit union acct (direct deposit)', 'Credit union info for direct deposit',
  ])('knows %j asks for one', label => {
    expect(asksForIdNumber(label)).toBe(true);
  });

  it.each([
    'Social media', 'Socials', 'Social handle', 'Your socials', 'Instagram or main social', 'Social media account details', 'Instagram account',
    'Twitter/X account', 'Where can people find you online?', 'OK to post your photo on social media?', 'Can we tag you on socials?',
    'Walk-on song (e.g. Taylor Swift)', 'Taylor Swift', 'Ein Lied für den Auftritt', 'Any destinations or tins?', 'Your sins, confessed',
    'Email', 'Phone', 'Contact number', 'Best number for show-day texts', 'Stage name', 'How to credit you', 'Venmo', 'PayPal email',
    'Mailing address', 'Tax form on file?', 'Account name', 'Show date', 'Licence to film your set?',
    // Numbered socials, and the word no.
    'Social #1', 'Social # 2', 'Social account #2', 'Main social no links', 'Main social, no links', 'Socials, no DMs please',
    'Full social media link', 'Full socials', 'Credits for your stage introduction',
  ])('knows %j does not', label => {
    expect(asksForIdNumber(label)).toBe(false);
  });
});

describe('questions about paying them', () => {
  it.each([
    'Venmo', 'Venmo handle (for your fee)', 'PayPal handle', 'PayPal email', 'Pay Pal', 'Payment handle (Venmo / Cash App)', 'Cash App $cashtag',
    'Zelle', 'Interac e-Transfer email', 'Payout email', 'Payment details', 'How do you want to be paid?', 'Apple Pay', 'Payroll email',
    'Direct deposit', 'Credit union account (for direct deposit)', 'Bank details',
  ])('knows %j does', label => {
    expect(asksForPayment(label)).toBe(true);
  });

  it.each([
    'Email', 'Phone', 'Best number for show-day texts', 'Instagram or main social', 'Social media', 'Socials', 'Social handle', 'Twitter/X account',
    'Where can people find you online?', 'Credits for your stage introduction', 'How should we introduce you?', 'Walk-on song', 'Stage name',
    'Taylor Swift', 'Mailing address', 'Display name', 'Your IG handle, so we can tag you',
  ])('knows %j does not', label => {
    expect(asksForPayment(label)).toBe(false);
  });
});

describe('what a payment or ID question can still leave behind', () => {
  it.each([
    ['Social-Security #', '123-45-6789'],
    ['Social Securty #', '123-45-6789'],
    ['Social Ins. No.', '123 456 789'],
    ['Social (needed to cut your check)', '123-45-6789'],
    ['Your social (for accounting)', '123456789'],
  ])('never files the digits typed for %j as a handle', (label, value) => {
    expect(profileFromAnswers(answers(['Email', 'sam@example.com'], [label, value]))).toEqual({ email: 'sam@example.com' });
  });

  it('files the real handle when a payment app\'s tag comes first', () => {
    for (const label of ['Revolut handle (for your fee)', 'Monzo handle', 'Chime handle', 'Wise tag (for your fee)']) {
      expect(profileFromAnswers(answers([label, '@adacole'], ['Instagram or main social', '@ada.cole']))).toEqual({ socialMedia: '@ada.cole' });
    }
  });

  it('still reads an email or phone question that mentions payment', () => {
    expect(profileFromAnswers(answers(
      ['Email (for booking & payment)', 'ada@example.com'],
      ['Phone (for show-day texts & payment questions)', '555-0100'],
      ['Instagram or main social', '@ada'],
    ))).toEqual({ email: 'ada@example.com', phone: '555-0100', socialMedia: '@ada' });
  });

  it('never reads a credit union as credits', () => {
    expect(profileFromAnswers(answers(['Credit union (for your fee)', 'Navy Federal']))).toEqual({});
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

describe('what a signed contract fills in by itself', () => {
  const key = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');
  const signed = (fields: { label: string; value: string }[], sentAt = '2026-03-01') => ({
    signerName: 'Ada Cole', sentAt, signed: { fields },
  });

  it('fills a blank on the profile without being asked', () => {
    const patch = signedProfilePatch(
      [signed([{ label: 'Email', value: 'ada@example.com' }])],
      { name: 'Ada Cole' },
      key,
    );
    expect(patch).toEqual({ email: 'ada@example.com' });
  });

  it('never replaces something the producer already put there', () => {
    // The whole reason the import was an offer: two different numbers is a
    // question only they can settle.
    const patch = signedProfilePatch(
      [signed([{ label: 'Phone', value: '555 9999' }])],
      { name: 'Ada Cole', phone: '555 0142' },
      key,
    );
    expect(patch).toBeNull();
  });

  it('fills the blanks and leaves the conflict alone in the same contract', () => {
    const patch = signedProfilePatch(
      [signed([
        { label: 'Email', value: 'ada@example.com' },
        { label: 'Phone', value: '555 9999' },
      ])],
      { name: 'Ada Cole', phone: '555 0142' },
      key,
    );
    expect(patch).toEqual({ email: 'ada@example.com' });
  });

  it('takes the most recent answer when they have signed more than once', () => {
    const patch = signedProfilePatch(
      [
        signed([{ label: 'Email', value: 'old@example.com' }], '2026-01-01'),
        signed([{ label: 'Email', value: 'new@example.com' }], '2026-06-01'),
      ],
      { name: 'Ada Cole' },
      key,
    );
    expect(patch).toEqual({ email: 'new@example.com' });
  });

  it('does not put one person\'s answers on another', () => {
    expect(signedProfilePatch([signed([{ label: 'Email', value: 'a@b.c' }])], { name: 'Ben Stone' }, key))
      .toBeNull();
  });

  it('says nothing to write when every profile is already complete', () => {
    const comics = [{ id: 'c', name: 'Ada Cole', email: 'ada@example.com' }];
    expect(fillRolodexFromSignatures(
      [signed([{ label: 'Email', value: 'ada@example.com' }])], comics, key, () => 'new',
    )).toBeNull();
  });

  it('files someone who signed and was never added to the rolodex', () => {
    const filled = fillRolodexFromSignatures(
      [signed([{ label: 'Email', value: 'ada@example.com' }])], [], key, () => 'new',
    );
    expect(filled).toEqual([{ id: 'new', name: 'Ada Cole', email: 'ada@example.com' }]);
  });

  it('does not quietly put a social security number on the profile as a phone', () => {
    // The gap fill runs on every visit with no offer, so anything it writes
    // has to be something nobody would mind seeing on a show's performer.
    const comics = [{ id: 'c', name: 'Ada Cole' }];
    expect(fillRolodexFromSignatures(
      [signed([
        { label: 'Social Security Number', value: '123-45-6789' },
        { label: 'Bank account number', value: '00012345678' },
      ])],
      comics, key, () => 'new',
    )).toBeNull();
  });

  it('does not file a social security number asked for as "Social #" as their handle', () => {
    // Filed as "@012-34-5678", where the Rolodex, the show and an assistant
    // with rolodex:read would all show it.
    const comics = [{ id: 'c', name: 'Ada Cole' }];
    expect(fillRolodexFromSignatures(
      [signed([{ label: 'Social # (for the 1099)', value: '012-34-5678' }, { label: 'Social sec. no.', value: '012-34-5678' }])],
      comics, key, () => 'new',
    )).toBeNull();
  });

  it('files only their contact details from a contract that also asks how to pay and tax them', () => {
    // The entry the contract was sent to, with no handle yet: every one of
    // these once landed on it as the handle or the credits.
    const comics = [{ id: 'c-sam', name: 'Sam Okafor' }];
    const request = {
      ...signed([
        { label: 'Stage name', value: 'Sam Okafor' },
        { label: 'Phone', value: '312-555-0199' },
        { label: 'Social (for the 1099)', value: '123-45-6789' },
        { label: 'Last four digits of your social', value: '6789' },
        { label: 'Venmo handle (for your fee)', value: '@sam-okafor-pay' },
        { label: 'Credit union account (for direct deposit)', value: 'Alliant CU 0047712345 routing 271081528' },
        { label: 'Instagram', value: '@samcomedy' },
      ]),
      signerName: 'Sam Okafor', contactId: 'c-sam',
    };
    expect(fillRolodexFromSignatures([request], comics, key, () => 'new'))
      .toEqual([{ id: 'c-sam', name: 'Sam Okafor', phone: '312-555-0199', socialMedia: '@samcomedy' }]);
  });

  it('reads the rest of someone’s contracts when one record is malformed', () => {
    const malformed = { signerName: 'Ada Cole', signed: { fields: 'Email: ada@example.com' as unknown as { label: string; value: string }[] } };
    expect(fillRolodexFromSignatures(
      [malformed, signed([{ label: 'Email', value: 'ada@example.com' }])], [], key, () => 'new',
    )).toEqual([{ id: 'new', name: 'Ada Cole', email: 'ada@example.com' }]);
  });

  it('does not fill their phone with the emergency contact they gave', () => {
    // Phone was optional and skipped; the emergency contact was required.
    // Their mother's number is not who the show-day texts should go to.
    const comics = [{ id: 'c', name: 'Ada Cole' }];
    expect(fillRolodexFromSignatures(
      [signed([{ label: 'Emergency contact phone', value: 'Mum 07700 900123' }])],
      comics, key, () => 'new',
    )).toBeNull();
  });
});


describe('signed details stay attached to their Rolodex identity', () => {
  const key = (name: string) => name.trim().toLowerCase();
  const request = {
    token: 'signed-token', contactId: 'ada', signerName: 'Ada Original',
    signed: { fields: [{ label: 'Email', value: 'ada@example.com' }], headshot: 'data:image/jpeg;base64,face' },
  };

  it('fills a renamed comic by id and creates no duplicate entry under their former name', () => {
    const comics = [{ id: 'ada', name: 'Ada Current' }];
    expect(signedProfilePatch([request], comics[0], key)).toEqual({ email: 'ada@example.com' });
    const result = fillRolodexFromSignatures([request], comics, key, () => 'new-id');
    expect(result).toEqual([{ id: 'ada', name: 'Ada Current', email: 'ada@example.com' }]);
    const [headshot] = headshotsToFile([request], comics, key);
    expect(headshot.entryId).toBe('ada');
    expect(applyFiledHeadshot(comics, headshot, 'media:face', () => 'new-id')).toEqual([
      { id: 'ada', name: 'Ada Current', photo: 'media:face' },
    ]);
    expect(request.signerName).toBe('Ada Original');
  });

  it('never fills or files a namesake from a request addressed to a deleted identity', () => {
    const comics = [{ id: 'other-ada', name: 'Ada Original' }];
    expect(signedProfilePatch([request], comics[0], key)).toBeNull();
    expect(fillRolodexFromSignatures([request], comics, key, () => 'new-id')).toBeNull();
    const [headshot] = headshotsToFile([request], comics, key);
    expect(headshot).toMatchObject({ entryId: undefined, wantsPhoto: false });
    expect(applyFiledHeadshot(comics, headshot, 'media:face', () => 'new-id')).toBe(comics);
  });

  it('does not assign legacy name-only details or photos to ambiguous duplicate names', () => {
    const comics = [{ id: 'one', name: 'Ada Original' }, { id: 'two', name: 'Ada Original' }];
    const legacy = { ...request, contactId: undefined };
    expect(fillRolodexFromSignatures([legacy], comics, key, () => 'new-id')).toBeNull();
    expect(headshotsToFile([legacy], comics, key)[0].wantsPhoto).toBe(false);
  });

  it('does not refill an intentionally cleared field once signed answers have been filed', () => {
    const comics = [{ id: 'ada', name: 'Ada Current', email: '' }];
    expect(fillRolodexFromSignatures([{ ...request, profileFiled: true }], comics, key, () => 'new-id')).toBeNull();
    // Explicit imports can still offer the original answers when requested.
    expect(signedProfilePatch([request], comics[0], key)).toEqual({ email: 'ada@example.com' });
  });

  it('does not overwrite a newer headshot or recreate a removed entry after an upload finishes', () => {
    const [headshot] = headshotsToFile([request], [{ id: 'ada', name: 'Ada Current' }], key);
    const newer = [{ id: 'ada', name: 'Ada Current', photo: 'media:newer' }];
    expect(applyFiledHeadshot(newer, headshot, 'media:old-upload', () => 'new-id')).toBe(newer);
    const removed: PotentialComic[] = [];
    expect(applyFiledHeadshot(removed, headshot, 'media:old-upload', () => 'new-id')).toBe(removed);
  });
});

describe('what a visit to the Contracts page writes back', () => {
  const signed = [{ id: 'r', token: 't', key: 'k', contractId: 'c', contractName: 'Agreement', signerName: 'Ada', sentAt: '' }];
  const comics: PotentialComic[] = [{ id: 'ada', name: 'Ada' }];

  it('keeps a signature that only filled Rolodex gaps, with no headshot to file', () => {
    // The case that read as unsigned until the next visit: answers filled a
    // gap, nothing to file, and the paperwork list was left out of the write.
    const patch = signatureVisitPatch(signed, null, comics);
    expect(patch).toEqual({ signatureRequests: signed, potentialComics: comics });
  });

  it('lets a filed headshot carry the paperwork list, and the gap fill the Rolodex', () => {
    const filedRequests = [{ ...signed[0], id: 'filed' }];
    const filedComics: PotentialComic[] = [{ id: 'ada', name: 'Ada', photo: 'media:1' }];
    const patch = signatureVisitPatch(signed, { signatureRequests: filedRequests, potentialComics: filedComics }, comics);
    expect(patch).toEqual({ signatureRequests: filedRequests, potentialComics: comics });
  });

  it('writes nothing when nothing changed', () => {
    expect(signatureVisitPatch(null, null, null)).toBeNull();
    expect(signatureVisitPatch(signed, null, null)).toEqual({ signatureRequests: signed });
  });
});
