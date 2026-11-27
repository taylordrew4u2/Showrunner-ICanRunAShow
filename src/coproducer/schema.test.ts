import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type AppSettings, type Show } from '../types';
import { buildSampleShow } from '../utils/sampleShow';
import {
  ALLOWED_MEDIA_TYPES,
  changedMediaIds,
  EDITABLE_SETTINGS_FIELDS,
  sanitizeSettings,
  sanitizeShow,
  sniffMediaType,
  validatePayload,
} from './schema';
import { knownPeople } from './newComics';
import { clone, fullSettings, fullShow } from './testFixtures';
import {
  REMOVE_ONLY_ROW_FIELDS,
  SETTINGS_DERIVED_FIELDS,
  SETTINGS_ROW_FIELDS,
  type EditPayload,
  type RequestPayload,
  type SettingsFieldEdit,
  type SettingsKey,
  type ShowEdit,
} from './types';

const APP = 'https://icanrunashow.com';
const REVIEW = 'https://showrunner-theta.vercel.app';
const ctx = { appOrigins: [APP, REVIEW] };

const SVG = '<svg onload=alert(1)>';
const SCRIPT = '<script src=https://cdn.jsdelivr.net/npm/x@1/x.js></script>';

function ok(payload: unknown): boolean {
  return validatePayload(payload, ctx).payload !== null;
}
function problems(payload: unknown): string[] {
  return validatePayload(payload, ctx).problems.map((p) => `${p.path}: ${p.problem}`);
}

/** A show as a co-producer would propose creating it: no viewer link of its own. */
function newShow(over: Partial<Show> = {}): Show {
  const show: Partial<Show> = clone(fullShow(over));
  delete show.viewToken;
  delete show.viewerKey;
  return show as Show;
}
function create(show: Show): EditPayload {
  return { kind: 'edit', shows: [{ target: 'show', op: 'create', showId: show.id, show }], settings: null };
}
function update(base: Partial<Show>, proposed: Partial<Show>, keys = [...new Set([...Object.keys(base), ...Object.keys(proposed)])]): EditPayload {
  return {
    kind: 'edit',
    shows: [{ target: 'show', op: 'update', showId: 'show1', baseRevision: 'rev', keys, base, proposed } as ShowEdit],
    settings: null,
  };
}
function settingsEdit(...fields: SettingsFieldEdit[]): EditPayload {
  return { kind: 'edit', shows: [], settings: { target: 'settings', baseRevision: null, fields } };
}
/** A rows edit taking a list from `before` to `after`, encoded as the capture does. */
function rowsEdit(field: SettingsKey, before: Record<string, unknown>[], after: Record<string, unknown>[]): SettingsFieldEdit {
  const idField = SETTINGS_ROW_FIELDS.get(field)!;
  const id = (row: Record<string, unknown>) => row[idField] as string;
  const beforeById = new Map(before.map((row) => [id(row), row]));
  const afterById = new Map(after.map((row) => [id(row), row]));
  return {
    field,
    kind: 'rows',
    idField,
    baseOrder: before.map(id),
    proposedOrder: after.map(id),
    base: before.filter((row) => JSON.stringify(row) !== JSON.stringify(afterById.get(id(row)))).map((row) => [id(row), row]),
    proposed: after.filter((row) => JSON.stringify(row) !== JSON.stringify(beforeById.get(id(row)))).map((row) => [id(row), row]),
  };
}

type Path = (string | number)[];
/** Every leaf of a value, with where it is. */
function* leaves(value: unknown, path: Path = []): Generator<[Path, unknown]> {
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) yield* leaves(child, [...path, Array.isArray(value) ? Number(key) : key]);
  } else {
    yield [path, value];
  }
}
function setAt<T>(value: T, path: Path, leaf: unknown): T {
  const copy = clone(value) as Record<string | number, unknown>;
  let at = copy;
  for (const key of path.slice(0, -1)) at = at[key] as Record<string | number, unknown>;
  at[path[path.length - 1]] = leaf;
  return copy as T;
}

/** String leaves whose text has a format of its own: ids, files, links, times, enums, the secrets. */
const FORMATTED = new Set([
  'id', 'showId', 'comicId', 'performerId', 'libraryId', 'contactId', 'contractId',
  'photo', 'flyer', 'walkOnMusic', 'music', 'fileRef', 'headshot',
  'ticketLink', 'videoLink', 'walkOnMusicLink', 'website',
  'createdAt', 'updatedAt', 'addedAt', 'uploadedAt', 'sentAt', 'signedAt', 'submittedAt', 'deletedAt',
  'status', 'type', 'hiddenSections', 'djHiddenLibraryIds', 'target', 'op', 'kind', 'field', 'idField',
  'baseRevision', 'token', 'key', 'category',
]);
function formatted(path: Path): boolean {
  // In a rows edit, [id, row] pairs: the id is at proposed[i][0].
  const at = path.indexOf('proposed');
  const pairId = at >= 0 && path.length === at + 3 && path[at + 2] === 0 && typeof path[at + 1] === 'number';
  return pairId || path.some((part) => typeof part === 'string' && FORMATTED.has(part)) || path.includes('baseOrder') || path.includes('proposedOrder');
}

