import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CryptoJS from 'crypto-js';
import type { Show } from '../types';
import type { SessionCredentials } from './session-vault';
import { encryptWithKey } from './encryption';

const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), review: false }));
vi.mock('./api', () => ({ api: { get: mocks.get, put: mocks.put } }));
vi.mock('../coproducer/reviewMode', () => ({
  isReviewMode: () => mocks.review,
  ReviewModeBlockedError: class extends Error {},
}));

import {
  loadEncryptedShows, reconcileWebsiteLineups, saveEncryptedShows,
  showBaselineHashes, showSentHashes, type EncryptedShowRow,
} from './secure-storage';

function credentials(): SessionCredentials {
  return { username: 'producer', userId: 'owner', authHash: 'account-auth-secret',
    key: 'current-data-key', legacyKey: 'legacy-data-key' };
}

function show(id: string, overrides: Partial<Show> = {}): Show {
  return {
    id, name: 'Comedy ' + id, date: '2026-12-03', time: 'Doors 8:30 Show 9:00pm',
    location: '792 Onderdonk Ave, Ridgewood', venueName: 'Pixelated Records',
    status: 'upcoming', artists: [], schedule: [], hosts: [], djSongs: [], staff: [],
    expenses: [], createdAt: '', updatedAt: '', productionNotes: 'Private production notes',
    host: 'Taylor Public', hostSocial: '@taylorpublic',
    coHost: 'Hidden Guest', coHostSocial: '@secretguest',
    performers: [
      { id: 'one', name: 'Zoe Public', credits: 'Public credit',
        email: 'private@example.test', phone: 'private phone', notes: 'Private booking notes' },
      { id: 'secret', name: 'Hidden Guest', credits: 'Hidden credit', surpriseGuest: true },
      { id: 'two', name: 'Ada Public' },
    ],
    ...overrides,
  };
}

function row(value: Show, creds: SessionCredentials, key = creds.key): EncryptedShowRow {
  return { id: value.id, encryptedData: encryptWithKey(value, key) };
}

function reply(rows: EncryptedShowRow[], selected = rows.map(value => value.id)) {
  return { shows: rows, websiteLineupShowIds: selected };
}

function defer<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  mocks.get.mockReset();
  mocks.put.mockReset();
  mocks.review = false;
  mocks.put.mockImplementation((_path, body) => Promise.resolve({
    ok: true, updatedIds: body.shows.map((item: { id: string }) => item.id), unchangedIds: [],
  }));
});
afterEach(() => { vi.restoreAllMocks(); });

