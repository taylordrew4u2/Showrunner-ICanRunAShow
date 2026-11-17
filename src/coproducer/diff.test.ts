import { describe, expect, it } from 'vitest';
import type { AppSettings, Show } from '../types';
import {
  describeConflict,
  describedKeys,
  describePayload,
  diffSettings,
  diffShow,
  headline,
  humanizeKey,
  parseMailto,
  visibleText,
  type DiffContext,
} from './diff';
import { buildOutline } from './outline';
import { sameValue } from './paths';
import { clone, FIXTURE_SECRETS, fullArtist, fullPerformer, fullSettings, fullShow } from './testFixtures';
import type { ChangeGroup, EditPayload, FieldChange, RequestPayload } from './types';

const state = { shows: [fullShow()], settings: fullSettings() };
const ctx: DiffContext = { state };

function changesOf(group: ChangeGroup | null): FieldChange[] {
  return group?.changes ?? [];
}
function find(changes: FieldChange[], key: string): FieldChange | undefined {
  return changes.find((change) => change.key === key);
}
/**
 * Everything a reader is shown: titles, notes, paths, labels, values and
 * hand-overs. Keys are machine paths in the grammar of paths.ts, which names
 * link rows by their token (pseudonymous on the co-producer's side), and are
 * never displayed.
 */
function allText(groups: (ChangeGroup | null)[]): string {
  return JSON.stringify(groups.map((group) => group && {
    title: group.title,
    note: group.note,
    handOver: group.handOver,
    changes: group.changes.map((change) => ({ ...change, key: undefined })),
  }));
}

describe('every field has a name', () => {
  const keys = describedKeys();

  it('names every top-level show and settings key', () => {
    for (const key of Object.keys(fullShow())) expect(keys.show, key).toContain(key);
    for (const key of Object.keys(fullSettings())) expect(keys.settings, key).toContain(key);
    for (const key of Object.keys(fullShow().recap)) expect(keys.recap, key).toContain(key);
  });

  it('names every field of every list’s rows', () => {
    const show = fullShow();
    const settings = fullSettings();
    const lists: [string, object][] = [
      ['performers', show.performers[0]],
      ['artists', show.artists[0]],
      ['schedule', show.schedule[0]],
      ['hosts', show.hosts[0]],
      ['djSongs', show.djSongs[0]],
      ['staff', show.staff[0]],
      ['vendors', show.vendors[0]],
      ['expenses', show.expenses[0]],
      ['scenes', show.scenes[0]],
      ['todos', show.todos[0]],
      ['producers', settings.producers[0]],
      ['potentialComics', settings.potentialComics[0]],
      ['emailList', settings.emailList[0]],
      ['scheduleTemplates', settings.scheduleTemplates[0]],
      ['musicLibrary', settings.musicLibrary[0]],
      ['contracts', settings.contracts[0]],
      ['signedAgreements', settings.signedAgreements[0]],
      ['signatureRequests', settings.signatureRequests[0]],
      ['profileRequests', settings.profileRequests[0]],
      ['trash', settings.trash[0]],
    ];
    for (const [list, row] of lists) {
      for (const key of Object.keys(row)) expect(keys.lists[list], `${list}.${key}`).toContain(key);
    }
  });

  it('labels a new show’s fields from the tables, not from the keys', () => {
    const labels = changesOf(diffShow(null, fullShow())).map((c) => c.label);
    for (const label of ['Show name', 'Date', 'Show time', 'Venue name', 'Location', 'Status', 'Host', 'Ticket link', 'Flyer', 'Booking target', 'Production notes', 'Viewer page note', 'Hidden sections', 'Library tracks left out', 'Added', 'Headshot', 'Walk-on track', 'Segment', 'Cue music', 'Hosting', 'Role', 'Cost', 'To-do', 'Attendance', 'What to improve', 'Basic Info']) {
      expect(labels, label).toContain(label);
    }
    for (const bookkeeping of ['Id', 'Created at', 'Updated at', 'Viewer key', 'View token', 'Comic id', 'Performer id', 'Library id', 'Profit loss', 'Order']) {
      expect(labels, bookkeeping).not.toContain(bookkeeping);
    }
  });
});

