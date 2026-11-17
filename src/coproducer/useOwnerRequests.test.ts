import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings, Show } from '../types';
import { encryptWithKey } from '../utils/encryption';
import type { SessionCredentials } from '../utils/session-vault';
import type { AppliedPlan } from './applyRequest';
import { buildOutline } from './outline';
import { buildPseudonymIndex, viewOfShow } from './redaction';
import { fullSettings, fullShow } from './testFixtures';
import type { DecideBody, DecideManyBody, EditPayload, OwnerRequestDetail, OwnerRequestRow, RequestPayload } from './types';
import { createOwnerInbox, INBOX_TEXT, readOutline, type InboxClient, type InboxSnapshot, type OwnerDataApi } from './useOwnerRequests';

const session: SessionCredentials = { username: 'producer', userId: 'u1', authHash: 'auth', key: 'a'.repeat(64), legacyKey: 'b'.repeat(64) };

interface Stored { row: OwnerRequestRow; payload: string }

function fakeServer() {
  const requests = new Map<string, Stored>();
  const decided: DecideBody[] = [];
  const decidedMany: DecideManyBody[] = [];
  let failDecide: number | null = null;
  const client: InboxClient = {
    inboxCount: vi.fn(async () => ({ open: [...requests.values()].filter((r) => r.row.status === 'pending' || r.row.status === 'stale').length, links: 1 })),
    listInbox: vi.fn(async (_s, status) => ({
      requests: status === 'open' ? [...requests.values()].filter((r) => r.row.status === 'pending' || r.row.status === 'stale').map((r) => r.row) : [],
      next: null,
    })),
    getInboxRequest: vi.fn(async (_s, id: string) => {
      const stored = requests.get(id)!;
      return { ...stored.row, payload: stored.payload, result: null } as OwnerRequestDetail;
    }),
    listCoproducerLinks: vi.fn(async () => [{ id: 'link1', labelCipher: encryptWithKey('Sam Rivera', session.key), createdAt: '', expiresAt: '', firstUsedAt: null, lastUsedAt: null, openRequests: 0, storageBytes: 0, handouts: 0 }]),
    adoptMedia: vi.fn(async () => {}),
    decide: vi.fn(async (_s, body: DecideBody) => {
      if (failDecide !== null) throw Object.assign(new Error('no'), failDecide ? { status: failDecide } : {});
      decided.push(body);
      const stored = requests.get(body.id)!;
      stored.row = { ...stored.row, status: body.decision };
      return stored.row;
    }),
    decideMany: vi.fn(async (_s, body: DecideManyBody) => {
      decidedMany.push(body);
      return body.ids.filter((id) => requests.get(id)?.row.status === 'pending');
    }),
  };
  let n = 0;
  return {
    client,
    decided,
    decidedMany,
    failDecideWith(status: number | null) {
      failDecide = status;
    },
    add(payload: RequestPayload | { raw: string; kind: OwnerRequestRow['kind'] }, outline?: string) {
      n += 1;
      const id = `req${n}`;
      const isRaw = 'raw' in payload;
      const row: OwnerRequestRow = {
        id,
        linkId: 'link1',
        kind: payload.kind,
        status: 'pending',
        createdAt: `2026-09-0${n}T10:00:00.000Z`,
        decidedAt: null,
        usedAt: null,
        outline: outline ?? (isRaw ? encryptWithKey({ kind: payload.kind, shows: [] }, session.key) : encryptWithKey(buildOutline(payload), session.key)),
        mediaIds: [],
        bytes: 1,
      };
      requests.set(id, { row, payload: isRaw ? payload.raw : encryptWithKey(payload, session.key) });
      return id;
    },
  };
}

function owner(shows: Show[], settings: AppSettings = fullSettings()) {
  const state = { shows, settings, blocked: false };
  const commits: AppliedPlan[] = [];
  const data: OwnerDataApi = {
    session,
    shows: () => state.shows,
    settings: () => state.settings,
    loaded: () => true,
    producerLocked: false,
    syncBlocked: () => state.blocked,
    commit: vi.fn(async (plan: AppliedPlan) => {
      commits.push(plan);
      const after = new Map(plan.after.shows.map((s) => [s.id, s]));
      const upsert = new Set(plan.upsert);
      const remove = new Set(plan.remove);
      state.shows = state.shows.filter((s) => !remove.has(s.id)).map((s) => (upsert.has(s.id) ? after.get(s.id)! : s));
      if (plan.settingsChanged) state.settings = plan.after.settings;
      return { keptLinks: [] };
    }),
    commitShare: vi.fn(),
    withdrawHandout: vi.fn(async () => ({ withdrawn: 0, skipped: [] })),
    openShow: vi.fn(),
  };
  return { state, data, commits };
}

async function venueEdit(show: Show, venueName: string): Promise<EditPayload> {
  const index = await buildPseudonymIndex({ shows: [show], settings: fullSettings() });
  const view = viewOfShow(show, index);
  return {
    kind: 'edit',
    shows: [{ target: 'show', op: 'update', showId: show.id, baseRevision: null, keys: ['venueName'], base: { venueName: view.venueName }, proposed: { venueName } }],
    settings: null,
  };
}

