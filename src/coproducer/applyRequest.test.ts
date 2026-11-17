import { describe, expect, it } from 'vitest';
import type { AppSettings, PotentialComic, Show } from '../types';
import { mergeRequestSettings, mergeRequestShow, planEdit, PLAN_REASONS, type PlanContext } from './applyRequest';
import { buildPseudonymIndex, pseudonym, viewOfSettings, viewOfShow, type OwnerState } from './redaction';
import { clone, FIXTURE_SECRETS, fullPerformer, fullSettings, fullShow } from './testFixtures';
import type { EditPayload, SettingsEdit, SettingsFieldEdit, ShowEdit, ShowKey, ShowUpdate } from './types';

const NOW = '2026-09-01T12:00:00.000Z';

async function owner(shows: Show[], settings: AppSettings = fullSettings()) {
  const state: OwnerState = { shows, settings };
  const index = await buildPseudonymIndex(state);
  const ctx = (over: Partial<PlanContext> = {}): PlanContext => ({
    index,
    mediaIds: [],
    now: NOW,
    trashId: (id) => `coprod-req1-${id}`.slice(0, 128),
    newId: (seed) => `coprod-req1-new-${seed}`,
    context: {},
    ...over,
  });
  return { state, index, ctx };
}

/** A show update as the co-producer's app captures it: base from their view, proposed for the keys that differ. */
function updateOf(view: Show, proposed: Partial<Show>): ShowUpdate {
  const keys = Object.keys(proposed) as ShowKey[];
  const base: Record<string, unknown> = {};
  for (const key of keys) if (Object.prototype.hasOwnProperty.call(view, key)) base[key] = clone((view as unknown as Record<string, unknown>)[key]);
  return { target: 'show', op: 'update', showId: view.id, baseRevision: null, keys, base: base as Partial<Show>, proposed: clone(proposed) };
}

function editOf(shows: ShowEdit[], fields: SettingsFieldEdit[] = []): EditPayload {
  const settings: SettingsEdit | null = fields.length ? { target: 'settings', baseRevision: null, fields } : null;
  return { kind: 'edit', shows, settings };
}

/** A settings rows edit from the co-producer's view of a list, and the list as they want it. */
function rowsEdit(field: SettingsFieldEdit['field'], idField: string, before: Record<string, unknown>[], after: Record<string, unknown>[]): SettingsFieldEdit {
  const id = (row: Record<string, unknown>) => String(row[idField]);
  const beforeIds = new Map(before.map((row) => [id(row), row]));
  const afterIds = new Map(after.map((row) => [id(row), row]));
  return {
    field,
    kind: 'rows',
    idField,
    baseOrder: before.map(id),
    proposedOrder: after.map(id),
    base: before.filter((row) => JSON.stringify(afterIds.get(id(row))) !== JSON.stringify(row)).map((row) => [id(row), clone(row)]),
    proposed: after.filter((row) => JSON.stringify(beforeIds.get(id(row))) !== JSON.stringify(row)).map((row) => [id(row), clone(row)]),
  };
}

function ok(result: ReturnType<typeof planEdit>) {
  if (!result.ok) throw new Error(`plan refused: ${result.reason}`);
  return result;
}

type ListKey = 'performers' | 'artists' | 'schedule' | 'hosts' | 'djSongs' | 'staff' | 'vendors' | 'expenses' | 'scenes' | 'todos';
const LIST_CHANGES: [ListKey, string, unknown][] = [
  ['performers', 'notes', 'Closes instead.'],
  ['artists', 'notes', 'Paints the host.'],
  ['schedule', 'description', 'Host returns'],
  ['hosts', 'notes', 'Bring water.'],
  ['djSongs', 'notes', 'Play softly.'],
  ['staff', 'phone', '555-0199'],
  ['vendors', 'notes', 'Cards too.'],
  ['expenses', 'notes', 'Balance due.'],
  ['scenes', 'description', 'Lights up.'],
  ['todos', 'text', 'Print two run sheets'],
];

function rowsOf(show: Show, key: ListKey): Record<string, unknown>[] {
  return ((show as unknown as Record<string, unknown>)[key] as Record<string, unknown>[]) ?? [];
}

function withRows(show: Show, key: ListKey, rows: Record<string, unknown>[]): Show {
  return { ...show, [key]: rows } as Show;
}

