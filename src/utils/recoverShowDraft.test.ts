import { expect, it } from 'vitest';
import CryptoJS from 'crypto-js';
import { recoverShowDraft } from './recoverShowDraft';
import { healShow } from './showHealing';

const show = (name: string) => healShow({ id: 'a', name, status: 'upcoming' })!;
const hash = (s: ReturnType<typeof show>) => CryptoJS.SHA256(JSON.stringify(s)).toString();

it('retains both versions after a conflict and does not duplicate recovery on reload', () => {
  const base = show('Original'); const local = show('Local'); const remote = show('Remote');
  const recovered = recoverShowDraft([local], [remote], { a: hash(base) });
  expect(recovered.map(s => s.name)).toEqual(['Remote', 'Local (recovered edits)']);
  expect(recoverShowDraft([local], recovered, { a: hash(base) })).toEqual(recovered);
});

it('ignores an unchanged stale copy and preserves a remote deletion', () => {
  const base = show('Original');
  expect(recoverShowDraft([base], [], { a: hash(base) })).toEqual([]);
});

it('restores an unsaved new show without losing server-only shows', () => {
  const local = show('Local'); const remote = { ...show('Remote'), id: 'b' };
  expect(recoverShowDraft([local], [remote]).map(s => s.id)).toEqual(['b', 'a']);
});

it('does not make a second copy of a show it has no record of loading', () => {
  // The case that put two of every show on the list. A show created on this
  // device and then saved is on the server, but the held copy was written
  // before the save, so there is no baseline hash for it. "No baseline" was
  // read as "both sides changed" — and every show on the account forked into
  // a "(recovered edits)" twin of itself.
  const local = { ...show('Tuesday Night Laughs'), updatedAt: '2026-04-01T10:00:00.000Z' };
  const remote = { ...show('Tuesday Night Laughs'), status: 'completed' as const, updatedAt: '2026-04-01T09:00:00.000Z' };
  const recovered = recoverShowDraft([local], [remote]);
  expect(recovered).toHaveLength(1);
  expect(recovered[0].name).toBe('Tuesday Night Laughs');
});

it('keeps the later edit when it has no record of what it loaded', () => {
  const local = { ...show('Older here'), updatedAt: '2026-04-01T09:00:00.000Z' };
  const remote = { ...show('Newer on the server'), updatedAt: '2026-04-01T10:00:00.000Z' };
  expect(recoverShowDraft([local], [remote]).map(s => s.name)).toEqual(['Newer on the server']);

  const ahead = { ...show('Newer here'), updatedAt: '2026-04-02T10:00:00.000Z' };
  const behind = { ...show('Older on the server'), updatedAt: '2026-04-01T10:00:00.000Z' };
  expect(recoverShowDraft([ahead], [behind]).map(s => s.name)).toEqual(['Newer here']);
});

it('keeps a show deleted on this device deleted, while the server still has what it loaded', () => {
  // Delete a show in the basement, background the app, launch again with
  // signal: the held copy is the list without it, and the server still has
  // the version this device loaded. Starting from the server's list put it
  // straight back, next to its own copy in the trash.
  const kept = show('Kept'); const gone = { ...show('Gone'), id: 'x' };
  const recovered = recoverShowDraft([kept], [kept, gone], { a: hash(kept), x: hash(gone) });
  expect(recovered.map(s => s.id)).toEqual(['a']);
});

it('lets an edit made elsewhere outlive a deletion made here', () => {
  // The server's copy moved since this device loaded it. Somebody worked on
  // that show; the deletion here was made on a stale picture, and the edit
  // is the one that must not be lost.
  const kept = show('Kept'); const loaded = { ...show('Loaded'), id: 'x' };
  const edited = { ...show('Edited elsewhere'), id: 'x' };
  const recovered = recoverShowDraft([kept], [kept, edited], { a: hash(kept), x: hash(loaded) });
  expect(recovered.map(s => s.name)).toEqual(['Kept', 'Edited elsewhere']);
});

it('does not read a show it never loaded as deleted', () => {
  // Added from another device after this copy was held: no baseline, so
  // nothing here is evidence about it.
  const kept = show('Kept'); const elsewhere = { ...show('From the laptop'), id: 'b' };
  expect(recoverShowDraft([kept], [kept, elsewhere], { a: hash(kept) }).map(s => s.id)).toEqual(['a', 'b']);
});

it('still keeps both when it knows the server moved under it', () => {
  // A real conflict is unchanged: this is what the forking is for.
  const base = show('Original'); const local = show('Local'); const remote = show('Remote');
  expect(recoverShowDraft([local], [remote], { a: hash(base) }).map(s => s.name))
    .toEqual(['Remote', 'Local (recovered edits)']);
});