describe('modes', () => {
  it('leaves bookkeeping out in review mode', () => {
    const before = fullShow();
    const after = { ...before, id: before.id, createdAt: 'later', updatedAt: 'later', viewerKey: 'new', viewToken: 'other', recap: { ...before.recap, profitLoss: 1 }, performers: [{ ...before.performers[0], comicId: 'c9' }] };
    expect(diffShow(before, after)).toBeNull();
  });

  it('shows every key in complete mode, under Other details, and never a token', () => {
    const before = fullShow();
    const after = {
      ...before,
      createdAt: '2026-07-03T00:00:00.000Z',
      updatedAt: 'later',
      viewToken: undefined,
      viewerKey: undefined,
      mystery: 'surprise',
      performers: [{ ...before.performers[0], comicId: 'c9' }],
    } as unknown as Show;
    const changes = changesOf(diffShow(before, after, { complete: true }));
    expect(find(changes, 'createdAt')).toMatchObject({ path: ['Other details'], label: 'Created at' });
    expect(find(changes, 'mystery')).toMatchObject({ path: ['Other details'], label: 'Mystery', after: 'surprise' });
    expect(find(changes, 'performers/p1/comicId')).toMatchObject({ path: ['Performers', 'Sam Lee', 'Other details'], label: 'Comic id', before: 'c1', after: 'c9' });
    expect(find(changes, 'viewToken')).toMatchObject({ label: 'Viewer link', before: 'On', after: 'Withdrawn' });
    expect(find(changes, 'updatedAt')).toBeUndefined();
    const text = JSON.stringify(changes);
    expect(text).not.toContain(FIXTURE_SECRETS.viewToken);
    expect(text).not.toContain(FIXTURE_SECRETS.viewerKey);
  });

  it('never shows a link token or key in settings, in any mode', () => {
    const before = fullSettings();
    const after = { ...before, signatureRequests: [], profileRequests: [], trash: [] };
    for (const complete of [false, true]) {
      const text = allText(diffSettings(before, after, { complete }));
      for (const secret of Object.values(FIXTURE_SECRETS)) expect(text).not.toContain(secret);
    }
    const added = allText(diffSettings({ ...before, signatureRequests: [] }, before, { complete: true }));
    expect(added).toContain('Contract links');
    for (const secret of Object.values(FIXTURE_SECRETS)) expect(added).not.toContain(secret);
  });

  it('shows the derived settings only in complete mode', () => {
    const before = fullSettings();
    const after = { ...before, deletedShowIds: ['show-old', 'show1'], onboarded: false };
    expect(diffSettings(before, after)).toEqual([]);
    const changes = diffSettings(before, after, { complete: true, state })[0].changes;
    expect(find(changes, 'deletedShowIds/show1')).toMatchObject({ label: 'Shows kept deleted', after: '“Friday Laughs” stays deleted' });
    expect(find(changes, 'onboarded')).toMatchObject({ label: 'Welcome finished', before: 'Yes', after: 'No' });
  });
});