describe('automatic public lineup reconciliation', () => {
  it('publishes only fresh approved readable sources using normal owner auth and exact cipher revisions', async () => {
    const creds = credentials();
    const selected = row(show('approved'), creds);
    const outside = row(show('private'), creds);
    const mismatched = { id: 'mismatch', encryptedData: encryptWithKey(show('different-id'), creds.key) };
    const unreadable = { id: 'unreadable', encryptedData: 'unreadable ciphertext' };
    const rows = [selected, outside, mismatched, unreadable];
    const before = structuredClone(rows);
    rows.forEach(Object.freeze);
    mocks.get.mockResolvedValue(reply(rows, ['approved', 'mismatch', 'unreadable']));

    const result = await reconcileWebsiteLineups(creds, { stillCurrent: () => true });

    expect(result).toEqual({ status: 'reconciled', updated: 1, unchanged: 0, unreadable: 2 });
    expect(mocks.get).toHaveBeenCalledWith('/api/shows?websiteLineups=1', {
      authUserId: creds.userId, authHash: creds.authHash,
    });
    expect(mocks.put).toHaveBeenCalledTimes(1);
    const [path, body, auth] = mocks.put.mock.calls[0];
    expect(path).toBe('/api/website-lineups');
    expect(auth).toEqual({ authUserId: creds.userId, authHash: creds.authHash });
    expect(auth).not.toHaveProperty('bearer');
    expect(body.shows).toHaveLength(1);
    expect(body.shows[0]).toMatchObject({
      id: 'approved', revision: CryptoJS.SHA256(selected.encryptedData).toString(),
      lineup: [{ id: 'one', name: 'Zoe Public', credits: 'Public credit' },
        { id: 'two', name: 'Ada Public' }],
      hosts: [{ name: 'Taylor Public' }],
    });
    const sent = JSON.stringify(body);
    for (const privateValue of ['Private production notes', 'private@example.test',
      'private phone', 'Private booking notes', 'Hidden Guest', 'Hidden credit',
      '@secretguest', creds.key, creds.legacyKey, creds.authHash]) {
      expect(sent).not.toContain(privateValue);
    }
    expect(body.shows[0]).not.toHaveProperty('encryptedData');
    expect(rows).toEqual(before);
  });

  it('does not use editing baselines, website selection, cipher caches or sent-write memory as publication state', async () => {
    const creds = credentials();
    const original = row(show('original'), creds);
    mocks.get.mockResolvedValueOnce(reply([original], ['original']));
    const loaded = await loadEncryptedShows(creds);
    const baseline = showBaselineHashes(creds);
    const sent = showSentHashes(creds);
    const freshOriginal = row(show('original', { name: 'Changed on another device' }), creds);
    const newSource = row(show('new-source'), creds);
    mocks.get.mockResolvedValueOnce(reply([freshOriginal, newSource], ['new-source']));

    await reconcileWebsiteLineups(creds);

    expect(showBaselineHashes(creds)).toEqual(baseline);
    expect(showSentHashes(creds)).toEqual(sent);
    expect(mocks.put.mock.calls[0][1].shows.map((value: { id: string }) => value.id)).toEqual(['new-source']);
    const countAfterProjection = mocks.put.mock.calls.length;
    await saveEncryptedShows(loaded.shows, creds);
    expect(mocks.put).toHaveBeenCalledTimes(countAfterProjection);

    // The ordinary save still uses the selection from the actual private load.
    mocks.put.mockResolvedValue({ ok: true });
    await saveEncryptedShows(loaded.shows.map(value => ({ ...value, time: '21:00' })), creds);
    expect(mocks.put.mock.calls.at(-1)?.[0]).toBe('/api/shows');
    expect(mocks.put.mock.calls.at(-1)?.[1].changes[0].websiteLineup.id).toBe('original');
  });

  it('uses the legacy data key for an approved older source without exposing it', async () => {
    const creds = credentials();
    const legacy = row(show('legacy'), creds, creds.legacyKey);
    mocks.get.mockResolvedValue(reply([legacy]));
    expect((await reconcileWebsiteLineups(creds)).status).toBe('reconciled');
    expect(mocks.put.mock.calls[0][1].shows[0].revision)
      .toBe(CryptoJS.SHA256(legacy.encryptedData).toString());
  });

  it('skips co-producer view, stand-in credentials and obsolete lifecycle calls without any request', async () => {
    const creds = credentials();
    mocks.review = true;
    expect(await reconcileWebsiteLineups(creds)).toEqual({ status: 'skipped', reason: 'review_mode' });
    mocks.review = false;
    expect(await reconcileWebsiteLineups({ ...creds, userId: '', authHash: '', key: '', legacyKey: '' }))
      .toEqual({ status: 'skipped', reason: 'missing_credentials' });
    expect(await reconcileWebsiteLineups(creds, { stillCurrent: () => false }))
      .toEqual({ status: 'skipped', reason: 'stale_session' });
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it('will not publish after the owner session changes while its fresh read is in flight', async () => {
    const creds = credentials();
    let current = true;
    const pending = defer<ReturnType<typeof reply>>();
    mocks.get.mockReturnValue(pending.promise);
    const result = reconcileWebsiteLineups(creds, { stillCurrent: () => current });
    current = false;
    pending.resolve(reply([row(show('approved'), creds)]));
    expect(await result).toEqual({ status: 'skipped', reason: 'stale_session' });
    expect(mocks.put).not.toHaveBeenCalled();

    current = true;
    mocks.get.mockResolvedValue(reply([row(show('approved'), creds)]));
    expect((await reconcileWebsiteLineups(creds, { stillCurrent: () => current })).status).toBe('reconciled');
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });

  it('stops publication when review mode starts or credentials change during the fresh read', async () => {
    for (const change of ['review', 'credentials']) {
      const creds = credentials();
      const pending = defer<ReturnType<typeof reply>>();
      mocks.get.mockReturnValue(pending.promise);
      const result = reconcileWebsiteLineups(creds);
      if (change === 'review') mocks.review = true;
      else creds.authHash = 'replacement-session';
      pending.resolve(reply([row(show('approved'), creds)]));
      expect((await result).status).toBe('skipped');
      mocks.review = false;
    }
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it('returns an obsolete result quietly if the session ends after the authorized PUT began', async () => {
    const creds = credentials();
    let current = true;
    const pending = defer<{ ok: boolean; updatedIds: string[]; unchangedIds: string[] }>();
    mocks.get.mockResolvedValue(reply([row(show('approved'), creds)]));
    mocks.put.mockReturnValue(pending.promise);
    const result = reconcileWebsiteLineups(creds, { stillCurrent: () => current });
    await vi.waitFor(() => expect(mocks.put).toHaveBeenCalledTimes(1));
    current = false;
    pending.resolve({ ok: true, updatedIds: ['approved'], unchangedIds: [] });
    expect(await result).toEqual({ status: 'skipped', reason: 'stale_session' });
    expect(showBaselineHashes(creds)).toEqual({});
    expect(showSentHashes(creds)).toEqual({});
  });

  it('coalesces overlapping calls and deduplicates rapid resume/load triggers for the same credentials', async () => {
    const creds = credentials();
    const pending = defer<ReturnType<typeof reply>>();
    mocks.get.mockReturnValue(pending.promise);
    const first = reconcileWebsiteLineups(creds, { stillCurrent: () => true });
    const second = reconcileWebsiteLineups(creds, { stillCurrent: () => true });
    expect(second).toBe(first);
    pending.resolve(reply([row(show('approved'), creds)]));
    expect(await first).toEqual(await second);
    expect((await reconcileWebsiteLineups(creds)).status).toBe('reconciled');
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.put).toHaveBeenCalledTimes(1);
  });

  it('returns bounded-retry information without throwing, and a later retry always reads fresh ciphertext', async () => {
    const creds = credentials();
    let now = 10000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const first = row(show('approved'), creds);
    const changed = row(show('approved', { name: 'A fresh remote edit' }), creds);
    mocks.get.mockResolvedValueOnce(reply([first])).mockResolvedValueOnce(reply([changed]));
    mocks.put.mockRejectedValueOnce({ status: 409 });
    expect(await reconcileWebsiteLineups(creds)).toEqual({
      status: 'failed', retryable: true, statusCode: 409,
    });
    expect((await reconcileWebsiteLineups(creds)).status).toBe('failed');
    expect(mocks.get).toHaveBeenCalledTimes(1);
    now += 3000;
    expect((await reconcileWebsiteLineups(creds)).status).toBe('reconciled');
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(mocks.put.mock.calls[1][1].shows[0].revision)
      .toBe(CryptoJS.SHA256(changed.encryptedData).toString());
    expect(mocks.put.mock.calls[1][1].shows[0].name).toBe('A fresh remote edit');
  });

  it('does not publish without explicit selection or with no readable selected rows', async () => {
    const creds = credentials();
    mocks.get.mockResolvedValue({ shows: [row(show('private'), creds)] });
    expect(await reconcileWebsiteLineups(creds)).toEqual({
      status: 'skipped', reason: 'nothing_selected',
    });
    const another = credentials();
    mocks.get.mockResolvedValue(reply([{ id: 'bad', encryptedData: 'bad' }]));
    expect(await reconcileWebsiteLineups(another)).toEqual({
      status: 'skipped', reason: 'no_readable_shows', unreadable: 1,
    });
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it('does not retry an authorization refusal or let publication failure reject private loading', async () => {
    const creds = credentials();
    mocks.get.mockRejectedValue({ status: 403 });
    await expect(reconcileWebsiteLineups(creds)).resolves.toEqual({
      status: 'failed', retryable: false, statusCode: 403,
    });
    expect(mocks.put).not.toHaveBeenCalled();
  });
});
