import { describe, expect, it } from 'vitest';
import { createPendingStore, type DraftLock } from './pendingStore';
import { heldCopyLock } from './secure-storage';
import type { SessionCredentials } from './session-vault';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return { get length() { return data.size; }, key: i => [...data.keys()][i] ?? null,
    getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); },
    removeItem: key => { data.delete(key); }, clear: () => data.clear() };
}

// The slot rules are the same whatever a draft is sealed with.
const asIs: DraftLock = { seal: data => data, open: data => data };

it('one tab acknowledging its save leaves the other tab’s draft', () => {
  const storage = memoryStorage();
  const a = createPendingStore(() => storage, 'a');
  const b = createPendingStore(() => storage, 'b');
  a.write('shows', 'user', ['a'], asIs); b.write('shows', 'user', ['b'], asIs);
  a.capture('shows', 'user')();
  expect(b.list('shows', 'user', asIs).map(p => p.data)).toEqual([['b']]);
});

it('a late response cannot clear a newer draft or a different account', () => {
  const storage = memoryStorage(); const a = createPendingStore(() => storage, 'a');
  a.write('shows', 'one', ['old'], asIs);
  const acknowledge = a.capture('shows', 'one');
  a.write('shows', 'one', ['new'], asIs); a.write('shows', 'two', ['other'], asIs);
  acknowledge();
  expect(a.list('shows', 'one', asIs)[0].data).toEqual(['new']);
  expect(a.list('shows', 'two', asIs)[0].data).toEqual(['other']);
});

it('reports storage failure instead of claiming that work is backed up', () => {
  const a = createPendingStore(() => { throw new Error('Storage unavailable'); }, 'a');
  expect(a.write('shows', 'user', ['new'], asIs)).toBe(false);
});

it('finds a draft held under the name as typed when the next sign-in types it differently', () => {
  const storage = memoryStorage();
  const before = createPendingStore(() => storage, 'a'); before.write('shows', 'Taylor', ['edit'], asIs);
  const after = createPendingStore(() => storage, 'b');
  expect(after.readAll('shows', ' taylor ', asIs).map(p => p.data)).toEqual([['edit']]);
  after.capture('shows', ' taylor ')();
  expect(before.list('shows', 'Taylor', asIs)).toEqual([]);
});

it('recovers a draft an older build filed under the typed name, and lets go of it once saved', () => {
  const storage = memoryStorage();
  storage.setItem('shows:Taylor:old-tab', JSON.stringify({ username: 'Taylor', data: ['held'], at: 1 }));
  const a = createPendingStore(() => storage, 'a');
  expect(a.read('shows', 'taylor', a.list('shows', 'taylor', asIs))?.data).toEqual(['held']);
  a.capture('shows', 'taylor')();
  expect(storage.getItem('shows:Taylor:old-tab')).toBeNull();
});

it('lets go of a superseded draft only once it is kept elsewhere, and only those bytes', () => {
  // Two tabs each held an unsent settings edit. The newer one is recovered;
  // the older is parked on the account and then, and only then, discarded.
  const storage = memoryStorage();
  const older = createPendingStore(() => storage, 'a'); older.write('settings', 'user', { rolodex: ['old tab'] }, asIs);
  const newer = createPendingStore(() => storage, 'b'); newer.write('settings', 'user', { rolodex: ['new tab'] }, asIs);
  const drafts = newer.list('settings', 'user', asIs);
  expect(drafts.map(d => d.data)).toEqual([{ rolodex: ['old tab'] }, { rolodex: ['new tab'] }]);

  // The old tab wrote again in the meantime: that draft is not the one that
  // was parked, so it stays.
  const superseded = drafts[0];
  older.write('settings', 'user', { rolodex: ['old tab, edited again'] }, asIs);
  newer.discard(superseded);
  const held = () => newer.list<{ rolodex: string[] }>('settings', 'user', asIs).map(d => d.data.rolodex[0]).sort();
  expect(held()).toEqual(['new tab', 'old tab, edited again']);

  newer.discard(newer.list('settings', 'user', asIs).find(d => d.key.endsWith(':a'))!);
  expect(held()).toEqual(['new tab']);
});

it('lets go of a draft it is only parking once it is parked, not with the next save', () => {
  // A launch finds the newest settings draft was made over a version since
  // replaced, and parks it on the account instead of adopting it. The park
  // can fail — too large to send, or venue wifi — and an ordinary save from
  // the same tab, landing afterwards, must not take that draft with it.
  const storage = memoryStorage();
  createPendingStore(() => storage, 'earlier').write('settings', 'user', { rolodex: ['held'] }, asIs);
  const tab = createPendingStore(() => storage, 'launch');
  const held = tab.read<{ rolodex: string[] }>('settings', 'user', tab.list('settings', 'user', asIs))!;
  tab.release('settings', 'user', held);

  tab.write('settings', 'user', { rolodex: ['server', 'new edit'] }, asIs);
  tab.capture('settings', 'user')();
  expect(tab.list('settings', 'user', asIs).map(d => d.data)).toEqual([{ rolodex: ['held'] }]);

  tab.discard(held);
  expect(tab.list('settings', 'user', asIs)).toEqual([]);
});