describe('rows', () => {
  const lists: [keyof Show, () => object[]][] = [
    ['performers', () => [fullPerformer(), fullPerformer({ id: 'p2', name: 'Ann Other' })]],
    ['artists', () => [fullArtist(), fullArtist({ id: 'a2', name: 'Cal Painter' })]],
    ['schedule', () => [fullShow().schedule[0], { ...fullShow().schedule[0], id: 'cue2', time: '8:10 PM', description: 'Opener' }]],
    ['hosts', () => [fullShow().hosts[0], { id: 'h2', name: 'Dee', isHosting: false }]],
    ['djSongs', () => [fullShow().djSongs[0], { id: 'd2', title: 'Two', artist: 'B' }]],
    ['staff', () => [fullShow().staff[0], { id: 'st2', role: 'Door', personName: 'Flo' }]],
    ['vendors', () => [fullShow().vendors[0], { id: 'v2', name: 'Bar' }]],
    ['expenses', () => [fullShow().expenses[0], { id: 'e2', category: 'Venue', itemName: 'Mics', cost: 10 }]],
    ['scenes', () => [fullShow().scenes[0], { id: 'sc2', title: 'Close', description: '', duration: 2, status: 'done', order: 1 }]],
    ['todos', () => [fullShow().todos[0], { id: 't2', text: 'Call venue', completed: true }]],
  ];

  for (const [list, rows] of lists) {
    it(`adds, removes, changes and reorders ${list}`, () => {
      const [first, second] = rows() as Record<string, unknown>[];
      const base = fullShow({ [list]: [first, second] });
      const firstId = first.id as string;
      const secondId = second.id as string;

      const added = changesOf(diffShow(fullShow({ [list]: [first] }), base));
      expect(find(added, `${list}/${secondId}`)).toMatchObject({ label: 'Added', change: 'added', before: null });

      const removed = changesOf(diffShow(base, fullShow({ [list]: [first] })));
      expect(find(removed, `${list}/${secondId}`)).toMatchObject({ label: 'Removed', change: 'removed', after: null });

      const field = list === 'todos' ? 'text' : list === 'staff' ? 'personName' : list === 'expenses' ? 'itemName' : list === 'scenes' || list === 'djSongs' ? 'title' : list === 'schedule' ? 'description' : 'name';
      const changed = changesOf(diffShow(base, fullShow({ [list]: [{ ...first, [field]: 'Renamed' }, second] })));
      expect(find(changed, `${list}/${firstId}/${field}`)).toMatchObject({ change: 'changed', after: 'Renamed' });

      const moved = changesOf(diffShow(base, fullShow({ [list]: [second, first] })));
      expect(find(moved, `${list}#order`)).toMatchObject({ label: 'Order', change: 'moved' });
    });
  }

  it('names the row each change is in', () => {
    const before = fullShow();
    const after = fullShow({ performers: [fullPerformer({ email: 'new@example.com' })] });
    expect(changesOf(diffShow(before, after))).toEqual([
      { key: 'performers/p1/email', path: ['Performers', 'Sam Lee'], label: 'Email', before: 'sam@example.com', after: 'new@example.com', change: 'changed' },
    ]);
  });

  it('keeps any row id to one path segment', () => {
    const odd = fullPerformer({ id: 'a/b#c' });
    const changes = changesOf(diffShow(fullShow({ performers: [] }), fullShow({ performers: [odd] })));
    expect(changes[0].key).toBe('performers/a%2Fb%23c');
  });

  it('says where same-named rows were when only their order changed', () => {
    const one = fullPerformer({ id: 'x1', name: 'Sam' });
    const two = fullPerformer({ id: 'x2', name: 'Sam' });
    const change = find(changesOf(diffShow(fullShow({ performers: [one, two] }), fullShow({ performers: [two, one] }))), 'performers#order')!;
    expect(change.before).not.toBe(change.after);
  });

  it('lists recap, sections and hidden sections one by one', () => {
    const before = fullShow();
    const after = fullShow({
      recap: { ...before.recap, attendance: 90, ticketSales: 1234.5 },
      completions: { ...before.completions, artists: true },
      hiddenSections: ['scenes', 'dj'],
      djHiddenLibraryIds: [],
    });
    const changes = changesOf(diffShow(before, after, { musicLibrary: [{ ...fullSettings().musicLibrary[0], id: 'lib2', title: 'Hidden Track' }] }));
    expect(find(changes, 'recap/attendance')).toMatchObject({ path: ['Recap'], label: 'Attendance', before: '80', after: '90' });
    expect(find(changes, 'recap/ticketSales')).toMatchObject({ label: 'Ticket sales', after: (1234.5).toLocaleString(undefined, { maximumFractionDigits: 2 }) });
    expect(find(changes, 'completions/artists')).toMatchObject({ path: ['Sections marked done'], label: 'Artists', before: 'No', after: 'Yes' });
    expect(find(changes, 'hiddenSections/dj')).toMatchObject({ label: 'Hidden sections', before: null, after: 'DJ Music' });
    expect(find(changes, 'djHiddenLibraryIds/lib2')).toMatchObject({ label: 'Library tracks left out', before: 'Hidden Track', after: null });
    expect(changesOf(diffShow(before, fullShow({ djHiddenLibraryIds: ['zzz'] })))[0].after).toBe('Track zzz');
  });

  it('shows a replaced photo with both files', () => {
    const after = fullShow({ performers: [fullPerformer({ photo: 'media:22222222-0000#1' })] });
    expect(find(changesOf(diffShow(fullShow(), after)), 'performers/p1/photo')).toEqual({
      key: 'performers/p1/photo',
      path: ['Performers', 'Sam Lee'],
      label: 'Headshot',
      before: 'Photo on file',
      after: 'Replaced photo',
      change: 'changed',
      media: { kind: 'image', before: fullPerformer().photo, after: 'media:22222222-0000#1' },
    });
    const track = find(changesOf(diffShow(fullShow(), fullShow({ performers: [fullPerformer({ walkOnMusic: 'media:33333333-0000#1', walkOnMusicName: 'new.mp3' })] }))), 'performers/p1/walkOnMusic')!;
    expect(track).toMatchObject({ before: 'Audio on file: walkon.mp3', after: 'Replaced audio file: new.mp3' });
    const added = find(changesOf(diffShow(fullShow({ flyer: undefined }), fullShow())), 'flyer')!;
    expect(added).toMatchObject({ before: null, after: 'New photo', change: 'added' });
  });

  it('formats times, dates, money and yes/no', () => {
    const changes = changesOf(diffShow(fullShow(), fullShow({
      date: '2026-09-05',
      performers: [fullPerformer({ walkOnStartSec: 75.5, surpriseGuest: true })],
      vendors: [{ ...fullShow().vendors[0], cost: 99.999 }],
    })));
    expect(find(changes, 'performers/p1/walkOnStartSec')).toMatchObject({ before: '0:30', after: '1:15.5' });
    expect(find(changes, 'performers/p1/surpriseGuest')).toMatchObject({ before: 'No', after: 'Yes' });
    expect(find(changes, 'date')!.after).toBe(new Date(2026, 8, 5).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }));
    expect(find(changes, 'vendors/v1/cost')!.after).toBe((99.999).toLocaleString(undefined, { maximumFractionDigits: 2 }));
  });
});

