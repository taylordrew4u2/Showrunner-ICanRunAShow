import { expect, it } from 'vitest';
import { createPendingStore } from './pendingStore';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return { get length() { return data.size; }, key: i => [...data.keys()][i] ?? null,
    getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); },
    removeItem: key => { data.delete(key); }, clear: () => data.clear() };
}

it('one tab acknowledging its save leaves the other tab’s draft', () => {
  const storage = memoryStorage();
  const a = createPendingStore(() => storage, 'a');
  const b = createPendingStore(() => storage, 'b');
  a.write('shows', 'user', ['a']); b.write('shows', 'user', ['b']);
  a.capture('shows', 'user')();
  expect(b.list('shows', 'user').map(p => p.data)).toEqual([['b']]);
});

it('a late response cannot clear a newer draft or a different account', () => {
  const storage = memoryStorage(); const a = createPendingStore(() => storage, 'a');
  a.write('shows', 'one', ['old']);
  const acknowledge = a.capture('shows', 'one');
  a.write('shows', 'one', ['new']); a.write('shows', 'two', ['other']);
  acknowledge();
  expect(a.list('shows', 'one')[0].data).toEqual(['new']);
  expect(a.list('shows', 'two')[0].data).toEqual(['other']);
});

it('reports storage failure instead of claiming that work is backed up', () => {
  const a = createPendingStore(() => { throw new Error('Storage unavailable'); }, 'a');
  expect(a.write('shows', 'user', ['new'])).toBe(false);
});

it('recovers legacy and multiple-tab drafts and acknowledges only captured versions', () => {
  const storage = memoryStorage();
  storage.setItem('shows', JSON.stringify({ username: 'user', data: ['legacy'], at: 1 }));
  const a = createPendingStore(() => storage, 'a'); a.write('shows', 'user', ['new']);
  const b = createPendingStore(() => storage, 'b');
  expect(b.readAll('shows', 'user')).toHaveLength(2);
  b.capture('shows', 'user')();
  expect(b.list('shows', 'user')).toEqual([]);
});