/** A settings edit setting every field a request may change to the fixture's value, from nothing. */
function everySettingsField(settings: AppSettings): EditPayload {
  const fields: SettingsFieldEdit[] = [];
  for (const field of EDITABLE_SETTINGS_FIELDS) {
    if (REMOVE_ONLY_ROW_FIELDS.has(field)) continue;
    const value = (settings as unknown as Record<string, unknown>)[field];
    if (value === undefined) continue;
    // Everyone in the Rolodex is already there, each field changed: a co-producer
    // may not add someone with a whole profile (see "someone new" below).
    if (field === 'potentialComics') fields.push(rowsEdit(field, (value as { id: string }[]).map((row) => ({ id: row.id, name: 'Was' })), value as Record<string, unknown>[]));
    else if (SETTINGS_ROW_FIELDS.has(field)) fields.push(rowsEdit(field, [], value as Record<string, unknown>[]));
    else fields.push({ field, kind: 'value', proposed: value });
  }
  return settingsEdit(...fields);
}

describe('real data passes', () => {
  const shows: [string, Show][] = [
    ['a full show', fullShow()],
    ['the sample show', { ...buildSampleShow(new Date('2026-07-01T12:00:00Z')), id: 'sample', createdAt: 'now', updatedAt: 'now' }],
    ['a bare show', { id: 'b', name: 'B', date: '', time: '', location: '', venueName: '', status: 'upcoming', performers: [], artists: [], schedule: [], hosts: [], djSongs: [], staff: [], expenses: [], createdAt: 'x', updatedAt: 'x' }],
  ];

  for (const [what, show] of shows) {
    it(`serves ${what} as it is`, () => {
      expect(sanitizeShow(show)).toEqual(clone(show));
    });

    it(`accepts ${what} proposed new, deleted, and changed key by key`, () => {
      const fresh = { ...clone(show) } as Partial<Show>;
      delete fresh.viewToken;
      delete fresh.viewerKey;
      expect(problems(create(fresh as Show))).toEqual([]);
      expect(problems({ kind: 'edit', shows: [{ target: 'show', op: 'delete', showId: show.id, baseRevision: null, base: show }], settings: null })).toEqual([]);
      for (const key of Object.keys(fresh)) {
        if (['id', 'createdAt', 'updatedAt'].includes(key)) continue;
        const value = (fresh as Record<string, unknown>)[key];
        if (value === undefined) continue;
        expect(problems(update({}, { [key]: value }, [key]))).toEqual([]);
      }
    });
  }

  const settingsCases: [string, AppSettings][] = [
    ['full settings', fullSettings()],
    ['the defaults', { ...DEFAULT_SETTINGS }],
  ];
  for (const [what, settings] of settingsCases) {
    it(`serves ${what} as they are`, () => {
      expect(sanitizeSettings(settings)).toEqual(clone(settings));
    });

    it(`accepts ${what} proposed field by field`, () => {
      expect(problems(everySettingsField(settings))).toEqual([]);
    });
  }

  it('accepts every remove-only row being removed', () => {
    const settings = fullSettings();
    for (const field of REMOVE_ONLY_ROW_FIELDS) {
      const rows = (settings as unknown as Record<string, Record<string, unknown>[]>)[field];
      expect(problems(settingsEdit(rowsEdit(field, rows, [])))).toEqual([]);
    }
  });
});

