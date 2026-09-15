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

it('still keeps both when it knows the server moved under it', () => {
  // A real conflict is unchanged: this is what the forking is for.
  const base = show('Original'); const local = show('Local'); const remote = show('Remote');
  expect(recoverShowDraft([local], [remote], { a: hash(base) }).map(s => s.name))
    .toEqual(['Remote', 'Local (recovered edits)']);
});