describe('mergeRequestShow, list by list', () => {
  for (const [key, field, value] of LIST_CHANGES) {
    it(`${key}: their change to one row and the owner's row added meanwhile both survive`, async () => {
      const original = fullShow();
      const { index } = await owner([original]);
      const asked = viewOfShow(original, index);
      const rowA = rowsOf(original, key)[0];
      const edit = updateOf(asked, { [key]: [{ ...rowsOf(asked, key)[0], [field]: value }] } as Partial<Show>);
      const rowB = { ...clone(rowA), id: 'owner-added' };
      const current = withRows(original, key, [rowA, rowB]);
      const outcome = mergeRequestShow(edit, current, viewOfShow(current, index));
      expect(outcome.conflicts).toEqual([]);
      expect(rowsOf(outcome.value, key)).toEqual([{ ...rowA, [field]: value }, rowB]);
    });

    it(`${key}: a field both changed to different values is a conflict, and theirs is written`, async () => {
      const original = fullShow();
      const { index } = await owner([original]);
      const edit = updateOf(viewOfShow(original, index), { [key]: [{ ...rowsOf(original, key)[0], [field]: value }] } as Partial<Show>);
      const theirs = typeof value === 'boolean' ? !value : `${String(value)} (owner)`;
      const current = withRows(original, key, [{ ...rowsOf(original, key)[0], [field]: theirs }]);
      const outcome = mergeRequestShow(edit, current, viewOfShow(current, index));
      const id = String(rowsOf(original, key)[0].id);
      expect(outcome.conflicts).toEqual([{ groupKey: 'show:show1', path: `${key}/${id}/${field}`, base: rowsOf(original, key)[0][field], current: theirs, proposed: value }]);
      expect(rowsOf(outcome.value, key)[0][field]).toEqual(value);
    });
  }

  it('the same change on both sides is no conflict, and nothing is written', async () => {
    const original = fullShow();
    const { index } = await owner([original]);
    const todos = [{ ...original.todos[0], completed: true }];
    const edit = updateOf(viewOfShow(original, index), { todos });
    const current = { ...original, todos };
    const outcome = mergeRequestShow(edit, current, viewOfShow(current, index));
    expect(outcome.conflicts).toEqual([]);
    expect(outcome.value).toBe(current);
  });

  it('a row they removed that the owner edited is a conflict, and it is removed', async () => {
    const original = fullShow();
    const { index } = await owner([original]);
    const edit = updateOf(viewOfShow(original, index), { todos: [] });
    const current = { ...original, todos: [{ ...original.todos[0], text: 'Print two run sheets' }] };
    const outcome = mergeRequestShow(edit, current, viewOfShow(current, index));
    expect(outcome.conflicts.map((c) => c.path)).toEqual(['todos/t1']);
    expect(outcome.value.todos).toEqual([]);
  });

  it('a row the owner deleted stays deleted, with a note', async () => {
    const original = fullShow();
    const { index } = await owner([original]);
    const edit = updateOf(viewOfShow(original, index), { todos: [{ ...original.todos[0], completed: true }] });
    const current = { ...original, todos: [] };
    const outcome = mergeRequestShow(edit, current, viewOfShow(current, index));
    expect(outcome.value).toBe(current);
    expect(outcome.notes).toEqual(["You removed Print the run sheet from To-dos, so their change to it wasn't applied."]);
  });

  it('a row they added lands beside its neighbour, and one already there is a note', async () => {
    const original = { ...fullShow(), todos: [{ id: 't1', text: 'One', completed: false }, { id: 't3', text: 'Three', completed: false }] };
    const { index } = await owner([original]);
    const added = { id: 't2', text: 'Two', completed: false };
    const edit = updateOf(viewOfShow(original, index), { todos: [original.todos[0], added, original.todos[1]] });
    const current = { ...original, todos: [{ id: 't0', text: 'Zero', completed: false }, ...original.todos] };
    expect(mergeRequestShow(edit, current, viewOfShow(current, index)).value.todos!.map((t) => t.id)).toEqual(['t0', 't1', 't2', 't3']);
    const already = { ...original, todos: [...original.todos, added] };
    expect(mergeRequestShow(edit, already, viewOfShow(already, index)).notes).toEqual(['Two is already there.']);
  });

  it('an order changed on both sides is an #order conflict, and theirs is written', async () => {
    const rows = ['a', 'b', 'c'].map((id) => ({ id, text: id.toUpperCase(), completed: false }));
    const original = { ...fullShow(), todos: rows };
    const { index } = await owner([original]);
    const edit = updateOf(viewOfShow(original, index), { todos: [rows[2], rows[0], rows[1]] });
    const current = { ...original, todos: [rows[1], rows[0], rows[2]] };
    const outcome = mergeRequestShow(edit, current, viewOfShow(current, index));
    expect(outcome.conflicts.map((c) => c.path)).toEqual(['todos#order']);
    expect(outcome.value.todos!.map((t) => t.id)).toEqual(['c', 'a', 'b']);
  });

  it('recap and section sub-keys merge one by one, and the profit is worked out again', async () => {
    const original = fullShow();
    const { index } = await owner([original]);
    const asked = viewOfShow(original, index);
    const edit = updateOf(asked, {
      recap: { ...asked.recap!, attendance: 120 },
      completions: { ...asked.completions!, staff: true },
    });
    const current = { ...original, recap: { ...original.recap!, ticketSales: 900 }, completions: { ...original.completions!, hosts: true } };
    const outcome = mergeRequestShow(edit, current, viewOfShow(current, index));
    expect(outcome.conflicts).toEqual([]);
    expect(outcome.value.recap).toMatchObject({ attendance: 120, ticketSales: 900 });
    expect(outcome.value.recap!.profitLoss).not.toBe(original.recap!.profitLoss);
    expect(outcome.value.completions).toMatchObject({ staff: true, hosts: true });
  });

  it('hidden sections and library tracks merge as sets', async () => {
    const original = fullShow();
    const { index } = await owner([original]);
    const edit = updateOf(viewOfShow(original, index), { hiddenSections: ['scenes', 'staff'], djHiddenLibraryIds: [] });
    const current = { ...original, hiddenSections: ['scenes' as const, 'vendors' as const], djHiddenLibraryIds: ['lib2', 'lib3'] };
    const outcome = mergeRequestShow(edit, current, viewOfShow(current, index));
    expect(outcome.conflicts).toEqual([]);
    expect(outcome.value.hiddenSections).toEqual(['scenes', 'vendors', 'staff']);
    expect(outcome.value.djHiddenLibraryIds).toEqual(['lib3']);
  });

  it('finds conflicts on raw values: past character 200, whitespace only, and bookkeeping keys', async () => {
    const long = 'x'.repeat(250);
    const original = { ...fullShow(), productionNotes: long, name: 'Friday Laughs' };
    const { index } = await owner([original]);
    const asked = viewOfShow(original, index);
    const edit = updateOf(asked, {
      productionNotes: `${long} (theirs)`,
      name: 'Friday Night Laughs',
      performers: [{ ...asked.performers[0], comicId: 'c-theirs' }],
    });
    const current = {
      ...original,
      productionNotes: `${'x'.repeat(220)}y${'x'.repeat(29)}`,
      name: 'Friday Laughs ',
      performers: [{ ...original.performers[0], comicId: 'c-owner' }],
    };
    const outcome = mergeRequestShow(edit, current, viewOfShow(current, index));
    expect(outcome.conflicts.map((c) => c.path).sort()).toEqual(['name', 'performers/p1/comicId', 'productionNotes']);
  });

  it('never reads a key the request does not name, nor one only the owner keeps', async () => {
    const shows = [fullShow(), fullShow({ id: 'show2', viewToken: 'otherTokenZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ' })];
    const { index } = await owner(shows);
    const pseudoB = await pseudonym('otherTokenZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ');
    const edit: ShowUpdate = {
      target: 'show', op: 'update', showId: 'show1', baseRevision: null,
      keys: ['viewToken', 'viewerKey', 'id'] as unknown as ShowKey[],
      base: {}, proposed: { viewToken: pseudoB, viewerKey: 'x', id: 'show2' } as Partial<Show>,
    };
    const outcome = mergeRequestShow(edit, shows[0], viewOfShow(shows[0], index));
    expect(outcome.value).toBe(shows[0]);
    expect(outcome.value.viewToken).toBe(FIXTURE_SECRETS.viewToken);
  });
});