describe('settings', () => {
  it('lists template cues one by one', () => {
    const before = fullSettings();
    const template = before.scheduleTemplates[0];
    const after = { ...before, scheduleTemplates: [{ ...template, items: [{ ...template.items[0], durationMin: 7 }, { time: '8:10 PM', description: 'Opener' }] }] };
    const changes = diffSettings(before, after)[0].changes;
    expect(find(changes, 'scheduleTemplates/tpl1/items/0')).toMatchObject({
      path: ['Running order templates', 'Friday format'],
      label: 'Cue 1',
      before: 'Time: 8:00 PM · Segment: Host opens · On stage: Host · Length (min): 5',
      after: 'Time: 8:00 PM · Segment: Host opens · On stage: Host · Length (min): 7',
    });
    expect(find(changes, 'scheduleTemplates/tpl1/items/1')).toMatchObject({ label: 'Cue 2', before: null, change: 'added' });
  });

  it('lists contract questions with their flags', () => {
    const before = fullSettings();
    const contract = before.contracts[0];
    const after = { ...before, contracts: [{ ...contract, fields: [{ ...contract.fields![0], multiline: true }, { id: 'f2', label: 'Address', placeholder: 'Street' }] }] };
    const changes = diffSettings(before, after)[0].changes;
    expect(changes.map((c) => [c.label, c.before, c.after])).toEqual([
      ['Question', 'Stage name · required · hint “As billed”', 'Stage name · required · several lines · hint “As billed”'],
      ['Question', null, 'Address · hint “Street”'],
    ]);
  });

  it('tells a restore from a delete for good', () => {
    const before = fullSettings();
    const after = { ...before, trash: [] };
    const gone = diffSettings(before, after, { state })[0];
    expect(gone).toMatchObject({ key: 'settings:trash', title: 'Recently deleted' });
    expect(gone.changes[0]).toMatchObject({ label: 'Deleted for good', before: 'Old Show', after: null });
    const back = diffSettings(before, after, { state: { ...state, shows: [...state.shows, before.trash[0].data] } })[0];
    expect(back.changes[0].label).toBe('Restored');
    const moved = diffSettings(after, before)[0];
    expect(moved.changes).toEqual([{ key: 'trash/tr1', path: ['Recently deleted'], label: 'Moved to Recently deleted', before: null, after: 'Old Show', change: 'added' }]);
  });

  it('tells a withdrawn link from a deleted signed record', () => {
    const before = fullSettings();
    const unsigned = { ...before.signatureRequests[0], signed: undefined };
    expect(diffSettings(before, { ...before, signatureRequests: [] })[0].changes[0].label).toBe('Signed record deleted');
    expect(diffSettings({ ...before, signatureRequests: [unsigned] }, { ...before, signatureRequests: [] })[0].changes[0].label).toBe('Link withdrawn');
    const profile = before.profileRequests[0];
    expect(diffSettings(before, { ...before, profileRequests: [] })[0].changes[0].label).toBe('Details link and their answers removed');
    expect(diffSettings({ ...before, profileRequests: [{ ...profile, submitted: undefined }] }, { ...before, profileRequests: [] })[0].changes[0].label).toBe('Details link withdrawn');
  });

  it('shows a signed record in full', () => {
    const before = fullSettings();
    const sig = before.signatureRequests[0];
    const unsigned = { ...sig, signed: undefined };
    const changes = diffSettings({ ...before, signatureRequests: [unsigned] }, before)[0].changes;
    const signed = find(changes, `signatureRequests/${sig.token}/signed`)!;
    expect(signed.after).toContain('Sam Lee on ');
    expect(signed.after).toContain('Stage name: Sam');
    expect(signed.after).toContain('Agreed: I will give a day’s notice.');
  });

  it('groups the workspace fields under Settings, and the rest by list', () => {
    const before = fullSettings();
    const after = {
      ...before,
      brandName: 'New Co',
      showTypes: ['Comedy', 'Drag'],
      producers: [...before.producers, { id: 'pr2', name: 'Bo', role: 'Host' }],
      potentialComics: [{ ...before.potentialComics[0], notes: 'Closes strong.' }],
      emailList: [],
    };
    const groups = diffSettings(before, after, { rolodexPlural: 'Comics' });
    expect(groups.map((g) => [g.key, g.title])).toEqual([
      ['settings:workspace', 'Settings'],
      ['settings:potentialComics', 'Comics'],
      ['settings:emailList', 'Email list'],
    ]);
    expect(groups[0].changes.map((c) => c.key)).toEqual(['brandName', 'showTypes/Drag', 'producers/pr2', 'producers/pr2/name', 'producers/pr2/role']);
    expect(find(groups[1].changes, 'potentialComics/c1/notes')).toMatchObject({ path: ['Comics', 'Sam Lee'], label: 'Notes' });
    expect(groups[2].changes).toEqual([{ key: 'emailList/fan%40example.com', path: ['Email list'], label: 'Removed', before: 'fan@example.com', after: null, change: 'removed' }]);
  });
});