describe('types are checked everywhere', () => {
  const show = newShow();

  it('refuses markup in every number, yes/no and enum leaf of a show', () => {
    let checked = 0;
    for (const [path, value] of leaves(show)) {
      const isEnum = path.includes('status') || path.includes('hiddenSections');
      if (typeof value === 'string' && !isEnum) continue;
      for (const markup of [SVG, SCRIPT]) {
        expect(ok(create(setAt(show, path, markup))), path.join('.')).toBe(false);
      }
      checked += 1;
    }
    expect(checked).toBeGreaterThan(30);
  });

  it('accepts markup in every free-text leaf of a show: escaping is the renderer’s job', () => {
    let checked = 0;
    for (const [path, value] of leaves(show)) {
      if (typeof value !== 'string' || formatted(path)) continue;
      for (const markup of [SVG, SCRIPT]) {
        expect(problems(create(setAt(show, path, markup))), path.join('.')).toEqual([]);
      }
      checked += 1;
    }
    expect(checked).toBeGreaterThan(40);
  });

  it('does the same in settings', () => {
    const payload = everySettingsField(fullSettings());
    let refused = 0;
    let accepted = 0;
    for (const [path, value] of leaves(payload)) {
      if (!path.includes('proposed')) continue;
      const isEnum = path.includes('category') && path.includes('signedAgreements' as never);
      const edit = payload.settings!.fields[path[2] as number];
      // A row's id field must match the id its pair carries.
      const isRowKey = edit.kind === 'rows' && path[path.length - 1] === edit.idField;
      if (typeof value === 'number' || typeof value === 'boolean') {
        expect(ok(setAt(payload, path, SVG)), path.join('.')).toBe(false);
        refused += 1;
      } else if (typeof value === 'string' && !formatted(path) && !isEnum && !isRowKey) {
        expect(problems(setAt(payload, path, SVG)), path.join('.')).toEqual([]);
        accepted += 1;
      }
    }
    expect(refused).toBeGreaterThan(10);
    expect(accepted).toBeGreaterThan(20);
  });

  it('refuses an agreement type it does not know', () => {
    const agreement = { ...fullSettings().signedAgreements[0], category: 'other' };
    expect(ok(settingsEdit(rowsEdit('signedAgreements', [], [agreement])))).toBe(false);
  });

  it('refuses unknown keys, and drop mode removes them', () => {
    const extra = { ...show, mystery: 1, performers: [{ ...show.performers[0], mystery: 'x' }], recap: { ...show.recap, mystery: true } };
    expect(problems(create(extra as Show))).toEqual([
      'shows[0].show.mystery: unknown key',
      'shows[0].show.performers[0].mystery: unknown key',
      'shows[0].show.recap.mystery: unknown key',
    ]);
    expect(sanitizeShow(extra)).toEqual(show);
  });

  it('reads null as absent for optional values', () => {
    const nulls = { ...show, performerTarget: null, ticketLink: null, sample: null, recap: { attendance: null } };
    expect(problems(create(nulls as unknown as Show))).toEqual([]);
    expect(sanitizeShow(nulls)).toEqual({ ...show, performerTarget: undefined, ticketLink: undefined, sample: undefined, recap: {} });
  });

  it('refuses a required value that is missing or null', () => {
    const missing = clone(show) as Partial<Show>;
    delete missing.name;
    expect(problems(create(missing as Show))).toContain('shows[0].show.name: missing');
    expect(ok(update({ name: 'A' }, {}, ['name']))).toBe(false);
    expect(ok(update({ performers: [] }, { performers: null } as unknown as Partial<Show>, ['performers']))).toBe(false);
  });

  it('drops leaves of the wrong type from a served show, defaulting required ones', () => {
    const odd = {
      ...fullShow(),
      name: 42,
      status: 'partying',
      performers: [{ id: 'p1', name: 'Sam', walkOnStartSec: 'soon' }, 'not a row'],
      recap: { attendance: SVG, ticketSales: 10 },
      scenes: [{ id: 's', title: 'T', description: '', duration: 3, status: 'nope', order: 1 }],
      hiddenSections: ['basic', 'mystery'],
    };
    const served = sanitizeShow(odd)!;
    expect(served.name).toBe('Untitled show');
    expect(served.status).toBe('upcoming');
    expect(served.performers).toEqual([{ id: 'p1', name: 'Sam' }]);
    expect(served.recap).toEqual({ ticketSales: 10 });
    expect(served.scenes![0].status).toBe('planned');
    expect(served.hiddenSections).toEqual(['basic']);
    expect(JSON.stringify(served)).not.toContain('<svg');
  });

  it('keeps long text and big lists whole when serving', () => {
    const long = 'x'.repeat(200_000);
    const many = Array.from({ length: 3000 }, (_, i) => ({ id: `t${i}`, text: long.slice(0, 10), completed: false }));
    const served = sanitizeShow({ ...fullShow(), productionNotes: long, todos: many })!;
    expect(served.productionNotes).toHaveLength(200_000);
    expect(served.todos).toHaveLength(3000);
    // The same in a request is over its caps.
    expect(problems(update({}, { productionNotes: long }, ['productionNotes']))).toEqual(['shows[0].proposed.productionNotes: longer than 50,000 characters']);
    expect(problems(update({}, { todos: many }, ['todos']))).toEqual(['shows[0].proposed.todos: more than 1000 items']);
  });

  it('serves nothing for a show with no id, and leaves the original alone', () => {
    expect(sanitizeShow({ name: 'No id' })).toBeNull();
    expect(sanitizeShow('nope')).toBeNull();
    const original = { ...fullShow(), mystery: 1 };
    sanitizeShow(original);
    expect(original.mystery).toBe(1);
  });

  it('heals settings as the app does', () => {
    const settings = sanitizeSettings({ brandName: 'X', producerNames: 'Ada, Bo', trash: 'nope' })!;
    expect(settings.producers).toEqual([]);
    expect(settings.trash).toEqual([]);
    expect(settings.onboarded).toBe(true);
    expect(settings).not.toHaveProperty('producerNames');
    expect(sanitizeSettings([])).toBeNull();
  });
});

describe('changed values keep their rules', () => {
  const show = newShow();

  it('takes files as uploaded references, never newly embedded', () => {
    expect(ok(update({}, { flyer: 'media:12345678-abcd#3' }, ['flyer']))).toBe(true);
    expect(ok(update({}, { flyer: 'media:short#1' }, ['flyer']))).toBe(false);
    expect(ok(update({}, { flyer: 'media:12345678-abcd#65' }, ['flyer']))).toBe(false);
    expect(ok(update({}, { flyer: 'data:image/png;base64,AAAA' }, ['flyer']))).toBe(false);
    expect(ok(update({}, { flyer: 'data:text/html,<script>alert(1)</script>' }, ['flyer']))).toBe(false);
    expect(ok(update({}, { flyer: 'javascript:alert(1)' }, ['flyer']))).toBe(false);
    // A legacy embedded file is fine while it stays as it was.
    const legacy = 'data:image/png;base64,AAAA';
    const performers = [{ ...show.performers[0], photo: legacy }];
    expect(ok(update({ performers }, { performers: [{ ...performers[0], name: 'Renamed' }] }))).toBe(true);
    expect(ok(update({ performers: show.performers }, { performers }))).toBe(false);
    expect(ok(create({ ...show, flyer: legacy }))).toBe(false);
  });

  it('takes web links that do not point back into the app’s sign-in or API', () => {
    const link = (ticketLink: string) => ok(update({}, { ticketLink }, ['ticketLink']));
    expect(link('https://tickets.example.com/x')).toBe(true);
    expect(link('')).toBe(true);
    expect(link('javascript:alert(1)')).toBe(false);
    expect(link('http://user:pw@example.com')).toBe(false);
    expect(link('data:text/html,hi')).toBe(false);
    expect(link('not a link')).toBe(false);
    for (const origin of [APP, REVIEW]) {
      expect(link(`${origin}/chatgpt/authorize?client_id=x`)).toBe(false);
      expect(link(`${origin}/api/shows`)).toBe(false);
      expect(link(`${origin}/coproduce`)).toBe(false);
      expect(link(`${origin}/`)).toBe(false);
      expect(link(`${origin}/live?t=abc`)).toBe(true);
      expect(link(`${origin}/sign?t=abc`)).toBe(true);
      expect(link(`${origin}/guides/running-a-show`)).toBe(true);
    }
  });

  it('keeps numbers in range', () => {
    expect(ok(update({}, { performerTarget: 1001 }, ['performerTarget']))).toBe(false);
    expect(ok(update({}, { performerTarget: 2.5 }, ['performerTarget']))).toBe(false);
    expect(ok(update({}, { recap: { attendance: -1 } }, ['recap']))).toBe(false);
    expect(ok(update({}, { recap: { ticketSales: 2e9 } }, ['recap']))).toBe(false);
    expect(ok(update({}, { recap: { ticketSales: -20.5 } }, ['recap']))).toBe(true);
  });

  it('refuses repeated row ids and odd ids', () => {
    const p = show.performers[0];
    expect(ok(update({}, { performers: [p, p] }, ['performers']))).toBe(false);
    expect(ok(update({}, { performers: [{ ...p, id: '' }] }, ['performers']))).toBe(false);
    expect(ok(update({}, { performers: [{ ...p, id: 'a\u200Bb' }] }, ['performers']))).toBe(false);
    expect(ok(update({}, { performers: [{ ...p, id: '__proto__' }] }, ['performers']))).toBe(false);
    expect(ok(create({ ...show, id: 'has space' }))).toBe(false);
  });
});

