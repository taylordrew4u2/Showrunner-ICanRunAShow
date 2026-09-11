import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  exportUserData,
  loadEncryptedShows,
  saveEncryptedShows,
  type EncryptedShowRow,
} from './secure-storage';
import { encryptWithKey } from './encryption';
import { DEFAULT_SETTINGS, type Show } from '../types';
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
  it('leaves unchanged and unreadable rows alone', async () => {
    const bad = { id: 'b', encryptedData: 'opaque-blob' };
    mockGet([row(show({ id: 'a' })), bad]);
    const loaded = await loadEncryptedShows(CREDS);
    const bodies = mockPut();
    await saveEncryptedShows(loaded.shows, CREDS, loaded.unreadable);
    expect(bodies).toEqual([]);
  });

  it('adds a new show without replacing the account list', async () => {
    mockGet([row(show({ id: 'a' }))]);
    const loaded = await loadEncryptedShows(CREDS);
    const bodies = mockPut();
    await saveEncryptedShows([...loaded.shows, show({ id: 'new' })], CREDS);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toHaveProperty('shows');
    expect(bodies[0].changes).toEqual([{ id: 'new', expectedHash: null, encryptedData: expect.any(String) }]);
  });

  it('deletes only a show the tab had actually loaded', async () => {
    mockGet([row(show({ id: 'a' }))]);
    await loadEncryptedShows(CREDS);
    const bodies = mockPut();
    await saveEncryptedShows([], CREDS);
    expect(bodies[0].changes).toEqual([{ id: 'a', expectedHash: expect.stringMatching(/^[a-f0-9]{64}$/), encryptedData: null }]);
    expect(bodies[0]).not.toHaveProperty('deleteAll');
  });

  it('does not advance the baseline when the server rejects an edit', async () => {
    mockGet([row(show({ id: 'a' }))]);
    const loaded = await loadEncryptedShows(CREDS);
    const changed = [{ ...loaded.shows[0], name: 'Edited' }];
    const sent: string[] = [];
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_path, init) => {
      sent.push(init.body);
      return Promise.resolve({ ok: false, status: 409, json: async () => ({ error: 'save_conflict' }) });
    }));
    await expect(saveEncryptedShows(changed, CREDS)).rejects.toThrow('save_conflict');
    await expect(saveEncryptedShows(changed, CREDS)).rejects.toThrow('save_conflict');
    expect(sent[0]).toBe(sent[1]);
  });
});

describe('exportUserData', () => {
  /** Both GET routes the export hits, with the show rows it should carry. */
  function mockExport(rows: EncryptedShowRow[]) {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((path: string) =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: async () =>
            path === '/api/shows' ? { shows: rows } : { encryptedData: null },
        } as Response),
      ),
    );
    const written: string[] = [];
    vi.stubGlobal('Blob', class {
      constructor(parts: string[]) {
        written.push(parts.join(''));
      }
    });
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x' });
    return written;
  }

  it('includes rows it could not read, as the ciphertext they are', async () => {
    // The backup file is the user's own copy of the account. Leaving rows out
    // of it silently is the one omission that really costs something.
    const bad: EncryptedShowRow = { id: 'b', encryptedData: 'not-ciphertext' };
    const written = mockExport([row(show({ id: 'a', name: 'Late Night' })), bad]);

    await exportUserData(CREDS);

    const backup = JSON.parse(written[0]);
    expect(backup.shows.map((s: Show) => s.name)).toEqual(['Late Night']);
    expect(backup.unreadableShows).toEqual([bad]);
  });

  it('exports unsaved on-screen edits without needing the network', async () => {
    const written = mockExport([]);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await exportUserData(CREDS, { shows: [show({ name: 'Unsaved work' })], unreadable: [], settings: DEFAULT_SETTINGS });
    expect(JSON.parse(written[0]).shows[0].name).toBe('Unsaved work');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('leaves the key out entirely when every row read cleanly', async () => {
    const written = mockExport([row(show({ id: 'a' }))]);

    await exportUserData(CREDS);

    expect(JSON.parse(written[0])).not.toHaveProperty('unreadableShows');
  });
});