describe('a held copy left on the device', () => {
  // Keys are supplied directly: PBKDF2 is slow and none of this is the KDF.
  const creds: SessionCredentials = { username: 'ada', userId: 'u1', authHash: 'h1', key: 'current-key', legacyKey: 'legacy-key' };
  const sealed = heldCopyLock(creds);
  const everything = (storage: Storage) => Array.from({ length: storage.length }, (_, i) => storage.getItem(storage.key(i)!)).join('');

  it('holds nothing in the clear, and opens again for the same account', () => {
    // The held copy is the whole Rolodex, every contract and the key to every
    // signing and profile link. It stays in this browser after sign-out, and
    // it used to be plain JSON there for whoever used the browser next.
    const storage = memoryStorage();
    const settings = { potentialComics: [{ id: 'c', name: 'Jo', email: 'jo@example.com' }], signatureRequests: [{ key: 'SIGNING-LINK-SECRET' }] };
    const shows = [{ id: 's', name: 'Late Night', notes: 'Door code 4471' }];
    const tab = createPendingStore(() => storage, 'a');
    tab.write('settings', 'ada', settings, sealed);
    tab.write('shows', 'ada', shows, sealed);

    for (const secret of ['jo@example.com', 'SIGNING-LINK-SECRET', 'Door code 4471', 'Late Night']) {
      expect(everything(storage)).not.toContain(secret);
    }
    // A build from before sealing reads `data`, and must find nothing there to
    // mistake for a show list.
    for (const i of [0, 1]) expect(JSON.parse(storage.getItem(storage.key(i)!)!)).not.toHaveProperty('data');
    const nextLaunch = createPendingStore(() => storage, 'b');
    expect(nextLaunch.list('settings', 'ada', sealed).map(d => d.data)).toEqual([settings]);
    expect(nextLaunch.readAll('shows', 'ada', sealed).map(d => d.data)).toEqual([shows]);
  });

  it('still recovers the work an older build held in the clear', () => {
    const storage = memoryStorage();
    storage.setItem('settings:ada:old-tab', JSON.stringify({ username: 'ada', data: { brandName: 'Held' }, at: 1 }));
    expect(createPendingStore(() => storage, 'a').list('settings', 'ada', sealed).map(d => d.data)).toEqual([{ brandName: 'Held' }]);
  });

  it('keeps a copy it cannot open instead of recovering or deleting it', () => {
    const storage = memoryStorage();
    const elsewhere = heldCopyLock({ ...creds, key: 'another-key', legacyKey: 'another-legacy-key' });
    createPendingStore(() => storage, 'a').write('shows', 'ada', [{ id: 's' }], elsewhere);
    const tab = createPendingStore(() => storage, 'b');
    expect(tab.readAll('shows', 'ada', sealed)).toEqual([]);
    tab.capture('shows', 'ada')();
    expect(storage.length).toBe(1);
  });
});

it('recovers legacy and multiple-tab drafts and acknowledges only captured versions', () => {
  const storage = memoryStorage();
  storage.setItem('shows', JSON.stringify({ username: 'user', data: ['legacy'], at: 1 }));
  const a = createPendingStore(() => storage, 'a'); a.write('shows', 'user', ['new'], asIs);
  const b = createPendingStore(() => storage, 'b');
  expect(b.readAll('shows', 'user', asIs)).toHaveLength(2);
  b.capture('shows', 'user')();
  expect(b.list('shows', 'user', asIs)).toEqual([]);
});

it('forgets every draft an account left on this device, in every tab, and nobody else’s', () => {
  const storage = memoryStorage();
  const a = createPendingStore(() => storage, 'a');
  const b = createPendingStore(() => storage, 'b');
  a.write('shows', 'Taylor', ['a'], asIs); b.write('shows', 'taylor', ['b'], asIs); a.write('shows', 'sam', ['sam'], asIs);
  storage.setItem('shows:Taylor:old-tab', JSON.stringify({ username: 'Taylor', data: ['older build'], at: 1 }));
  // Sealed under a key this device no longer holds: it will not open, and goes all the same.
  storage.setItem('shows:taylor:lost-key', JSON.stringify({ username: 'taylor', sealed: 'unreadable', at: 2 }));
  a.clear('shows', 'taylor');
  expect(Object.keys(Object.fromEntries(Array.from({ length: storage.length }, (_, i) => [storage.key(i), 1])))).toEqual([expect.stringMatching(/^shows:sam:/)]);
  expect(b.list('shows', 'sam', asIs).map(p => p.data)).toEqual([['sam']]);
});