describe('what a request may touch', () => {
  it('refuses the keys the owner’s app keeps', () => {
    for (const key of ['viewToken', 'viewerKey', 'id', 'createdAt', 'updatedAt']) {
      expect(ok(update({}, { [key]: 'x' }, [key as never])), key).toBe(false);
    }
  });

  it('refuses a key outside the ones it names, and naming none', () => {
    expect(ok(update({ name: 'A' }, { name: 'B', venueName: 'C' }, ['name']))).toBe(false);
    expect(ok(update({}, {}, []))).toBe(false);
  });

  it('only lets a new show carry a viewer link when it is a restored one', () => {
    const show = newShow();
    expect(ok(create({ ...show, viewToken: 'redacted-0123' }))).toBe(true);
    expect(ok(create({ ...show, viewToken: 'real-token' }))).toBe(false);
    expect(ok(create({ ...show, viewerKey: 'k' }))).toBe(false);
  });

  it('refuses a new show whose id is not the one it is filed under', () => {
    const show = newShow();
    expect(ok({ kind: 'edit', shows: [{ target: 'show', op: 'create', showId: 'show1', show: { ...show, id: 'other' } }], settings: null })).toBe(false);
  });

  it('refuses the derived settings fields', () => {
    for (const field of SETTINGS_DERIVED_FIELDS) {
      expect(ok(settingsEdit({ field, kind: 'value', base: [], proposed: ['x'] }))).toBe(false);
    }
    expect(ok(settingsEdit({ field: 'mystery' as SettingsKey, kind: 'value', proposed: 1 }))).toBe(false);
  });

  it('only removes rows from trash and links', () => {
    const settings = fullSettings();
    const trash = settings.trash[0] as unknown as Record<string, unknown>;
    const sig = settings.signatureRequests[0] as unknown as Record<string, unknown>;
    const prof = settings.profileRequests[0] as unknown as Record<string, unknown>;
    expect(ok(settingsEdit(rowsEdit('trash', [], [trash])))).toBe(false);
    expect(ok(settingsEdit(rowsEdit('trash', [trash], [{ ...trash, deletedAt: 'later' }])))).toBe(false);
    expect(ok(settingsEdit(rowsEdit('signatureRequests', [sig], [{ ...sig, signerName: 'Someone else' }])))).toBe(false);
    expect(ok(settingsEdit(rowsEdit('profileRequests', [], [prof])))).toBe(false);
    expect(ok(settingsEdit(rowsEdit('signatureRequests', [sig], [])))).toBe(true);
    // Reordering what is left is a change too.
    const two = [trash, { ...trash, id: 'tr2' }];
    const reordered = { ...rowsEdit('trash', two, []), proposedOrder: ['tr2', 'tr1'] };
    expect(ok(settingsEdit(reordered))).toBe(false);
  });

  it('keeps the rows encoding honest', () => {
    // Someone new: only what a co-producer may send about them.
    const { id, name, socialMedia, videoLink, tapeMinutes } = fullSettings().potentialComics[0];
    const comic: Record<string, unknown> = { id, name, socialMedia, videoLink, tapeMinutes };
    const good = rowsEdit('potentialComics', [], [comic]);
    expect(ok(settingsEdit(good))).toBe(true);
    expect(ok(settingsEdit({ ...good, idField: 'name' } as SettingsFieldEdit))).toBe(false);
    expect(ok(settingsEdit({ ...good, kind: 'value' } as SettingsFieldEdit))).toBe(false);
    expect(ok(settingsEdit({ field: 'brandName', kind: 'rows', idField: 'id', baseOrder: [], proposedOrder: [], base: [], proposed: [] }))).toBe(false);
    expect(ok(settingsEdit({ ...good, proposed: [['other', comic]] } as SettingsFieldEdit))).toBe(false);
    expect(ok(settingsEdit({ ...good, proposedOrder: [] } as SettingsFieldEdit))).toBe(false);
    expect(ok(settingsEdit({ ...good, proposedOrder: ['c1', 'c1'] } as SettingsFieldEdit))).toBe(false);
    expect(ok(settingsEdit(good, good))).toBe(false);
  });

  // The owner's own note on an entry filed from the sample show (PotentialComic.fromSample).
  it('keeps the sample mark from a co-producer: never served, never asked for', () => {
    const comic = fullSettings().potentialComics[0];
    const marked = { ...comic, fromSample: true as const };
    const served = sanitizeSettings(fullSettings({ potentialComics: [marked] }));
    expect(served?.potentialComics).toEqual([comic]);
    expect(served?.potentialComics[0]).not.toHaveProperty('fromSample');
    const row = comic as unknown as Record<string, unknown>;
    expect(ok(settingsEdit(rowsEdit('potentialComics', [row], [{ ...row, fromSample: true }])))).toBe(false);
    expect(ok(settingsEdit(rowsEdit('potentialComics', [], [{ ...row, fromSample: true }])))).toBe(false);
  });

  it('refuses an edit that changes nothing, or too much', () => {
    expect(ok({ kind: 'edit', shows: [], settings: null })).toBe(false);
    expect(ok(settingsEdit())).toBe(false);
    const many = Array.from({ length: 101 }, (_, i) => newShow({ id: `s${i}` }));
    expect(ok({ kind: 'edit', shows: many.map((show) => create(show).shows[0]), settings: null })).toBe(false);
    const twice = create(newShow());
    expect(ok({ ...twice, shows: [twice.shows[0], twice.shows[0]] })).toBe(false);
  });

  it('refuses extra top-level keys, such as a summary', () => {
    expect(ok({ ...create(newShow()), summary: 'Trust me' })).toBe(false);
    expect(ok({ kind: 'share', action: { type: 'viewer-link', showId: 's1' }, label: 'x' })).toBe(false);
    expect(ok({ kind: 'nope' })).toBe(false);
    expect(ok(null)).toBe(false);
  });
});

