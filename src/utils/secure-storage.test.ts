import { afterEach, describe, expect, it, vi } from 'vitest';
import CryptoJS from 'crypto-js';
import {
  exportUserData,
  loadEncryptedSettings,
  saveEncryptedSettings,
  loadEncryptedShows,
  rebaseLoadedShows,
  saveEncryptedShows,
  showBaselineHashes,
  type EncryptedShowRow,
} from './secure-storage';
import { encryptWithKey } from './encryption';
import { stripLegacyShowMedia } from './stripMedia';
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

  it('keeps the version a re-read for a scan found, out of the next save', async () => {
    // The unused-files sweep re-reads the account so it judges against what
    // the server holds now, not what this tab loaded hours ago. That re-read
    // must not become the baseline the saver compares against: the tab's list
    // does not have the show another device added since, and a save measured
    // against the fresh rows would send that show's deletion.
    mockGet([row(show({ id: 'a' }))]);
    const loaded = await loadEncryptedShows(CREDS);
    mockGet([row(show({ id: 'a' })), row(show({ id: 'b', name: 'Added on the phone' }))]);
    const fresh = await loadEncryptedShows(CREDS, false);
    expect(fresh.shows.map((s) => s.id)).toEqual(['a', 'b']);

    const bodies = mockPut();
    await saveEncryptedShows([{ ...loaded.shows[0], name: 'Edited here' }], CREDS);

    expect(bodies).toHaveLength(1);
    expect((bodies[0].changes as { id: string }[]).map((c) => c.id)).toEqual(['a']);
  });

  it('measures the held copy against the show as the app migrated it, not the row as stored', async () => {
    // A row the server still holds with an embedded flyer is stripped in
    // place on load. The draft written for an offline edit carried the hash
    // of the row before stripping, so on the next launch the stripped server
    // copy never matched it and the edit came back as a "(recovered edits)"
    // twin of the show.
    const legacy = { ...show({ id: 'a', name: 'Legacy Night' }), flyer: 'data:image/png;base64,AAAA' };
    mockGet([{ id: 'a', encryptedData: encryptWithKey(legacy, CREDS.key) }]);
    const loaded = await loadEncryptedShows(CREDS);
    const stripped = stripLegacyShowMedia(loaded.shows[0]);
    rebaseLoadedShows(CREDS, [stripped]);

    expect(showBaselineHashes(CREDS).a).toBe(CryptoJS.SHA256(JSON.stringify(stripped)).toString());
  });

  it('carries on after a save whose answer was lost, once the producer has edited again', async () => {
    // Venue wifi: the first save reaches the server but its answer does not
    // reach the tab. The show is edited again before the retry, so the retry
    // carries a different cipher against the version this tab loaded — and
    // the server, holding the first cipher, called that a conflict. Nobody
    // else wrote; the server has exactly what this tab sent it.
    mockGet([row(show({ id: 'a' }))]);
    const loaded = await loadEncryptedShows(CREDS);
    const sent: Record<string, unknown>[] = [];
    let lost: string | undefined;
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_path: string, init: RequestInit) => {
      if (init.method === 'GET') {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ shows: [{ id: 'a', encryptedData: lost }] }) });
      }
      const body = JSON.parse(init.body as string);
      sent.push(body);
      if (sent.length === 1) {
        lost = body.changes[0].encryptedData;
        return Promise.reject(new Error('The operation was aborted'));
      }
      if (sent.length === 2) return Promise.resolve({ ok: false, status: 409, json: async () => ({ error: 'save_conflict' }) });
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
    }));

    await expect(saveEncryptedShows([{ ...loaded.shows[0], name: 'First edit' }], CREDS)).rejects.toThrow('aborted');
    await saveEncryptedShows([{ ...loaded.shows[0], name: 'Second edit' }], CREDS);

    expect(sent).toHaveLength(3);
    expect(sent[2].changes).toEqual([{ id: 'a', expectedHash: CryptoJS.SHA256(lost!).toString(), encryptedData: expect.any(String) }]);
    expect(sent[1].changes).not.toEqual(sent[2].changes);
  });

  it('still reports a conflict when the server holds a version this tab never sent', async () => {
    mockGet([row(show({ id: 'a' }))]);
    const loaded = await loadEncryptedShows(CREDS);
    const elsewhere = row(show({ id: 'a', name: 'Edited on the laptop' }));
    let puts = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_path: string, init: RequestInit) => {
      if (init.method === 'GET') return Promise.resolve({ ok: true, status: 200, json: async () => ({ shows: [elsewhere] }) });
      puts++;
      return Promise.resolve({ ok: false, status: 409, json: async () => ({ error: 'save_conflict' }) });
    }));
    await expect(saveEncryptedShows([{ ...loaded.shows[0], name: 'Edited here' }], CREDS)).rejects.toThrow('save_conflict');
    expect(puts).toBe(1);
  });

  it('does not advance the baseline when the server rejects an edit', async () => {
    mockGet([row(show({ id: 'a' }))]);
    const loaded = await loadEncryptedShows(CREDS);
    const changed = [{ ...loaded.shows[0], name: 'Edited' }];
    const sent: string[] = [];
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_path, init) => {
      if (init.method === 'PUT') sent.push(init.body);
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


describe('settings save protection', () => {
  it('will not replace settings that it could not decrypt', async () => {
    const creds = { ...CREDS };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200,
      json: async () => ({ encryptedData: 'unreadable' }) }));
    await expect(loadEncryptedSettings(creds)).rejects.toThrow('could not be decrypted');
    await expect(saveEncryptedSettings(DEFAULT_SETTINGS, creds)).rejects.toThrow('Load settings');
  });

  it('queues same-tab saves using the version confirmed by the previous write', async () => {
    const creds = { ...CREDS };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ encryptedData: null }) }));
    await loadEncryptedSettings(creds);
    const bodies = mockPut();
    await Promise.all([
      saveEncryptedSettings({ ...DEFAULT_SETTINGS, brandName: 'First' }, creds),
      saveEncryptedSettings({ ...DEFAULT_SETTINGS, brandName: 'Second' }, creds),
    ]);
    expect(bodies[0].expectedHash).toBe(null);
    expect(bodies[1].expectedHash).toMatch(/^[a-f0-9]{64}$/);
    expect(bodies).toHaveLength(2);
  });

  it('carries on after a settings save whose answer was lost, once the Rolodex has changed again', async () => {
    const creds = { ...CREDS };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ encryptedData: null }) }));
    await loadEncryptedSettings(creds);
    const sent: Record<string, unknown>[] = [];
    let lost: string | undefined;
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_path: string, init: RequestInit) => {
      if (init.method === 'GET') return Promise.resolve({ ok: true, status: 200, json: async () => ({ encryptedData: lost }) });
      const body = JSON.parse(init.body as string);
      sent.push(body);
      if (sent.length === 1) {
        lost = body.encryptedData as string;
        return Promise.reject(new Error('The operation was aborted'));
      }
      if (sent.length === 2) return Promise.resolve({ ok: false, status: 409, json: async () => ({ error: 'save_conflict' }) });
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
    }));

    await expect(saveEncryptedSettings({ ...DEFAULT_SETTINGS, brandName: 'First' }, creds)).rejects.toThrow('aborted');
    await saveEncryptedSettings({ ...DEFAULT_SETTINGS, brandName: 'Second' }, creds);

    expect(sent).toHaveLength(3);
    expect(sent[2].expectedHash).toBe(CryptoJS.SHA256(lost!).toString());
  });

  it('refuses a 200 response that does not actually acknowledge the write', async () => {
    const creds = { ...CREDS };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ encryptedData: null }) }));
    await loadEncryptedSettings(creds);
    await expect(saveEncryptedSettings(DEFAULT_SETTINGS, creds)).rejects.toThrow('did not confirm');
  });
});