describe('a change always reads as a change', () => {
  const values: unknown[] = [
    undefined, null, '', ' ', '  ', 'a', ' a', 'a ', 'A', '\u202E', 'x\u202Ey', 'x\u200By', 'xy', 'x⟨U+202E⟩y',
    'a'.repeat(250), `${'a'.repeat(200)}b${'a'.repeat(49)}`, 'line\nline', 'line\r\nline',
    0, -0, 1, 1.5, 1.499, 1.501, NaN, false, true, [], [''], ['a'], ['a', 'b'], ['b', 'a'], ['a, b'],
    {}, { a: 1 }, { a: '1' }, '1', 'true', 'No', 'Nothing', '2026-08-01', 'Aug 1, 2026', 'media:aaaaaaaa#1', 'data:image/png;base64,AA',
  ];
  const fields = ['venueName', 'performerTarget', 'sample', 'date', 'flyer', 'status'];

  it('never formats two different raw values the same', () => {
    let checked = 0;
    for (const field of fields) {
      for (const a of values) {
        for (const b of values) {
          if (sameValue(a, b)) continue;
          const before = { ...fullShow(), [field]: a } as unknown as Show;
          const after = { ...fullShow(), [field]: b } as unknown as Show;
          for (const complete of [false, true]) {
            for (const change of changesOf(diffShow(before, after, { complete }))) {
              expect(change.before, `${field}: ${String(a)} → ${String(b)}`).not.toBe(change.after);
              checked += 1;
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(5000);
  });

  it('never cuts a value', () => {
    const long = `${'Long notes. '.repeat(2000)}The end.`;
    const change = find(changesOf(diffShow(fullShow(), fullShow({ productionNotes: long }))), 'productionNotes')!;
    expect(change.after).toBe(long.trim());
  });
});

describe('text', () => {
  it('makes invisible and direction characters visible', () => {
    expect(visibleText('abc')).toBe('abc');
    expect(visibleText('gnp.\u202Eexe')).toBe('gnp.⟨U+202E⟩exe');
    expect(visibleText('a\u2066b\u2069')).toBe('a⟨U+2066⟩b⟨U+2069⟩');
    expect(visibleText('zero\u200Bwidth\uFEFF')).toBe('zero⟨U+200B⟩width⟨U+FEFF⟩');
    expect(visibleText('bell\u0007 cr\r')).toBe('bell⟨U+0007⟩ cr⟨U+000D⟩');
    expect(visibleText('tab\tnew\nline')).toBe('tab\tnew\nline');
  });

  it('humanizes keys', () => {
    expect(humanizeKey('walkOnMusicName')).toBe('Walk on music name');
    expect(humanizeKey('createdAt')).toBe('Created at');
    expect(humanizeKey('id')).toBe('Id');
    expect(humanizeKey('some_key-here')).toBe('Some key here');
  });

  it('reads a mailto: link', () => {
    expect(parseMailto('mailto:a@x.com,b@y.com?cc=c@z.com&BCC=d%40w.com,e@v.com&subject=Hi%20there&body=Line%201%0ALine%202')).toEqual({
      to: ['a@x.com', 'b@y.com'],
      cc: ['c@z.com'],
      bcc: ['d@w.com', 'e@v.com'],
      subject: 'Hi there',
      body: 'Line 1\nLine 2',
    });
    expect(parseMailto('mailto:?bcc=a%40x.com%2Cb%40y.com&subject=S')).toMatchObject({ to: [], bcc: ['a@x.com', 'b@y.com'], subject: 'S' });
    expect(parseMailto('mailto:%E0%A4%A')).toBeNull();
    expect(parseMailto('https://x.com')).toBeNull();
  });
});

describe('requests', () => {
  function share(action: RequestPayload): ChangeGroup {
    return describePayload(action, ctx)[0];
  }

  it('describes every share and download from the reader’s own data', () => {
    const cases: [RequestPayload, string][] = [
      [{ kind: 'share', action: { type: 'copy-text', source: 'announce-post', showId: 'show1', text: 'Post!' } }, 'Copy the post for “Friday Laughs”'],
      [{ kind: 'share', action: { type: 'copy-text', source: 'announce-tags', showId: 'show1', text: '#x' } }, 'Copy the tags for “Friday Laughs”'],
      [{ kind: 'share', action: { type: 'copy-text', source: 'season-pitch', text: 'Pitch' } }, 'Copy the season pitch'],
      [{ kind: 'share', action: { type: 'email', source: 'lineup', showId: 'show1', href: 'mailto:?bcc=a%40x.com%2Cb%40y.com' } }, 'Open an email to 2 people'],
      [{ kind: 'share', action: { type: 'email', source: 'person', href: 'mailto:sam@example.com' } }, 'Open an email to Sam Lee'],
      [{ kind: 'share', action: { type: 'signing-link', contractId: 'ct1', signer: { name: 'Sammy', contactId: 'c1' } } }, 'Send “Performer Agreement” to Sammy to sign'],
      [{ kind: 'share', action: { type: 'existing-signing-link', requestIds: [FIXTURE_SECRETS.signToken.slice(0, 12)] } }, 'Pass on Sam Lee’s signing link for “Performer Agreement”'],
      [{ kind: 'share', action: { type: 'existing-signing-link', requestIds: [FIXTURE_SECRETS.signToken.slice(0, 12), 'gone'] } }, 'Pass on 2 signing links'],
      [{ kind: 'share', action: { type: 'profile-link', contactId: 'c1' } }, 'Ask Sam Lee for their details'],
      [{ kind: 'share', action: { type: 'existing-profile-link', requestId: FIXTURE_SECRETS.profileToken.slice(0, 12) } }, 'Pass on Sam Lee’s details link'],
      [{ kind: 'share', action: { type: 'viewer-link', showId: 'show1' } }, 'Share the viewer link for “Friday Laughs”'],
      [{ kind: 'download', action: { type: 'backup' } }, 'Download a backup of everything'],
      [{ kind: 'download', action: { type: 'headshot', subject: { kind: 'performer', showId: 'show1', personId: 'p1' } } }, 'Download Sam Lee’s headshot'],
      [{ kind: 'download', action: { type: 'headshot', subject: { kind: 'artist', showId: 'show1', personId: 'a1' } } }, 'Download Bea Painter’s headshot'],
      [{ kind: 'download', action: { type: 'headshot', subject: { kind: 'contact', contactId: 'c1' } } }, 'Download Sam Lee’s headshot'],
      [{ kind: 'download', action: { type: 'headshot-pack', showId: 'show1', includesGuests: true } }, 'Download the headshots for “Friday Laughs”, surprise guests included'],
      [{ kind: 'download', action: { type: 'flyer', showId: 'show1' } }, 'Download the flyer for “Friday Laughs”'],
      [{ kind: 'download', action: { type: 'signed-agreement', agreementId: 'ag1' } }, 'Download “Venue Agreement”'],
      [{ kind: 'download', action: { type: 'dj-list-text', showId: 'show1' } }, 'Download the DJ list for “Friday Laughs” as text'],
      [{ kind: 'download', action: { type: 'runsheet-pdf', showId: 'show1' } }, 'Print or save the run sheet for “Friday Laughs”'],
      [{ kind: 'download', action: { type: 'dj-list-pdf', showId: 'show1' } }, 'Print or save the DJ list for “Friday Laughs”'],
    ];
    for (const [payload, sentence] of cases) {
      const group = share(payload);
      expect(group.key).toBe(payload.kind);
      expect(group.title).toBe(payload.kind === 'share' ? 'Share' : 'Download');
      expect(group.changes).toEqual([{ key: (payload as Exclude<RequestPayload, EditPayload>).action.type, path: [], label: group.title, before: null, after: sentence, change: 'added' }]);
      expect(group.handOver?.what).toBeTruthy();
      expect(headline(buildOutline(payload), ctx), sentence).toMatch(/^[a-z]/);
    }
  });

  it('hands over the whole item', () => {
    expect(share({ kind: 'share', action: { type: 'copy-text', source: 'season-pitch', text: 'Every word\nof it' } }).handOver!.details).toEqual([{ label: 'Text', value: 'Every word\nof it' }]);
    expect(share({ kind: 'share', action: { type: 'email', source: 'lineup', showId: 'show1', href: 'mailto:a@x.com?cc=b@y.com&bcc=c@z.com&subject=Tonight&body=See%20you' } }).handOver!.details).toEqual([
      { label: 'To', value: '1: a@x.com' },
      { label: 'Cc', value: '1: b@y.com' },
      { label: 'Bcc', value: '1: c@z.com' },
      { label: 'Subject', value: 'Tonight' },
      { label: 'Body', value: 'See you' },
    ]);
    expect(share({ kind: 'share', action: { type: 'email', source: 'person', href: 'mailto:%E0%A4%A' } }).handOver!.details).toEqual([{ label: 'Link', value: 'mailto:%E0%A4%A' }]);
    expect(share({ kind: 'download', action: { type: 'flyer', showId: 'show1' } }).handOver!.media).toEqual({ kind: 'image', ref: fullShow().flyer });
    expect(share({ kind: 'share', action: { type: 'viewer-link', showId: 'show1' } }).handOver!.details).toEqual([
      { label: 'Link', value: 'Already made' },
      { label: 'Viewer page note', value: 'Doors at 7:30.' },
    ]);
    expect(share({ kind: 'share', action: { type: 'existing-signing-link', requestIds: [FIXTURE_SECRETS.signToken.slice(0, 12), 'gone'] } }).handOver!.details).toEqual([
      { label: 'Link', value: 'Sam Lee — Performer Agreement (signed)' },
      { label: 'Link', value: 'A link that’s no longer there' },
    ]);
  });

  it('marks what the signer typed, and says when it differs from the Rolodex', () => {
    const details = share({ kind: 'share', action: { type: 'signing-link', contractId: 'ct1', signer: { name: 'Mallory', email: 'm@x.com', contactId: 'c1' } } }).handOver!.details;
    expect(details).toEqual([
      { label: 'Contract', value: 'Performer Agreement' },
      { label: 'Signer', value: 'Mallory (as typed by them)' },
      { label: 'Email', value: 'm@x.com' },
      { label: 'Rolodex entry', value: 'Sam Lee (differs from the name typed)' },
    ]);
  });

  it('says when a target is gone, and never names it from the request', () => {
    const gone = share({ kind: 'download', action: { type: 'flyer', showId: 'nope' } });
    expect(gone.changes[0].after).toBe('Download the flyer for (not found)');
    expect(gone.handOver).toEqual({ what: 'Not in your account any more', details: [] });
    const text = JSON.stringify(describePayload({ kind: 'download', action: { type: 'headshot', subject: { kind: 'contact', contactId: 'nobody' } } }, ctx));
    expect(text).toContain('(not found)');
  });

  it('describes an edit against the reader’s data', () => {
    const payload: EditPayload = {
      kind: 'edit',
      shows: [{ target: 'show', op: 'update', showId: 'show1', baseRevision: 'r', keys: ['venueName'], base: { venueName: 'The Basement' }, proposed: { venueName: 'The Attic' } }],
      settings: {
        target: 'settings',
        baseRevision: null,
        fields: [{
          field: 'potentialComics',
          kind: 'rows',
          idField: 'id',
          baseOrder: ['c1'],
          proposedOrder: ['c1'],
          base: [['c1', state.settings.potentialComics[0]]],
          proposed: [['c1', { ...state.settings.potentialComics[0], notes: 'Closes strong.' }]],
        }],
      },
    };
    const groups = describePayload(payload, ctx);
    expect(groups.map((g) => g.key)).toEqual(['show:show1', 'settings:potentialComics']);
    expect(groups[0]).toMatchObject({ title: 'Friday Laughs', changes: [{ key: 'venueName', label: 'Venue name', before: 'The Basement', after: 'The Attic' }] });
    expect(groups[1].changes).toEqual([{ key: 'potentialComics/c1/notes', path: ['Rolodex', 'Sam Lee'], label: 'Notes', before: 'Opens strong.', after: 'Closes strong.', change: 'changed' }]);
  });

  it('describes a new show, a deleted one and a restored one', () => {
    const fresh = clone(fullShow({ id: 'new1', name: 'Brand New' })) as Partial<Show>;
    delete fresh.viewToken;
    delete fresh.viewerKey;
    const restoredShow = state.settings.trash[0].data;
    const payload: EditPayload = {
      kind: 'edit',
      shows: [
        { target: 'show', op: 'create', showId: 'new1', show: fresh as Show },
        { target: 'show', op: 'delete', showId: 'show1', baseRevision: null, base: fullShow() },
        { target: 'show', op: 'create', showId: restoredShow.id, show: { ...restoredShow, viewToken: 'redacted-abc' } },
      ],
      settings: {
        target: 'settings',
        baseRevision: null,
        fields: [{ field: 'trash', kind: 'rows', idField: 'id', baseOrder: ['tr1'], proposedOrder: [], base: [['tr1', state.settings.trash[0]]], proposed: [] }],
      },
    };
    const groups = describePayload(payload, ctx);
    expect(groups.map((g) => [g.key, g.note])).toEqual([
      ['show:new1', 'New show'],
      ['show:show1', 'Show deleted'],
      ['show:show-old', 'Restored'],
      ['settings:trash', undefined],
    ]);
    expect(groups[1].changes).toEqual([
      { key: 'show', path: [], label: 'Show', before: 'Friday Laughs', after: null, change: 'removed' },
      { key: 'viewToken', path: [], label: 'Viewer link', before: 'On', after: 'Withdrawn', change: 'removed' },
    ]);
    expect(groups[3].changes[0].label).toBe('Restored');
    expect(JSON.stringify(groups)).not.toContain(FIXTURE_SECRETS.viewToken);
  });
});

describe('headlines', () => {
  const edit = (outline: Partial<ReturnType<typeof buildOutline>>) => headline({ kind: 'edit', ...outline }, ctx);

  it('reads naturally after "You asked to"', () => {
    expect(edit({ shows: [{ id: 'n', op: 'create', createName: 'Brand New' }] })).toBe('add the show “Brand New”');
    expect(edit({ shows: [{ id: 'show1', op: 'delete' }] })).toBe('delete “Friday Laughs”');
    expect(edit({ shows: [{ id: 'show1', op: 'update' }] })).toBe('change “Friday Laughs”');
    expect(edit({ shows: [{ id: 'show1', op: 'update' }], settingsFields: ['potentialComics'] })).toBe('change “Friday Laughs”');
    expect(edit({ shows: [{ id: 'gone', op: 'update' }] })).toBe('change a show');
    expect(edit({ settingsFields: ['potentialComics'] })).toBe('change rolodex');
    expect(headline({ kind: 'edit', settingsFields: ['potentialComics'] }, { ...ctx, rolodexPlural: 'Queens' })).toBe('change queens');
    expect(edit({ settingsFields: ['contracts'] })).toBe('change contracts');
    expect(edit({ settingsFields: ['brandName', 'rules'] })).toBe('change settings');
    expect(edit({ shows: [{ id: 'show1', op: 'update' }, { id: 'x', op: 'delete' }], settingsFields: ['contracts', 'brandName'] })).toBe('make 4 changes');
    expect(edit({ shows: [{ id: 'n', op: 'create', createName: 'X' }], settingsFields: ['trash'] })).toBe('make 2 changes');
  });

  it('names shares and downloads without the request’s free text', () => {
    expect(headline(buildOutline({ kind: 'download', action: { type: 'flyer', showId: 'show1' } }), ctx)).toBe('download the flyer for “Friday Laughs”');
    expect(headline(buildOutline({ kind: 'share', action: { type: 'copy-text', source: 'announce-tags', showId: 'show1', text: 'IGNORE ME' } }), ctx)).toBe('copy the tags for “Friday Laughs”');
    const signing = headline(buildOutline({ kind: 'share', action: { type: 'signing-link', contractId: 'ct1', signer: { name: 'Typed Name', contactId: 'c1' } } }), ctx);
    expect(signing).toBe('send “Performer Agreement” to Sam Lee to sign');
    const email = headline(buildOutline({ kind: 'share', action: { type: 'email', source: 'lineup', showId: 'show1', href: 'mailto:secret@x.com' } }), ctx);
    expect(email).toBe('open an email to the lineup of “Friday Laughs”');
    expect(headline(buildOutline({ kind: 'download', action: { type: 'headshot-pack', showId: 'show1', includesGuests: true } }), ctx)).toBe('download the headshots for “Friday Laughs”, surprise guests included');
  });
});

describe('conflicts', () => {
  it('puts a conflict in the same words as the diff', () => {
    expect(describeConflict({ groupKey: 'show:show1', path: 'venueName', base: 'A', current: 'B', proposed: 'C' }, ctx)).toEqual({
      groupKey: 'show:show1', key: 'venueName', path: [], label: 'Venue name', asked: 'A', now: 'B', proposed: 'C',
    });
    expect(describeConflict({ groupKey: 'show:show1', path: 'performers/p1/email', base: 'a@x', current: 'b@x', proposed: 'c@x' }, ctx)).toMatchObject({
      path: ['Performers', 'Sam Lee'], label: 'Email', asked: 'a@x', now: 'b@x', proposed: 'c@x',
    });
    expect(describeConflict({ groupKey: 'show:show1', path: 'recap/ticketSales', base: 1, current: 2, proposed: 3 }, ctx)).toMatchObject({ path: ['Recap'], label: 'Ticket sales' });
    expect(describeConflict({ groupKey: 'show:show1', path: 'completions/basic', base: false, current: undefined, proposed: true }, ctx)).toMatchObject({ label: 'Basic Info', asked: 'No', now: 'No', proposed: 'Yes' });
    expect(describeConflict({ groupKey: 'show:show1', path: 'performers#order', base: ['p1', 'p2'], current: ['p2', 'p1'], proposed: ['p1'] }, ctx)).toMatchObject({
      path: ['Performers'], label: 'Order', asked: 'Sam Lee, p2',
    });
    expect(describeConflict({ groupKey: 'show:show1', path: 'performers/p1/photo', base: 'media:a#1', current: 'media:b#1', proposed: undefined }, ctx)).toMatchObject({
      label: 'Headshot', asked: 'Photo on file', now: 'Photo on file', proposed: null,
    });
    const row = describeConflict({ groupKey: 'show:show1', path: 'performers/p1', base: fullPerformer(), current: fullPerformer({ email: 'x@y' }), proposed: undefined }, ctx);
    expect(row).toMatchObject({ path: ['Performers'], label: 'Sam Lee', proposed: null });
    expect(row.now).toContain('Email: x@y');
    expect(describeConflict({ groupKey: 'settings:potentialComics', path: 'potentialComics/c1/notes', base: 'a', current: 'b', proposed: 'c' }, ctx)).toMatchObject({
      path: ['Rolodex', 'Sam Lee'], label: 'Notes',
    });
    expect(describeConflict({ groupKey: 'settings:workspace', path: 'brandBudget', base: 1, current: 2, proposed: 3000 }, ctx)).toMatchObject({
      label: 'Brand budget', proposed: (3000).toLocaleString(undefined, { maximumFractionDigits: 2 }),
    });
    expect(describeConflict({ groupKey: 'settings:emailList', path: 'emailList/fan%40example.com', base: undefined, current: undefined, proposed: { id: 'e', email: 'fan@example.com', addedAt: 'x' } }, ctx)).toMatchObject({
      path: ['Email list'], label: 'fan@example.com',
    });
  });
});

describe('a settings fixture with every field', () => {
  it('describes going from nothing to everything without naming a secret', () => {
    const empty = {} as Partial<AppSettings>;
    for (const complete of [false, true]) {
      const groups = diffSettings(empty, fullSettings(), { complete, state });
      expect(groups.length).toBeGreaterThan(5);
      const text = allText(groups);
      for (const secret of Object.values(FIXTURE_SECRETS)) expect(text).not.toContain(secret);
    }
  });
});

describe('the hosts', () => {
  const hosted = fullShow({ coHost: undefined, coHostSocial: undefined, coHostComicId: undefined });

  it('names a second host and each host’s social in words', () => {
    const after = fullShow({ ...hosted, hostSocial: '@cal.hosts', coHost: 'Dee', coHostSocial: '@deehosts', coHostComicId: 'c4' });
    expect(changesOf(diffShow(hosted, after))).toEqual([
      { key: 'hostSocial', path: [], label: 'Host’s social', before: '@calhosts', after: '@cal.hosts', change: 'changed' },
      { key: 'coHost', path: [], label: 'Second host', before: null, after: 'Dee', change: 'added' },
      { key: 'coHostSocial', path: [], label: 'Second host’s social', before: null, after: '@deehosts', change: 'added' },
    ]);
  });

  it('says a host was changed or removed, and never shows the Rolodex link that went with them', () => {
    const before = fullShow();
    const after = fullShow({ host: 'Bo', hostSocial: undefined, hostComicId: undefined, coHost: undefined, coHostSocial: undefined, coHostComicId: undefined });
    const changes = changesOf(diffShow(before, after));
    expect(changes.map((c) => [c.label, c.change, c.before, c.after])).toEqual([
      ['Host', 'changed', 'Cal', 'Bo'],
      ['Host’s social', 'removed', '@calhosts', null],
      ['Second host', 'removed', 'Dee', null],
      ['Second host’s social', 'removed', '@deehosts', null],
    ]);
    expect(changes.map((c) => c.key)).not.toContain('hostComicId');
    expect(changes.map((c) => c.key)).not.toContain('coHostComicId');
  });

  it('lists a new show’s hosts and socials under their own labels', () => {
    const labels = changesOf(diffShow(null, fullShow())).map((c) => c.label);
    for (const label of ['Host', 'Host’s social', 'Second host', 'Second host’s social']) expect(labels, label).toContain(label);
    for (const bookkeeping of ['Host comic id', 'Co host comic id', 'Co host', 'Co host social', 'Host social']) {
      expect(labels, bookkeeping).not.toContain(bookkeeping);
    }
  });
});