describe('shares and downloads', () => {
  const valid: RequestPayload[] = [
    { kind: 'share', action: { type: 'copy-text', source: 'announce-post', showId: 's1', text: 'Come along!\nTickets <here>' } },
    { kind: 'share', action: { type: 'copy-text', source: 'season-pitch', text: '' } },
    { kind: 'share', action: { type: 'email', source: 'lineup', showId: 's1', href: 'mailto:a@x.com?subject=Hi' } },
    { kind: 'share', action: { type: 'signing-link', contractId: 'ct1', signer: { name: 'Sam', email: 'sam@x.com', contactId: 'c1' } } },
    { kind: 'share', action: { type: 'signing-link', contractId: 'ct1', signer: { name: 'Sam' } } },
    { kind: 'share', action: { type: 'existing-signing-link', requestIds: ['a', 'b'] } },
    { kind: 'share', action: { type: 'profile-link', contactId: 'c1' } },
    { kind: 'share', action: { type: 'existing-profile-link', requestId: 'r1' } },
    { kind: 'share', action: { type: 'viewer-link', showId: 's1' } },
    { kind: 'download', action: { type: 'backup' } },
    { kind: 'download', action: { type: 'headshot', subject: { kind: 'performer', showId: 's1', personId: 'p1' } } },
    { kind: 'download', action: { type: 'headshot', subject: { kind: 'contact', contactId: 'c1' } } },
    { kind: 'download', action: { type: 'headshot-pack', showId: 's1', includesGuests: true } },
    { kind: 'download', action: { type: 'flyer', showId: 's1' } },
    { kind: 'download', action: { type: 'signed-agreement', agreementId: 'ag1' } },
    { kind: 'download', action: { type: 'dj-list-text', showId: 's1' } },
    { kind: 'download', action: { type: 'runsheet-pdf', showId: 's1' } },
    { kind: 'download', action: { type: 'dj-list-pdf', showId: 's1' } },
  ];

  it('accepts each kind of action', () => {
    for (const payload of valid) expect(problems(payload), JSON.stringify(payload)).toEqual([]);
  });

  it('refuses an action of the other kind, extra keys and missing ones', () => {
    expect(ok({ kind: 'download', action: { type: 'viewer-link', showId: 's1' } })).toBe(false);
    expect(ok({ kind: 'share', action: { type: 'backup' } })).toBe(false);
    expect(ok({ kind: 'download', action: { type: 'backup', extra: 1 } })).toBe(false);
    expect(ok({ kind: 'download', action: { type: 'flyer' } })).toBe(false);
    expect(ok({ kind: 'share', action: { type: 'signing-link', contractId: 'ct1', signer: { name: 'Sam', photo: 'x' } } })).toBe(false);
    expect(ok({ kind: 'download', action: { type: 'headshot', subject: { kind: 'contact', contactId: 'c1', photo: 'data:' } } })).toBe(false);
  });

  it('refuses direction and control characters in an action’s text', () => {
    expect(ok({ kind: 'share', action: { type: 'copy-text', source: 'announce-post', text: 'gnp.\u202Eexe' } })).toBe(false);
    expect(ok({ kind: 'share', action: { type: 'signing-link', contractId: 'ct1', signer: { name: 'Sam\u2066' } } })).toBe(false);
    expect(ok({ kind: 'share', action: { type: 'email', source: 'person', href: 'mailto:a@x.com\u0007' } })).toBe(false);
    expect(ok({ kind: 'share', action: { type: 'copy-text', source: 'announce-post', text: 'tab\there\r\nok' } })).toBe(true);
  });

  it('keeps an action’s text within its caps', () => {
    expect(ok({ kind: 'share', action: { type: 'email', source: 'person', href: 'https://x.example' } })).toBe(false);
    expect(ok({ kind: 'share', action: { type: 'email', source: 'person', href: `mailto:${'a'.repeat(20_000)}` } })).toBe(false);
    expect(ok({ kind: 'share', action: { type: 'signing-link', contractId: 'ct1', signer: { name: '' } } })).toBe(false);
    expect(ok({ kind: 'share', action: { type: 'existing-signing-link', requestIds: [] } })).toBe(false);
    expect(ok({ kind: 'share', action: { type: 'existing-signing-link', requestIds: Array.from({ length: 51 }, (_, i) => `r${i}`) } })).toBe(false);
    expect(ok({ kind: 'share', action: { type: 'existing-signing-link', requestIds: ['a', 'a'] } })).toBe(false);
    expect(ok({ kind: 'share', action: { type: 'copy-text', source: 'elsewhere', text: '' } })).toBe(false);
  });
});

