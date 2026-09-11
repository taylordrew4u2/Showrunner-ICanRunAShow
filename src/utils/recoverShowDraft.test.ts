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
