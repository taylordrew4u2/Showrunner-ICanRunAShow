import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadEncryptedShows, saveEncryptedShows } from './secure-storage';
import { encryptWithKey } from './encryption';
import type { SessionCredentials } from './session-vault';
import type { Show } from '../types';

const credentials = (): SessionCredentials => ({
  username: 'producer', userId: 'producer', authHash: 'auth', key: 'data-key', legacyKey: 'old-key',
});

const show = (id: string): Show => ({
  id, name: `Comedy ${id}`, date: '2026-12-04', time: '20:00', location: 'Chicago',
  venueName: 'The Cellar', status: 'upcoming', artists: [], schedule: [], hosts: [],
  djSongs: [], staff: [], expenses: [], createdAt: '', updatedAt: '',
  productionNotes: 'Private production note', host: 'Hidden Guest Identity',
  performers: [
    { id: 'zoe', name: 'Zoe Public', credits: 'Public credit', email: 'private@example.test', notes: 'Private booking note' },
    { id: 'hidden', name: 'Hidden Guest Identity', credits: 'Hidden guest credit', surpriseGuest: true },
    { id: 'ada', name: 'Ada Public' },
  ],
});

function mockLoad(values: Show[], creds: SessionCredentials, selected?: string[]) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
    shows: values.map(value => ({ id: value.id, encryptedData: encryptWithKey(value, creds.key) })),
    ...(selected === undefined ? {} : { websiteLineupShowIds: selected }),
  }), { status: 200, headers: { 'content-type': 'application/json' } })));
}

function mockSave() {
  const bodies: { changes: Record<string, unknown>[] }[] = [];
  vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return Promise.resolve(Response.json({ ok: true }));
  }));
  return bodies;
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('explicit browser website publication', () => {
  it('sends only a redacted bill for approved shows while other changes stay encrypted', async () => {
    const creds = credentials();
    mockLoad([show('published'), show('private')], creds, ['published']);
    const loaded = await loadEncryptedShows(creds);
    const bodies = mockSave();
    await saveEncryptedShows(loaded.shows.map(value => ({ ...value, time: '21:00' })), creds);
    const changes = bodies.flatMap(body => body.changes);
    const published = changes.find(change => change.id === 'published')!;
    const privateShow = changes.find(change => change.id === 'private')!;
    expect(published.websiteLineup).toMatchObject({
      id: 'published', time: '21:00',
      lineup: [{ id: 'zoe', name: 'Zoe Public', credits: 'Public credit' }, { id: 'ada', name: 'Ada Public' }],
    });
    expect(privateShow).not.toHaveProperty('websiteLineup');
    const sent = JSON.stringify(bodies);
    for (const secret of ['private@example.test', 'Private production note', 'Private booking note', 'Hidden Guest Identity', 'Hidden guest credit']) {
      expect(sent).not.toContain(secret);
    }
    expect(changes.every(change => typeof change.encryptedData === 'string')).toBe(true);
  });

  it('sends no public plaintext when the authenticated load declares no website selection', async () => {
    const creds = credentials();
    mockLoad([show('private')], creds);
    const loaded = await loadEncryptedShows(creds);
    const bodies = mockSave();
    await saveEncryptedShows(loaded.shows.map(value => ({ ...value, time: '21:00' })), creds);
    expect(bodies.flatMap(body => body.changes)).toHaveLength(1);
    expect(bodies[0].changes[0]).not.toHaveProperty('websiteLineup');
    expect(JSON.stringify(bodies)).not.toContain('Zoe Public');
  });

  it('stops sending public plaintext after a later load removes the selected IDs', async () => {
    const creds = credentials();
    mockLoad([show('published')], creds, ['published']);
    await loadEncryptedShows(creds);
    mockLoad([show('published')], creds);
    const loaded = await loadEncryptedShows(creds);
    const bodies = mockSave();
    await saveEncryptedShows(loaded.shows.map(value => ({ ...value, time: '21:00' })), creds);
    expect(bodies[0].changes[0]).not.toHaveProperty('websiteLineup');
  });

  it('deletes an approved show without attaching its previous public bill', async () => {
    const creds = credentials();
    mockLoad([show('published')], creds, ['published']);
    await loadEncryptedShows(creds);
    const bodies = mockSave();
    await saveEncryptedShows([], creds);
    expect(bodies[0].changes[0]).toMatchObject({ id: 'published', encryptedData: null });
    expect(bodies[0].changes[0]).not.toHaveProperty('websiteLineup');
  });
});