describe('files in a request', () => {
  it('lists the files a request changes, and only those', () => {
    const show = newShow();
    const kept = show.performers[0].photo!;
    const created = create({ ...show, flyer: 'media:aaaaaaaa-0000-0000-0000-000000000001#2' });
    expect(changedMediaIds(created)).toContain('aaaaaaaa-0000-0000-0000-000000000001');
    expect(changedMediaIds(created)).toContain(kept.slice(6, kept.indexOf('#')));

    const performers = show.performers;
    const renamed = update({ performers }, { performers: [{ ...performers[0], name: 'New name' }] });
    expect(changedMediaIds(renamed)).toEqual([]);
    const rephotoed = update({ performers }, { performers: [{ ...performers[0], photo: 'media:bbbbbbbb-0000#1' }] });
    expect(changedMediaIds(rephotoed)).toEqual(['bbbbbbbb-0000']);

    const notes = update({}, { productionNotes: 'media:cccccccc-0000#1' }, ['productionNotes']);
    expect(changedMediaIds(notes)).toEqual([]);

    const track = { ...fullSettings().musicLibrary[0], id: 'lib9', music: 'media:dddddddd-0000#1' };
    expect(changedMediaIds(settingsEdit(rowsEdit('musicLibrary', [], [track as never])))).toEqual(['dddddddd-0000']);
  });
});

