import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings, Show } from '../types';
import { DEFAULT_SETTINGS } from '../types';
import * as ids from '../utils/id';
import { loadReviewData, refreshReviewData, tidyReviewData } from './loadReviewData';
import { clone, fullSettings, fullShow } from './testFixtures';
import type { CoproducerClient, CoproducerRevisions, CoproducerShowPage } from './types';

afterEach(() => {
  vi.restoreAllMocks();
});

const FUTURE = '2099-05-01';

function show(id: string, over: Partial<Show> = {}): Show {
  const s = clone(fullShow({ id, name: `Show ${id}`, date: FUTURE, status: 'upcoming', ...over })) as Show;
  delete s.viewerKey;
  return s;
}

/** A fake co-producer client over a fake server: shows by id with revisions, and settings. */
function fakeServer(initial: Show[], settings: AppSettings | null, pageSize = 2) {
  const rows = new Map(initial.map((s) => [s.id, { show: s, revision: `r1-${s.id}` }]));
  const state = { settings, settingsRevision: settings ? 'rs1' : null as string | null, unreadable: new Set<string>() };
  const calls: string[] = [];
  const page = (list: string[]): CoproducerShowPage => ({
    shows: list.filter((id) => rows.has(id) && !state.unreadable.has(id)).map((id) => clone(rows.get(id)!)),
    next: null,
    unreadable: list.filter((id) => state.unreadable.has(id)).length,
  });
  const client: Partial<CoproducerClient> = {
    showsPage: async (after) => {
      calls.push(`page:${after ?? ''}`);
      const all = [...rows.keys()].sort();
      const from = after ? all.indexOf(after) + 1 : 0;
      const taken = all.slice(from, from + pageSize);
      const more = from + pageSize < all.length;
      return { ...page(taken), next: more ? taken[taken.length - 1] : null };
    },
    showsByIds: async (list) => {
      calls.push(`ids:${list.join(',')}`);
      return page(list);
    },
    revisions: async (): Promise<CoproducerRevisions> => {
      calls.push('revisions');
      return { shows: [...rows.values()].map((r) => ({ id: r.show.id, revision: r.revision })), settings: state.settingsRevision };
    },
    settings: async () => {
      calls.push('settings');
      return { settings: clone(state.settings), revision: state.settingsRevision };
    },
  };
  return {
    client: client as CoproducerClient,
    calls,
    put(s: Show) {
      const prior = rows.get(s.id);
      rows.set(s.id, { show: s, revision: `${prior ? 'r' + (Number(prior.revision[1]) + 1) : 'r1'}-${s.id}` });
    },
    remove(id: string) {
      rows.delete(id);
    },
    setSettings(next: AppSettings) {
      state.settings = next;
      state.settingsRevision = `rs${Math.random()}`;
    },
    unreadable: state.unreadable,
  };
}

describe('loadReviewData', () => {
  it('reads every page and the settings, tidied as the owner’s load tidies, generating no id', async () => {
    const spy = vi.spyOn(ids, 'generateId');
    const settings = clone(fullSettings()) as AppSettings;
    const shows = [show('a'), show('b'), show('c', { date: '2001-01-01', status: 'upcoming' })];
    const server = fakeServer(shows, settings);
    const loaded = await loadReviewData(server.client);
    expect(server.calls).toEqual(['page:', 'page:b', 'settings']);
    const expected = tidyReviewData(shows, settings);
    expect(loaded.shows).toEqual(expected.shows);
    expect(loaded.settings).toEqual(expected.settings);
    expect(loaded.shows.find((s) => s.id === 'c')!.status).toBe('completed');
    expect(loaded.showRevisions).toEqual({ a: 'r1-a', b: 'r1-b', c: 'r1-c' });
    expect(loaded.settingsRevision).toBe('rs1');
    expect(loaded.unreadable).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it('starts an account never saved past onboarding', async () => {
    const loaded = await loadReviewData(fakeServer([], null).client);
    expect(loaded.settings).toEqual({ ...DEFAULT_SETTINGS, onboarded: true, expenses: [] });
    expect(loaded.settingsRevision).toBeNull();
  });

  it('counts what could not be opened', async () => {
    const server = fakeServer([show('a'), show('b')], fullSettings());
    server.unreadable.add('b');
    expect((await loadReviewData(server.client)).unreadable).toBe(1);
  });
});

describe('tidyReviewData', () => {
  it('moves per-show expenses to the account, ids kept, and leaves the served copies alone', () => {
    const shows = [show('a', { expenses: [{ id: 'e1', category: 'x', itemName: 'Mic', cost: 5, date: '' }] }), show('b', { expenses: undefined })];
    const settings = clone(fullSettings()) as AppSettings;
    const before = clone(shows);
    const tidied = tidyReviewData(shows, settings);
    expect(tidied.settings.expenses.map((e) => e.id)).toEqual(['ge1', 'e1']);
    expect(tidied.shows.every((s) => s.expenses?.length === 0)).toBe(true);
    expect(shows).toEqual(before);
  });
});

describe('refreshReviewData', () => {
  it('is null when nothing moved, and asks for nothing but revisions', async () => {
    const server = fakeServer([show('a'), show('b')], fullSettings());
    const loaded = await loadReviewData(server.client);
    server.calls.length = 0;
    expect(await refreshReviewData(server.client, loaded)).toBeNull();
    expect(server.calls).toEqual(['revisions']);
  });

  it('fetches only the shows that moved, drops the gone, adds the new, and settings when theirs moved', async () => {
    const server = fakeServer([show('a'), show('b'), show('c')], fullSettings());
    const loaded = await loadReviewData(server.client);
    server.calls.length = 0;
    server.put(show('b', { venueName: 'Elsewhere' }));
    server.remove('c');
    server.put(show('d'));
    server.setSettings({ ...fullSettings(), brandName: 'Renamed' });
    const next = (await refreshReviewData(server.client, loaded))!;
    expect(server.calls).toEqual(['revisions', 'ids:b,d', 'settings']);
    expect(next.shows.map((s) => s.id).sort()).toEqual(['a', 'b', 'd']);
    expect(next.shows.find((s) => s.id === 'b')!.venueName).toBe('Elsewhere');
    expect(next.showRevisions).toEqual({ a: 'r1-a', b: 'r2-b', d: 'r1-d' });
    expect(next.settings.brandName).toBe('Renamed');
  });

  it('asks again for an unreadable show only once it changes', async () => {
    const server = fakeServer([show('a'), show('b')], fullSettings());
    server.unreadable.add('b');
    const loaded = await loadReviewData(server.client);
    const first = (await refreshReviewData(server.client, loaded))!;
    expect(first.unreadable).toBe(1);
    server.calls.length = 0;
    expect(await refreshReviewData(server.client, first)).toBeNull();
    expect(server.calls).toEqual(['revisions']);
  });
});