describe('prototype names', () => {
  it('as row ids, field names and nested keys never touch a prototype', async () => {
    const original = { ...fullShow(), todos: [] };
    const { index } = await owner([original]);
    const rows = JSON.parse('[{"id":"__proto__","text":"a","completed":false},{"id":"constructor","text":"b","completed":false},{"id":"toString","text":"c","completed":false,"__proto__":{"polluted":true}}]');
    const edit = updateOf(viewOfShow(original, index), { todos: rows });
    const outcome = mergeRequestShow(edit, original, viewOfShow(original, index));
    expect(outcome.value.todos!.map((t) => t.id)).toEqual(['__proto__', 'constructor', 'toString']);
    for (const row of outcome.value.todos!) expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(outcome.value)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();

    const settings = fullSettings({ potentialComics: [] });
    const settingsIndex = await buildPseudonymIndex({ shows: [], settings });
    const comics = JSON.parse('[{"id":"__proto__","name":"Proto"},{"id":"toString","name":"Str"}]');
    const merged = mergeRequestSettings(
      { target: 'settings', baseRevision: null, fields: [rowsEdit('potentialComics', 'id', [], comics)] },
      settings,
      viewOfSettings(settings, settingsIndex),
      settingsIndex,
    );
    expect(merged.value.potentialComics.map((c) => c.id)).toEqual(['__proto__', 'toString']);
    expect(Object.getPrototypeOf(merged.value)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(merged.value.potentialComics[0])).toBe(Object.prototype);
  });
});