describe('what a file says it is', () => {
  const b64 = (bytes: number[] | string) =>
    Buffer.from(typeof bytes === 'string' ? bytes : Uint8Array.from(bytes)).toString('base64').slice(0, 64);
  const pad = (head: number[] | string) => (typeof head === 'string' ? head + '\0'.repeat(16) : [...head, ...new Array(16).fill(0)]);

  it('knows each allowed kind by its first bytes', () => {
    const cases: [string, number[] | string][] = [
      ['image/jpeg', [0xff, 0xd8, 0xff, 0xe0]],
      ['image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]],
      ['image/webp', 'RIFF\x10\x00\x00\x00WEBPVP8 '],
      ['image/gif', 'GIF89a'],
      ['audio/mpeg', 'ID3\x04\x00'],
      ['audio/mpeg', [0xff, 0xfb, 0x90, 0x44]],
      ['audio/mp4', '\x00\x00\x00\x20ftypM4A '],
      ['audio/aac', [0xff, 0xf1, 0x50, 0x80]],
      ['audio/aac', [0xff, 0xf9, 0x50, 0x80]],
      ['audio/wav', 'RIFF\x10\x00\x00\x00WAVEfmt '],
      ['audio/ogg', 'OggS\x00\x02'],
      ['audio/webm', [0x1a, 0x45, 0xdf, 0xa3]],
      ['application/pdf', '%PDF-1.7'],
    ];
    for (const [type, head] of cases) {
      expect(sniffMediaType(b64(pad(head))), type).toBe(type);
      expect(ALLOWED_MEDIA_TYPES).toContain(type);
    }
  });

  it('knows nothing of markup and anything else', () => {
    expect(sniffMediaType(b64('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">'))).toBeNull();
    expect(sniffMediaType(b64('<?xml version="1.0"?><svg>'))).toBeNull();
    expect(sniffMediaType(b64('<!DOCTYPE html><html><script>'))).toBeNull();
    expect(sniffMediaType(b64('plain text, nothing more'))).toBeNull();
    expect(sniffMediaType('')).toBeNull();
    expect(sniffMediaType('!!!not base64!!!')).toBeNull();
  });
});

// The rule for people a co-producer brings in (newComics.ts), in refuse mode.
describe('someone new', () => {
  const settings = fullSettings();
  const show = fullShow();
  const people = knownPeople([show], settings);
  const withPeople = { ...ctx, people };
  const TAPE = 'https://youtu.be/abc123';
  const jo: Record<string, unknown> = { id: 'n1', name: 'Jo Park', videoLink: TAPE, tapeMinutes: 5, socialMedia: '@jopark' };
  const existing = settings.potentialComics as unknown as Record<string, unknown>[];
  const add = (row: Record<string, unknown>) => settingsEdit(rowsEdit('potentialComics', existing, [row, ...existing]));
  const said = (payload: unknown, context: Parameters<typeof validatePayload>[1] = withPeople) =>
    validatePayload(payload, context).problems.map((p) => `${p.path}: ${p.problem}`);
  const without = (key: string) => {
    const row = { ...jo };
    delete row[key];
    return row;
  };
  const booked = (list: 'performers' | 'artists', row: Record<string, unknown>) =>
    update({ [list]: show[list] }, { [list]: [...show[list], row] } as Partial<Show>, [list]);

  it('serves a tape length of 5 or 10 and drops any other', () => {
    const comic = settings.potentialComics[0];
    const serve = (tapeMinutes: unknown) => sanitizeSettings({ ...settings, potentialComics: [{ ...comic, tapeMinutes }] })!.potentialComics[0];
    expect(serve(5).tapeMinutes).toBe(5);
    expect(serve(10).tapeMinutes).toBe(10);
    expect(serve(7)).not.toHaveProperty('tapeMinutes');
    expect(serve('10')).not.toHaveProperty('tapeMinutes');
    const performer = show.performers[0];
    expect(sanitizeShow({ ...show, performers: [{ ...performer, tapeMinutes: 5 }] })!.performers[0].tapeMinutes).toBe(5);
    expect(sanitizeShow({ ...show, performers: [{ ...performer, tapeMinutes: 7 }] })!.performers[0]).not.toHaveProperty('tapeMinutes');
  });

  it('accepts a new Rolodex entry with a name, a tape, its length and social media', () => {
    expect(said(add(jo))).toEqual([]);
    expect(said(add({ ...jo, tapeMinutes: 10, socialMedia: 'https://facebook.com/profile.php?id=7' }))).toEqual([]);
    // The same without the owner's data to hand.
    expect(said(add(jo), ctx)).toEqual([]);
  });

  it('refuses one without a name, a tape, a length or social media', () => {
    const at = 'settings.fields[0].proposed[0][1]';
    expect(said(add({ ...jo, name: '  ' }))).toEqual([`${at}.name: someone new needs a name`]);
    expect(said(add(without('videoLink')))).toEqual([`${at}.videoLink: someone new needs a tape: an http or https link to a video of their set`]);
    expect(said(add(without('tapeMinutes')))).toEqual([`${at}.tapeMinutes: someone new needs a tape length of 5 or 10 minutes`]);
    expect(said(add(without('socialMedia')))).toEqual([`${at}.socialMedia: someone new needs their social media: a handle or a profile link`]);
    expect(said(add({ id: 'n1', name: 'Jo Park' }))).toHaveLength(3);
    expect(said(add({ id: 'n1', name: 'Jo Park' }), ctx)).toHaveLength(3);
  });

  it('refuses a tape that is not an http or https link, or one into the app itself', () => {
    for (const bad of ['watch my tape', 'javascript:alert(1)', 'ftp://example.com/tape.mp4', `${APP}/api/settings`, '']) {
      expect(ok(add({ ...jo, videoLink: bad })), bad).toBe(false);
    }
  });

  it('refuses a tape of any length but 5 or 10 minutes', () => {
    expect(said(add({ ...jo, tapeMinutes: 7 }))).toEqual(['settings.fields[0].proposed[0][1].tapeMinutes: not 5 or 10']);
    for (const bad of [0, 15, '5', true]) expect(ok(add({ ...jo, tapeMinutes: bad })), String(bad)).toBe(false);
    // Nor on someone already there, or on a booking.
    const sam = existing[0];
    expect(ok(settingsEdit(rowsEdit('potentialComics', existing, [{ ...sam, tapeMinutes: 7 }])))).toBe(false);
    expect(ok(update({ performers: show.performers }, { performers: [{ ...show.performers[0], tapeMinutes: 7 }] } as unknown as Partial<Show>))).toBe(false);
  });

  it('refuses any other field on someone new', () => {
    const at = 'settings.fields[0].proposed[0][1]';
    const extras: Record<string, unknown> = {
      email: 'jo@example.com', phone: '555 0100', notes: 'Pay 50', credits: 'TV', photo: 'media:abcdefgh#1',
      walkOnMusic: 'media:abcdefgh#1', walkOnMusicName: 'Song', walkOnMusicArtist: 'Band', walkOnMusicTimestamp: '0:30',
      walkOnMusicLink: 'https://example.com/track', walkOnStartSec: 1, walkOnEndSec: 9,
    };
    for (const [key, value] of Object.entries(extras)) {
      expect(said(add({ ...jo, [key]: value })), key).toEqual([`${at}.${key}: not allowed for someone new: only a name, a tape and social media`]);
    }
    expect(ok(add({ ...jo, pay: 100 }))).toBe(false);
  });

  it('still lets someone already in the Rolodex be edited as before', () => {
    const edited: Record<string, unknown> = { ...existing[0], email: 'new@example.com', notes: 'Moved to Leeds.' };
    delete edited.videoLink;
    delete edited.tapeMinutes;
    expect(said(settingsEdit(rowsEdit('potentialComics', existing, [edited])))).toEqual([]);
  });

  it('lets someone in the Rolodex be booked with their whole profile', () => {
    const sam = { ...existing[0], id: 'slot-new', comicId: existing[0].id };
    expect(said(booked('performers', sam))).toEqual([]);
    expect(said(booked('artists', { ...sam, artistType: 'Musician' }))).toEqual([]);
  });

  it('accepts a new name on a bill with the three things, with or without a new Rolodex entry', () => {
    const slot = { ...jo, id: 'slot-new', comicId: 'n1' };
    const both = { ...booked('performers', slot), settings: add(jo).settings };
    expect(said(both)).toEqual([]);
    expect(said(booked('artists', { ...jo, id: 'slot-new', artistType: 'Band' }))).toEqual([]);
  });

  it('refuses a new name on a bill without them, or with more', () => {
    const at = `shows[0].proposed.performers[${show.performers.length}]`;
    expect(said(booked('performers', { id: 'slot-new', name: 'Walk In' }))).toEqual([
      `${at}.videoLink: someone new needs a tape: an http or https link to a video of their set`,
      `${at}.tapeMinutes: someone new needs a tape length of 5 or 10 minutes`,
      `${at}.socialMedia: someone new needs their social media: a handle or a profile link`,
    ]);
    expect(said(booked('performers', { ...jo, id: 'slot-new', email: 'jo@example.com' }))).toEqual([
      `${at}.email: not allowed for someone new: only a name, a tape and social media`,
    ]);
    expect(said(booked('artists', { id: 'slot-new', name: 'New Band' }))).toHaveLength(3);
    // A booking of the new entry in the same request is held to the same.
    const slot = { ...jo, id: 'slot-new', comicId: 'n1', photo: 'media:abcdefgh#1' };
    expect(said({ ...booked('performers', slot), settings: add(jo).settings }, ctx)).toEqual([
      `${at}.photo: not allowed for someone new: only a name, a tape and social media`,
    ]);
  });

  it('leaves the rule to the owner’s plan in the owner’s inbox, which says why instead (applyRequest.test.ts)', () => {
    const inbox = { ...ctx, newPeopleCheckedByPlan: true as const };
    expect(said(add({ id: 'n1', name: 'Jo Park', email: 'jo@example.com' }), inbox)).toEqual([]);
    // Types are still types there.
    expect(said(add({ ...jo, tapeMinutes: 7 }), inbox)).toEqual(['settings.fields[0].proposed[0][1].tapeMinutes: not 5 or 10']);
  });

  // Who is new is read from the owner's data, never from what the request says was there.
  it('refuses a request that lies about who was already there', () => {
    const extras = { email: 'n@b.co', notes: 'no tape' };
    const mine: Show = { ...show, performers: [{ id: 'p1', name: 'Gone Person', comicId: 'gone' }], artists: [{ id: 'a1', name: 'House Band' }] };
    const owned = { ...ctx, people: knownPeople([mine], settings) };
    const NOT_THEIRS = 'not someone in the Rolodex';
    // A made-up link on both sides of an unlinked booking.
    expect(said(update({ artists: [{ id: 'a1', name: 'House Band', comicId: 'zzz' }] } as Partial<Show>, { artists: [{ id: 'a1', name: 'Brand New Band', comicId: 'zzz', ...extras }] } as Partial<Show>), owned))
      .toEqual([`shows[0].proposed.artists[0].comicId: ${NOT_THEIRS}`]);
    // A link whose Rolodex entry is gone, under a new name.
    expect(said(update({ performers: mine.performers }, { performers: [...mine.performers, { id: 'p-s', name: 'Sneak In', comicId: 'gone', ...extras }] }), owned))
      .toEqual([`shows[0].proposed.performers[1].comicId: ${NOT_THEIRS}`]);
    expect(said(update({ performers: mine.performers }, { performers: [{ ...mine.performers[0], notes: 'Back in May' }] }), owned)).toEqual([]);
    // A row the request says was already in the Rolodex, or already on the bill.
    const ids = existing.map((row) => row.id as string);
    const sneak = { id: 'c-sneak', name: 'Sneak In', email: 'x@y.co' };
    const lying: SettingsFieldEdit = { field: 'potentialComics', kind: 'rows', idField: 'id', baseOrder: ['c-sneak', ...ids], proposedOrder: ['c-sneak', ...ids], base: [], proposed: [['c-sneak', sneak]] };
    expect(said(settingsEdit(lying))).toHaveLength(4);
    const before = { id: 'p-s', name: 'Sneak In' };
    expect(said(update({ performers: [...show.performers, before] }, { performers: [...show.performers, { ...before, email: 'x@y.co' }] }))).toHaveLength(4);
    // Filing someone on a bill with more than their booking says.
    const walkOn = { ...ctx, people: knownPeople([{ ...show, performers: [{ id: 'p2', name: 'Walk On' }] }], settings) };
    expect(said(add({ id: 'c-w', name: 'walk on', ...extras }), walkOn)).toHaveLength(5);
    expect(said(add({ id: 'c-w', name: 'walk on' }), walkOn)).toEqual([]);
  });

  it('refuses social media that is not a handle or a profile link', () => {
    for (const socialMedia of ['.', '-', 'https://', 'javascript:alert(1)', 'https://instagram.com/', 'https://instagram.com/p/abc']) {
      expect(said(add({ ...jo, socialMedia })), socialMedia).toEqual(['settings.fields[0].proposed[0][1].socialMedia: someone new needs their social media: a handle or a profile link']);
    }
  });

  it('refuses a booking that points at nobody, and every unknown name on a new show', () => {
    expect(said(booked('performers', { ...existing[0], id: 'slot-new', comicId: 'made-up' }))).toEqual([
      `shows[0].proposed.performers[${show.performers.length}].comicId: not someone in the Rolodex`,
    ]);
    const fresh = newShow({ id: 'brand-new', performers: [{ id: 'p-new', name: 'Fresh Face' }], artists: [] });
    expect(said(create(fresh))).toHaveLength(3);
    const tidy = newShow({ id: 'brand-new', performers: [{ ...jo, id: 'p-new' } as unknown as Show['performers'][number]], artists: [] });
    expect(said(create(tidy))).toEqual([]);
  });
});
