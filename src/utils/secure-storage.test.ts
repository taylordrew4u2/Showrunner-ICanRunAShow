import { afterEach, describe, expect, it, vi } from 'vitest';
import CryptoJS from 'crypto-js';
import {
  exportUserData,
  heldOverCurrentSettings,
  loadEncryptedSettings,
  saveEncryptedSettings,
  loadEncryptedShows,
  rebaseLoadedShows,
  countAsLoaded,
  saveEncryptedShows,
  settingsBaselineHash,
  settingsSentHashes,
  showBaselineHashes,
  showSentHashes,
  type EncryptedShowRow,
} from './secure-storage';
import { decryptWithKey, encryptWithKey } from './encryption';
import { recoverShowDraft } from './recoverShowDraft';
import { stripLegacyShowMedia } from './stripMedia';
import { completePastShows } from './showsOverview';
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

describe('a show the launch marked completed', () => {
  type Change = { id: string; expectedHash: string | null; encryptedData: string | null };

  /** One account's show rows, written under the same hash check the server makes. */
  function showServer(shows: Show[]) {
    const rows = new Map(shows.map((s) => [s.id, encryptWithKey(s, CREDS.key)]));
    const puts: Change[][] = [];
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_path: string, init: RequestInit) => {
      if (init.method === 'GET') {
        const all = [...rows].map(([id, encryptedData]) => ({ id, encryptedData }));
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ shows: all }) });
      }
      const { changes } = JSON.parse(init.body as string) as { changes: Change[] };
      puts.push(changes);
      for (const change of changes) {
        const current = rows.get(change.id) ?? null;
        if (current === change.encryptedData) continue;
        if ((current === null ? null : CryptoJS.SHA256(current).toString()) !== change.expectedHash) {
          return Promise.resolve({ ok: false, status: 409, json: async () => ({ error: 'save_conflict' }) });
        }
      }
      for (const change of changes) {
        if (change.encryptedData === null) rows.delete(change.id);
        else rows.set(change.id, change.encryptedData);
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
    }));
    return { puts, shows: () => [...rows.values()].map((cipher) => decryptWithKey<Show>(cipher, CREDS.key)) };
  }

  /** What a launch does with the rows it loads, as far as the saver can tell. */
  async function launch(creds: SessionCredentials): Promise<Show[]> {
    const loaded = await loadEncryptedShows(creds);
    rebaseLoadedShows(creds, loaded.shows);
    const completed = completePastShows(loaded.shows);
    countAsLoaded(creds, completed);
    return completed;
  }

  it('is not sent with an unrelated edit, so a second device that loaded it still saves', async () => {
    // Friday was never run through Run Show, so the account still has it as
    // upcoming. The laptop and then the phone open the app on Saturday, and
    // each marks it completed. The phone saves Friday's recap; the laptop then
    // renames next week's show. The laptop sent its own cipher of Friday's
    // completion with that rename, over the row it had loaded, and was refused
    // for the whole batch, the rename with it, until it reloaded.
    const server = showServer([
      show({ id: 'fri', name: 'Friday', date: '2020-05-01' }),
      show({ id: 'next', name: 'Next week', date: '2099-05-08' }),
    ]);
    const laptop = { ...CREDS };
    const phone = { ...CREDS };
    const onLaptop = await launch(laptop);
    const onPhone = await launch(phone);
    expect(onLaptop.map((s) => s.status)).toEqual(['completed', 'upcoming']);

    await saveEncryptedShows(onPhone.map((s) => (s.id === 'fri' ? { ...s, name: 'Friday, recap done' } : s)), phone);
    await saveEncryptedShows(onLaptop.map((s) => (s.id === 'next' ? { ...s, name: 'Next week, renamed' } : s)), laptop);

    expect(server.shows().map((s) => s.name)).toEqual(['Friday, recap done', 'Next week, renamed']);
  });

  it('is still sent, completion and all, once the show itself is edited', async () => {
    const server = showServer([show({ id: 'fri', name: 'Friday', date: '2020-05-01' })]);
    const creds = { ...CREDS };
    const shows = await launch(creds);

    await saveEncryptedShows(shows, creds);
    expect(server.puts).toEqual([]);
    await saveEncryptedShows([{ ...shows[0], name: 'Friday, recap done' }], creds);
    expect(server.shows()).toEqual([expect.objectContaining({ name: 'Friday, recap done', status: 'completed' })]);
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

describe('a copy held while this tab’s own save was still on its way', () => {
  // The held copy says what it was made over. That used to be only the
  // version the tab had loaded, and it moves when a save lands — so a copy
  // held mid-save carried the version from before, and when the page died
  // before its own save, the next launch read the tab's own landed save as
  // somebody else's. Shows came back twice; settings were parked with a
  // notice that another device had saved first.

  /** Every PUT waits until the test lets it through, then the server keeps what it sent. */
  function heldPuts() {
    const releases: (() => void)[] = [];
    const sent: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_path: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      return new Promise((resolve) => releases.push(() => {
        sent.push(body);
        resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
      }));
    }));
    return { releases, sent };
  }

  it('recovers the edited show over that save instead of forking it', async () => {
    const creds = { ...CREDS };
    mockGet([row(show({ id: 'a', name: 'Loaded' }))]);
    const loaded = await loadEncryptedShows(creds);
    const { releases, sent } = heldPuts();
    const first = { ...loaded.shows[0], name: 'First edit' };
    const saving = saveEncryptedShows([first], creds);
    const held = { draft: [{ ...first, name: 'Second edit' }], showHashes: showBaselineHashes(creds), showsSent: showSentHashes(creds) };
    releases[0]();
    await saving;

    // The page dies before the second edit is saved. The next launch:
    const changes = sent[0].changes as { id: string; encryptedData: string }[];
    mockGet(changes.map(({ id, encryptedData }) => ({ id, encryptedData })));
    const server = (await loadEncryptedShows({ ...CREDS })).shows;
    const recovered = recoverShowDraft(held.draft, server, held.showHashes, held.showsSent);
    expect(recovered.map((s) => s.name)).toEqual(['Second edit']);
  });

  it('recovers settings over that save, even one still queued when the copy was held', async () => {
    const creds = { ...CREDS };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ encryptedData: null }) }));
    await loadEncryptedSettings(creds);
    const { releases, sent } = heldPuts();
    const first = saveEncryptedSettings({ ...DEFAULT_SETTINGS, brandName: 'First' }, creds);
    const second = saveEncryptedSettings({ ...DEFAULT_SETTINGS, brandName: 'Second' }, creds);
    // A third edit is held now: the first save in flight, the second waiting its turn.
    const held = { settingsHash: settingsBaselineHash(creds), settingsSent: settingsSentHashes(creds) };
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    releases[0]();
    await first;
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases[1]();
    await second;

    const relaunch = { ...CREDS };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ encryptedData: sent[1].encryptedData }) }));
    await loadEncryptedSettings(relaunch);
    expect(heldOverCurrentSettings(held, relaunch)).toBe(true);
  });

  it('recovers settings held just before their own save, once the server has them', async () => {
    // The copy is written, then the save that sends it starts: the PUT lands
    // and the page is gone before it hears back. The server holds exactly the
    // held copy, which was then parked as edits "saved from somewhere else
    // first", with a notice saying so.
    const creds = { ...CREDS };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ encryptedData: null }) }));
    await loadEncryptedSettings(creds);
    const edited = { ...DEFAULT_SETTINGS, brandName: 'Held, then sent' };
    const held = { settingsHash: settingsBaselineHash(creds), settingsSent: settingsSentHashes(creds, edited) };
    const { releases, sent } = heldPuts();
    const saving = saveEncryptedSettings(edited, creds);
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    releases[0]();
    await saving;

    const relaunch = { ...CREDS };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ encryptedData: sent[0].encryptedData }) }));
    await loadEncryptedSettings(relaunch);
    expect(heldOverCurrentSettings(held, relaunch)).toBe(true);
  });

  it('still does not recover settings over a version its tab never sent', async () => {
    const creds = { ...CREDS };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ encryptedData: null }) }));
    await loadEncryptedSettings(creds);
    const held = { settingsHash: settingsBaselineHash(creds), settingsSent: settingsSentHashes(creds) };

    const relaunch = { ...CREDS };
    const elsewhere = encryptWithKey({ ...DEFAULT_SETTINGS, brandName: 'Saved on the laptop' }, CREDS.key);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ encryptedData: elsewhere }) }));
    await loadEncryptedSettings(relaunch);
    expect(heldOverCurrentSettings(held, relaunch)).toBe(false);
  });
});