describe('planEdit', () => {
  it('ticks to-do A while the owner added to-do B: both are on the show', async () => {
    const original = fullShow();
    const asked = viewOfShow(original, (await owner([original])).index);
    const current = { ...original, todos: [...original.todos, { id: 't2', text: 'Book the DJ', completed: false }] };
    const { state, ctx } = await owner([current]);
    const plan = ok(planEdit(editOf([updateOf(asked, { todos: [{ ...asked.todos![0], completed: true }] })]), state, ctx()));
    expect(plan.after.shows[0].todos).toEqual([{ ...original.todos[0], completed: true }, current.todos[1]]);
    expect(plan.after.shows[0].updatedAt).toBe(NOW);
    expect(plan.upsert).toEqual(['show1']);
    expect(plan.remove).toEqual([]);
    expect(plan.settingsChanged).toBe(false);
    expect(plan.conflicts).toEqual([]);
    expect(plan.changes.map((g) => g.key)).toEqual(['show:show1']);
  });

  it('keeps the owner’s own object for every show it does not touch', async () => {
    const other = fullShow({ id: 'show2', name: 'Other', viewToken: undefined, viewerKey: undefined });
    const original = fullShow();
    const { state, index, ctx } = await owner([original, other]);
    const plan = ok(planEdit(editOf([updateOf(viewOfShow(original, index), { venueName: 'The Attic' })]), state, ctx()));
    expect(plan.after.shows[1]).toBe(other);
    expect(plan.upsert).toEqual(['show1']);
  });

  it('refuses what only the owner’s app may change', async () => {
    const { state, index, ctx } = await owner([fullShow()]);
    const view = viewOfSettings(state.settings, index);
    const refuse = (fields: SettingsFieldEdit[]) => planEdit(editOf([], fields), state, ctx());
    expect(refuse([{ field: 'deletedShowIds', kind: 'value', base: view.deletedShowIds, proposed: [] }])).toEqual({ ok: false, reason: PLAN_REASONS.notAllowed });
    expect(refuse([{ field: 'onboarded', kind: 'value', base: true, proposed: false }])).toEqual({ ok: false, reason: PLAN_REASONS.notAllowed });
    const trashRow = view.trash[0] as unknown as Record<string, unknown>;
    expect(refuse([rowsEdit('trash', 'id', [trashRow], [trashRow, { ...trashRow, id: 'tr2' }])])).toEqual({ ok: false, reason: PLAN_REASONS.notAllowed });
    const link = view.signatureRequests[0] as unknown as Record<string, unknown>;
    expect(refuse([rowsEdit('signatureRequests', 'token', [link], [{ ...link, signerName: 'Someone else' }])])).toEqual({ ok: false, reason: PLAN_REASONS.notAllowed });
    const profile = view.profileRequests![0] as unknown as Record<string, unknown>;
    expect(refuse([rowsEdit('profileRequests', 'token', [], [profile])])).toEqual({ ok: false, reason: PLAN_REASONS.notAllowed });
  });

  it('refuses a file it does not carry and the account does not have', async () => {
    const original = fullShow();
    const { state, index, ctx } = await owner([original]);
    const payload = editOf([updateOf(viewOfShow(original, index), { flyer: 'media:99999999-aaaa-bbbb-cccc-000000000009#1' })]);
    expect(planEdit(payload, state, ctx())).toEqual({ ok: false, reason: PLAN_REASONS.missingFile });
    expect(ok(planEdit(payload, state, ctx({ mediaIds: ['99999999-aaaa-bbbb-cccc-000000000009'] }))).after.shows[0].flyer).toBe('media:99999999-aaaa-bbbb-cccc-000000000009#1');
    const existing = editOf([updateOf(viewOfShow(original, index), { flyer: 'media:11111111-aaaa-bbbb-cccc-000000000006#1' })]);
    expect(planEdit(existing, state, ctx()).ok).toBe(true);
  });

  it('a create never carries a viewer link, and keeps the owner’s clock', async () => {
    const original = fullShow();
    const { state, index, ctx } = await owner([original]);
    const created = { ...viewOfShow(original, index), id: 'show-new', name: 'New Night', createdAt: 'then', updatedAt: 'then' };
    const plan = ok(planEdit(editOf([{ target: 'show', op: 'create', showId: 'show-new', show: created }]), state, ctx()));
    const made = plan.after.shows[0];
    expect(made.id).toBe('show-new');
    expect(made.viewToken).toBeUndefined();
    expect(made.viewerKey).toBeUndefined();
    expect(made.createdAt).toBe(NOW);
    expect(plan.withdrawals).toEqual([]);
  });

  it('a delete files the owner’s copy in Recently deleted with a stable id, and keeps its viewer link there', async () => {
    const original = fullShow({ flyer: 'data:image/png;base64,AAAA' });
    const { state, index, ctx } = await owner([original]);
    const payload = editOf([{ target: 'show', op: 'delete', showId: 'show1', baseRevision: null, base: viewOfShow(original, index) }]);
    const plan = ok(planEdit(payload, state, ctx()));
    expect(plan.remove).toEqual(['show1']);
    expect(plan.after.shows).toEqual([]);
    const trashed = plan.after.settings.trash[0];
    expect(trashed).toMatchObject({ id: 'coprod-req1-show1', type: 'show', deletedAt: NOW });
    expect(trashed.data.viewToken).toBe(FIXTURE_SECRETS.viewToken);
    expect(plan.after.settings.deletedShowIds![0]).toBe('show1');
    expect(plan.withdrawals).toEqual([]);
    expect(plan.conflicts).toEqual([]);
    const again = ok(planEdit(payload, state, ctx()));
    expect(again.fingerprint).toBe(plan.fingerprint);
    expect(JSON.stringify(plan.changes)).not.toContain('Withdrawn');
  });

  it('a delete of a show the owner changed since is a conflict', async () => {
    const original = fullShow();
    const asked = viewOfShow(original, (await owner([original])).index);
    const current = { ...original, venueName: 'Elsewhere' };
    const { state, ctx } = await owner([current]);
    const plan = ok(planEdit(editOf([{ target: 'show', op: 'delete', showId: 'show1', baseRevision: null, base: asked }]), state, ctx()));
    expect(plan.conflicts).toEqual([{ groupKey: 'show:show1', key: 'show', path: [], label: 'Changed since they asked to delete it', asked: 'As it was', now: 'Changed', proposed: 'Deleted' }]);
  });

  it('a restore puts back the owner’s trash copy with its real viewer link', async () => {
    const settings = fullSettings();
    const { state, index, ctx } = await owner([], settings);
    const view = viewOfSettings(settings, index);
    const payload = editOf(
      [{ target: 'show', op: 'create', showId: 'show-old', show: clone(view.trash[0].data) }],
      [rowsEdit('trash', 'id', view.trash as unknown as Record<string, unknown>[], [])],
    );
    const plan = ok(planEdit(payload, state, ctx()));
    expect(plan.after.shows[0].id).toBe('show-old');
    expect(plan.after.shows[0].viewToken).toBe(FIXTURE_SECRETS.trashViewToken);
    expect(plan.after.shows[0].viewerKey).toBe(FIXTURE_SECRETS.trashViewerKey);
    expect(plan.after.settings.trash).toEqual([]);
    expect(plan.after.settings.deletedShowIds).not.toContain('show-old');
    expect(plan.withdrawals).toEqual([]);
    expect(plan.changes.find((g) => g.key === 'show:show-old')?.note).toBe('Restored');
  });

  it('refuses a restore with changes', async () => {
    const settings = fullSettings();
    const { state, index, ctx } = await owner([], settings);
    const view = viewOfSettings(settings, index);
    const payload = editOf(
      [{ target: 'show', op: 'create', showId: 'show-old', show: { ...clone(view.trash[0].data), venueName: 'Somewhere new' } }],
      [rowsEdit('trash', 'id', view.trash as unknown as Record<string, unknown>[], [])],
    );
    expect(planEdit(payload, state, ctx())).toEqual({ ok: false, reason: 'This asks to restore “Old Show” with changes. Ask them to restore it first, then make the changes.' });
  });

  it('a create carrying another show’s viewer pseudonym, not a restore, loses it', async () => {
    const original = fullShow();
    const { state, index, ctx } = await owner([original]);
    const show = { ...viewOfShow(original, index), id: 'copy' };
    expect(show.viewToken).toMatch(/^redacted-/);
    const plan = ok(planEdit(editOf([{ target: 'show', op: 'create', showId: 'copy', show }]), state, ctx()));
    expect(plan.after.shows[0].viewToken).toBeUndefined();
    expect(plan.after.shows[1].viewToken).toBe(FIXTURE_SECRETS.viewToken);
  });

  it('withdraws a signing link only when its pseudonym resolves to the same row', async () => {
    const settings = fullSettings();
    const second = { ...settings.signatureRequests[0], id: 'second-id-12', token: 'secondTokenYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY', signed: undefined };
    settings.signatureRequests = [settings.signatureRequests[0], second];
    const { state, index, ctx } = await owner([], settings);
    const view = viewOfSettings(settings, index);
    const rows = view.signatureRequests as unknown as Record<string, unknown>[];

    const removeSecond = rowsEdit('signatureRequests', 'token', rows, [rows[0]]) as Extract<SettingsFieldEdit, { kind: 'rows' }>;
    const plan = ok(planEdit(editOf([], [removeSecond]), state, ctx()));
    expect(plan.after.settings.signatureRequests.map((r) => r.id)).toEqual([settings.signatureRequests[0].id]);
    expect(plan.withdrawals).toEqual([{ kind: 'signature', request: second }]);
    expect(plan.changes.find((g) => g.key === 'settings:signatureRequests')).toBeDefined();

    // The same pseudonym, but the row it names is another one.
    const rebound = { ...removeSecond, base: [[removeSecond.baseOrder[1], { ...rows[1], id: settings.signatureRequests[0].id }]] as [string, unknown][] };
    const refused = planEdit(editOf([], [rebound]), state, ctx());
    expect(refused).toEqual({ ok: false, reason: PLAN_REASONS.noChange });
    const outcome = mergeRequestSettings({ target: 'settings', baseRevision: null, fields: [rebound] }, settings, view, index);
    expect(outcome.notes).toEqual(["A link they asked to withdraw isn't there any more."]);
    expect(outcome.value).toBe(settings);
  });

  it('shows the Rolodex rewrite a changed booking causes, and every key', async () => {
    const pat: PotentialComic = { id: 'c9', name: 'Pat Doe', email: 'pat@example.com' };
    const settings = fullSettings({ potentialComics: [fullSettings().potentialComics[0], pat] });
    const original = fullShow({ artists: [], performers: [fullPerformer()] });
    const { state, index, ctx } = await owner([original], settings);
    const asked = viewOfShow(original, index);
    const plan = ok(planEdit(editOf([updateOf(asked, { performers: [{ ...asked.performers[0], comicId: 'c9' }] })]), state, ctx()));
    expect(plan.after.shows[0].performers[0]).toMatchObject({ comicId: 'c9', name: 'Pat Doe', email: 'pat@example.com' });
    const keys = plan.changes.flatMap((g) => g.changes.map((c) => c.key));
    expect(keys).toEqual(expect.arrayContaining(['performers/p1/comicId', 'performers/p1/name', 'performers/p1/email']));
  });

  it('names the rows its own bookkeeping makes from the request, so two plans read the same', async () => {
    const original = fullShow({ artists: [], performers: [] });
    const settings = fullSettings({ potentialComics: [] });
    const { state, index, ctx } = await owner([original], settings);
    const asked = viewOfShow(original, index);
    const newcomer = { id: 'p-new', name: 'Brand New Act' };
    const payload = editOf([updateOf(asked, { performers: [newcomer] })]);
    const first = ok(planEdit(payload, state, ctx()));
    const second = ok(planEdit(payload, state, ctx()));
    expect(first.after.settings.potentialComics.map((c) => c.id)).toEqual(['coprod-req1-new-1']);
    expect(first.after.shows[0].performers[0].comicId).toBe('coprod-req1-new-1');
    expect(second.fingerprint).toBe(first.fingerprint);
  });

  it('has the same fingerprint for the same state, and a new one when the owner’s values move', async () => {
    const original = fullShow();
    const asked = viewOfShow(original, (await owner([original])).index);
    const payload = editOf([updateOf(asked, { name: 'Saturday Laughs' })]);
    const a = await owner([original]);
    const one = ok(planEdit(payload, a.state, a.ctx()));
    expect(ok(planEdit(payload, a.state, a.ctx())).fingerprint).toBe(one.fingerprint);
    const b = await owner([{ ...original, name: 'Fri Laughs' }]);
    const moved = ok(planEdit(payload, b.state, b.ctx()));
    expect(moved.fingerprint).not.toBe(one.fingerprint);
    expect(moved.conflicts.map((c) => c.key)).toEqual(['name']);
  });

  it('nothing to change is no plan', async () => {
    const original = fullShow();
    const asked = viewOfShow(original, (await owner([original])).index);
    const payload = editOf([updateOf(asked, { venueName: 'The Attic' })]);
    const already = await owner([{ ...original, venueName: 'The Attic' }]);
    expect(planEdit(payload, already.state, already.ctx())).toEqual({ ok: false, reason: PLAN_REASONS.noChange });
    const gone = await owner([]);
    expect(planEdit(payload, gone.state, gone.ctx())).toEqual({ ok: false, reason: PLAN_REASONS.nothingLeft });
  });

  it('notes the files a change leaves unused, and deletes none', async () => {
    const original = fullShow({ flyer: 'media:11111111-aaaa-bbbb-cccc-000000000010#1' });
    const { state, index, ctx } = await owner([original]);
    const plan = ok(planEdit(editOf([updateOf(viewOfShow(original, index), { flyer: '' })]), state, ctx()));
    expect(plan.notes).toContain('1 file this replaces stays in your account until you use Free up space in Settings.');
  });

  it('merges a settings value three ways, and a settings list row by row', async () => {
    const settings = fullSettings();
    const { index } = await owner([], settings);
    const view = viewOfSettings(settings, index);
    const comic = view.potentialComics[0] as unknown as Record<string, unknown>;
    const edit: SettingsEdit = {
      target: 'settings',
      baseRevision: null,
      fields: [
        { field: 'brandName', kind: 'value', base: view.brandName, proposed: 'Laugh Co Live' },
        rowsEdit('potentialComics', 'id', [comic], [{ ...comic, notes: 'Headliner now.' }, { id: 'c-new', name: 'New Face' }]),
      ],
    };
    const current = { ...settings, rules: 'Owner changed the rules.', potentialComics: [...settings.potentialComics, { id: 'c-owner', name: 'Owner Pick' }] };
    const currentIndex = await buildPseudonymIndex({ shows: [], settings: current });
    const merged = mergeRequestSettings(edit, current, viewOfSettings(current, currentIndex), currentIndex);
    expect(merged.conflicts).toEqual([]);
    expect(merged.value.brandName).toBe('Laugh Co Live');
    expect(merged.value.rules).toBe('Owner changed the rules.');
    expect(merged.value.potentialComics.map((c) => [c.id, c.notes])).toEqual([['c1', 'Headliner now.'], ['c-new', undefined], ['c-owner', undefined]]);
  });
});