function inboxFor(server: ReturnType<typeof fakeServer>, data: OwnerDataApi) {
  let last: InboxSnapshot | null = null;
  const inbox = createOwnerInbox(() => data, (snapshot) => { last = snapshot; }, server.client);
  return { inbox, latest: () => last ?? inbox.snapshot() };
}

beforeEach(() => {
  vi.stubGlobal('location', { origin: 'https://icanrunashow.com', protocol: 'https:', hostname: 'icanrunashow.com' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the owner inbox', () => {
  it('lists each request with a headline from the owner’s data and the co-producer’s name', async () => {
    const show = fullShow();
    const server = fakeServer();
    server.add(await venueEdit(show, 'The Attic'));
    server.add({ kind: 'download', action: { type: 'flyer', showId: 'show1' } });
    const { data } = owner([show]);
    const { inbox, latest } = inboxFor(server, data);
    await inbox.load();
    const items = latest().items;
    expect(items.map((item) => [item.who, item.headline, item.detail])).toEqual([
      ['Sam Rivera', 'change “Friday Laughs”', 'ready'],
      ['Sam Rivera', 'download the flyer for “Friday Laughs”', 'ready'],
    ]);
    expect(items[0].plan?.ok).toBe(true);
    expect(latest().busy).toBe(false);
  });

  it('one unreadable outline or payload leaves the other items working', async () => {
    const show = fullShow();
    const server = fakeServer();
    server.add({ raw: 'not ciphertext', kind: 'edit' }, 'not an outline');
    const hostile = await venueEdit(show, 'x');
    (hostile.shows[0] as { proposed: Record<string, unknown> }).proposed = { recap: { attendance: '<svg onload=alert(1)>' } };
    (hostile.shows[0] as { keys: string[] }).keys = ['recap'];
    server.add({ raw: encryptWithKey(hostile, session.key), kind: 'edit' });
    server.add({ raw: encryptWithKey({ kind: 'edit', shows: [], settings: { target: 'settings', baseRevision: null, fields: [{ field: 'deletedShowIds', kind: 'value', base: [], proposed: ['show1'] }] } }, session.key), kind: 'edit' });
    server.add(await venueEdit(show, 'The Attic'));
    const { data } = owner([show]);
    const { inbox, latest } = inboxFor(server, data);
    await inbox.load();
    const items = latest().items;
    expect(items.map((item) => item.detail)).toEqual(['unreadable', 'unreadable', 'unreadable', 'ready']);
    expect(items[0].error).toBe(INBOX_TEXT.unreadable);
    expect(items[3].plan?.ok).toBe(true);
  });

  it('marks every pending edit with conflicts stale in one call', async () => {
    const show = fullShow();
    const server = fakeServer();
    server.add(await venueEdit(show, 'The Attic'));
    server.add(await venueEdit(show, 'The Cellar'));
    server.add(await venueEdit(show, 'The Basement'));
    const { data } = owner([{ ...show, venueName: 'Owner moved it' }]);
    const { inbox, latest } = inboxFor(server, data);
    await inbox.load();
    expect(server.decidedMany).toEqual([{ ids: ['req1', 'req2'], decision: 'stale' }]);
    expect(latest().items.map((item) => item.row.status)).toEqual(['stale', 'stale', 'pending']);
  });

  it('approves an edit: commits only the touched show, records it, and announces', async () => {
    const show = fullShow();
    const other = fullShow({ id: 'show2', name: 'Other', viewToken: undefined });
    const server = fakeServer();
    server.add(await venueEdit(show, 'The Attic'));
    const { data, state, commits } = owner([show, other]);
    const { inbox, latest } = inboxFor(server, data);
    await inbox.load();
    // The owner edits the other show after the card was planned.
    const edited = { ...other, venueName: 'Owner’s own change' };
    state.shows = [show, edited];
    await inbox.approve(latest().items[0]);
    expect(commits).toHaveLength(1);
    expect(commits[0].upsert).toEqual(['show1']);
    expect(state.shows[1]).toBe(edited);
    expect(state.shows[0].venueName).toBe('The Attic');
    expect(server.decided).toEqual([{ id: 'req1', decision: 'approved' }]);
    expect(latest().items).toEqual([]);
    expect(latest().announcement).toBe(INBOX_TEXT.approvedEdit);
  });

  it('a plan that changed while the owner looked is shown again and needs a second tap', async () => {
    const show = fullShow();
    const server = fakeServer();
    server.add(await venueEdit(show, 'The Attic'));
    const { data, state, commits } = owner([show]);
    const { inbox, latest } = inboxFor(server, data);
    await inbox.load();
    const shown = latest().items[0].shown;
    state.shows = [{ ...show, venueName: 'Moved meanwhile' }];
    await inbox.approve(latest().items[0], { anyway: true });
    expect(commits).toHaveLength(0);
    expect(latest().items[0].notice).toBe(INBOX_TEXT.changed);
    expect(latest().items[0].shown).not.toBe(shown);
    await inbox.approve(latest().items[0], { anyway: true });
    expect(commits).toHaveLength(1);
    expect(state.shows[0].venueName).toBe('The Attic');
  });

  it('a plan with conflicts needs Approve anyway', async () => {
    const show = fullShow();
    const server = fakeServer();
    server.add(await venueEdit(show, 'The Attic'));
    const { data, commits } = owner([{ ...show, venueName: 'Owner moved it' }]);
    const { inbox, latest } = inboxFor(server, data);
    await inbox.load();
    await inbox.approve(latest().items[0]);
    expect(commits).toHaveLength(0);
    await inbox.approve(latest().items[0], { anyway: true });
    expect(commits).toHaveLength(1);
  });

  it('does not approve while a save is blocked', async () => {
    const show = fullShow();
    const server = fakeServer();
    server.add(await venueEdit(show, 'The Attic'));
    const { data, state, commits } = owner([show]);
    const { inbox, latest } = inboxFor(server, data);
    await inbox.load();
    state.blocked = true;
    await inbox.approve(latest().items[0]);
    expect(commits).toHaveLength(0);
    expect(latest().items[0].error).toBe(INBOX_TEXT.syncBlocked);
  });

  it('a failed decision leaves only Finish approving, which records it', async () => {
    const show = fullShow();
    const server = fakeServer();
    server.add(await venueEdit(show, 'The Attic'));
    const { data, commits } = owner([show]);
    const { inbox, latest } = inboxFor(server, data);
    await inbox.load();
    server.failDecideWith(0);
    await inbox.approve(latest().items[0]);
    expect(commits).toHaveLength(1);
    expect(latest().items[0]).toMatchObject({ applied: true, error: INBOX_TEXT.finish('Sam Rivera') });
    // Reject is gone while applied.
    await inbox.reject(latest().items[0]);
    expect(server.decided).toEqual([]);
    server.failDecideWith(null);
    await inbox.approve(latest().items[0]);
    expect(commits).toHaveLength(1);
    expect(server.decided).toEqual([{ id: 'req1', decision: 'approved' }]);
    expect(latest().items).toEqual([]);
  });

  it('a request withdrawn meanwhile says the approval is already applied', async () => {
    const show = fullShow();
    const server = fakeServer();
    server.add(await venueEdit(show, 'The Attic'));
    const { data } = owner([show]);
    const { inbox, latest } = inboxFor(server, data);
    await inbox.load();
    server.failDecideWith(409);
    await inbox.approve(latest().items[0]);
    expect(latest().items).toEqual([]);
    expect(latest().announcement).toBe(INBOX_TEXT.withdrawnMeanwhile('Sam Rivera'));
  });

  it('approves a share by making the link, filing it, then recording the encrypted result', async () => {
    const server = fakeServer();
    server.add({ kind: 'share', action: { type: 'existing-profile-link', requestId: fullSettings().profileRequests![0].id } });
    const { data } = owner([fullShow()]);
    const { inbox, latest } = inboxFor(server, data);
    await inbox.load();
    await inbox.approve(latest().items[0]);
    expect(server.decided).toHaveLength(1);
    expect(server.decided[0]).toMatchObject({ id: 'req1', decision: 'approved', result: expect.any(String), handout: expect.any(String) });
    expect(latest().announcement).toBe(INBOX_TEXT.approvedShare('Sam Rivera'));
  });

  it('rejects one, or every one from a co-producer in one call', async () => {
    const show = fullShow();
    const server = fakeServer();
    server.add(await venueEdit(show, 'A'));
    server.add(await venueEdit(show, 'B'));
    server.add(await venueEdit(show, 'C'));
    const { data, commits } = owner([show]);
    const { inbox, latest } = inboxFor(server, data);
    await inbox.load();
    await inbox.reject(latest().items[0]);
    expect(server.decided).toEqual([{ id: 'req1', decision: 'rejected' }]);
    expect(latest().announcement).toBe(INBOX_TEXT.rejected('Sam Rivera'));
    await inbox.rejectAllFrom('link1');
    expect(server.decidedMany.at(-1)).toEqual({ ids: ['req2', 'req3'], decision: 'rejected' });
    expect(latest().items).toEqual([]);
    expect(commits).toEqual([]);
  });
});

describe('readOutline', () => {
  it('accepts outlines and refuses anything else', () => {
    expect(readOutline({ kind: 'edit', shows: [{ id: 's', op: 'update' }], settingsFields: ['brandName'] })).toEqual({ kind: 'edit', shows: [{ id: 's', op: 'update' }], settingsFields: ['brandName'] });
    expect(readOutline({ kind: 'download', action: { type: 'flyer', key: 'download:flyer:s', showId: 's' } })).not.toBeNull();
    expect(readOutline({ kind: 'edit', shows: [{ id: 1, op: 'update' }] })).toBeNull();
    expect(readOutline({ kind: 'share', action: { type: 'nope', key: 'k' } })).toBeNull();
    expect(readOutline({ kind: 'other' })).toBeNull();
    expect(readOutline('edit')).toBeNull();
  });
});
