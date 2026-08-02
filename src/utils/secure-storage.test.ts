import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadEncryptedShows, saveEncryptedShows, type EncryptedShowRow } from './secure-storage';
import { encryptWithKey } from './encryption';
import type { Show } from '../types';
import type { SessionCredentials } from './session-vault';

// Keys are supplied directly rather than derived: PBKDF2 runs 100k iterations
// and none of this is testing the KDF.
const CREDS: SessionCredentials = {
  username: 'ada',
  userId: 'u1',
  authHash: 'h1',
  key: 'current-key',
  legacyKey: 'legacy-key',
};

const show = (over: Partial<Show>): Show => ({
  id: 's', name: 'Show', date: '', time: '', location: '', venueName: '',
  status: 'upcoming', performers: [], artists: [], schedule: [], hosts: [],
  djSongs: [], staff: [], vendors: [], expenses: [], scenes: [],
  createdAt: '', updatedAt: '', ...over,
});

function row(s: Show, key = CREDS.key): EncryptedShowRow {
  return { id: s.id, encryptedData: encryptWithKey(s, key) };
}

function mockGet(rows: EncryptedShowRow[]) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ shows: rows }),
  } as Response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Stub every PUT with a 200 and hand back the bodies that were sent. */
function mockPut() {
  const bodies: Record<string, unknown>[] = [];
  const fetchMock = vi.fn().mockImplementation((_path: string, init: RequestInit) => {
    bodies.push(JSON.parse(init.body as string));
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) } as Response);
  });
  vi.stubGlobal('fetch', fetchMock);
  return bodies;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadEncryptedShows', () => {
  it('returns every readable show when one row cannot be decrypted', async () => {
    // The whole point: this used to be a single .map, so the bad row threw
    // before the third was attempted and the page rendered zero shows.
    const bad: EncryptedShowRow = { id: 'b', encryptedData: 'not-ciphertext' };
    mockGet([row(show({ id: 'a', name: 'Late Night' })), bad, row(show({ id: 'c', name: 'Brunch' }))]);

    const loaded = await loadEncryptedShows(CREDS);

    expect(loaded.shows.map((s) => s.name)).toEqual(['Late Night', 'Brunch']);
    expect(loaded.unreadable).toEqual([bad]);
  });

  it('sets aside a row that decrypts to something that is not a show', async () => {
    const notAShow = { id: 'b', encryptedData: encryptWithKey({ nope: true }, CREDS.key) };
    mockGet([row(show({ id: 'a' })), notAShow]);

    const loaded = await loadEncryptedShows(CREDS);

    expect(loaded.shows).toHaveLength(1);
    expect(loaded.unreadable).toEqual([notAShow]);
  });

  it('still falls back to the legacy key before giving up on a row', async () => {
    mockGet([row(show({ id: 'a', name: 'Old' }), CREDS.legacyKey)]);

    const loaded = await loadEncryptedShows(CREDS);

    expect(loaded.shows.map((s) => s.name)).toEqual(['Old']);
    expect(loaded.unreadable).toEqual([]);
  });

  it('repairs a stored show that is missing its list fields', async () => {
    // Reaches the list instead of throwing while the dashboard counts it.
    const partial = { id: 'a', name: 'Late Night', status: 'upcoming' };
    mockGet([{ id: 'a', encryptedData: encryptWithKey(partial, CREDS.key) }]);

    const loaded = await loadEncryptedShows(CREDS);

    expect(loaded.unreadable).toEqual([]);
    expect(loaded.shows[0].performers).toEqual([]);
    expect(loaded.shows[0].schedule).toEqual([]);
  });
});

describe('saveEncryptedShows', () => {
  it('writes unreadable rows back untouched', async () => {
    // Every save replaces the whole set, so a row we merely failed to read
    // would otherwise be deleted by the next edit to any other show.
    const carried: EncryptedShowRow = { id: 'b', encryptedData: 'opaque-blob' };
    const bodies = mockPut();

    await saveEncryptedShows([show({ id: 'a' })], CREDS, [carried]);

    const sent = bodies[0].shows as EncryptedShowRow[];
    expect(sent).toHaveLength(2);
    expect(sent).toContainEqual(carried);
  });

  it('does not treat a save as a wipe when only unreadable rows remain', async () => {
    const bodies = mockPut();

    await saveEncryptedShows([], CREDS, [{ id: 'b', encryptedData: 'opaque-blob' }]);

    expect(bodies[0].deleteAll).toBe(false);
    expect(bodies[0].shows).toHaveLength(1);
  });

  it('still flags a genuinely empty save as intentional', async () => {
    const bodies = mockPut();

    await saveEncryptedShows([], CREDS);

    expect(bodies[0].deleteAll).toBe(true);
    expect(bodies[0].shows).toEqual([]);
  });

  it('never writes an id twice when a carried row is readable again', async () => {
    // id is a primary key — a duplicate fails the entire batch, taking every
    // other show's save down with it.
    const bodies = mockPut();

    await saveEncryptedShows([show({ id: 'a' })], CREDS, [{ id: 'a', encryptedData: 'stale' }]);

    const sent = bodies[0].shows as EncryptedShowRow[];
    expect(sent).toHaveLength(1);
    expect(sent[0].encryptedData).not.toBe('stale');
  });
});
