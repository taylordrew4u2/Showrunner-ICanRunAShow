import CryptoJS from 'crypto-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionCredentials } from '../utils/session-vault';
import {
  adoptMedia,
  coproduceUrl,
  createCoproducerLink,
  decide,
  decideMany,
  decryptUntrusted,
  dismissHandout,
  getInboxRequest,
  inboxCount,
  listCoproducerLinks,
  listHandouts,
  listInbox,
  stagedChunk,
  withdrawAllCoproducerLinks,
  withdrawCoproducerLink,
} from './ownerClient';
import { UntrustedJsonError } from './untrusted';

const session: SessionCredentials = {
  username: 'producer',
  userId: 'user-1',
  authHash: 'owner-credential',
  key: 'a'.repeat(64),
  legacyKey: 'b'.repeat(64),
};

const TOKEN = 'A'.repeat(43);

interface Call { url: string; method: string; headers: Record<string, string>; body: unknown }

let calls: Call[] = [];
let answer: unknown = {};

beforeEach(() => {
  calls = [];
  answer = {};
  vi.stubGlobal('location', { origin: 'https://icanrunashow.com' });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(init.body as string) : undefined,
    });
    return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function last(): Call {
  return calls[calls.length - 1];
}

describe('the owner client', () => {
  it('builds the link with the token in the fragment', () => {
    expect(coproduceUrl('https://icanrunashow.com', TOKEN)).toBe(`https://icanrunashow.com/coproduce#t=${TOKEN}`);
  });

  it('makes a link with the keys and consent, and returns the URL on this origin', async () => {
    answer = { link: { id: 'l1' }, token: TOKEN };
    const made = await createCoproducerLink(session, '  Sam Rivera ');
    expect(last()).toMatchObject({ url: '/api/coproducer?route=links', method: 'POST' });
    expect(last().body).toEqual({ label: 'Sam Rivera', key: session.key, legacyKey: session.legacyKey, consent: true });
    expect(made.url).toBe(`https://icanrunashow.com/coproduce#t=${TOKEN}`);
  });

  it('sends the owner credential on every route, never a bearer token', async () => {
    answer = { links: [], open: 2, requests: [], next: null, request: { id: 'r1' }, decided: ['r1'], handouts: [], data: 'x', total: 1 };
    await listCoproducerLinks(session);
    await withdrawCoproducerLink(session, 'link/1');
    await withdrawAllCoproducerLinks(session);
    await inboxCount(session);
    await listInbox(session, 'open');
    await listInbox(session, 'recent', '123:abc');
    await getInboxRequest(session, 'r1');
    await stagedChunk(session, 'media-1', 2);
    await adoptMedia(session, 'r1');
    await decide(session, { id: 'r1', decision: 'approved' });
    await decideMany(session, { ids: ['r1'], decision: 'stale' });
    await listHandouts(session);
    await dismissHandout(session, 'h1');
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'GET /api/coproducer?route=links',
      'DELETE /api/coproducer?route=links&id=link%2F1',
      'DELETE /api/coproducer?route=links',
      'GET /api/coproducer?route=inbox&count=1',
      'GET /api/coproducer?route=inbox&status=open',
      'GET /api/coproducer?route=inbox&status=recent&after=123%3Aabc',
      'GET /api/coproducer?route=inbox&id=r1',
      'GET /api/coproducer?route=staged&id=media-1&seq=2',
      'POST /api/coproducer?route=adopt',
      'POST /api/coproducer?route=decide',
      'POST /api/coproducer?route=decide-many',
      'GET /api/coproducer?route=handouts',
      'DELETE /api/coproducer?route=handouts&id=h1',
    ]);
    for (const call of calls) {
      expect(call.headers['x-user-id']).toBe('user-1');
      expect(call.headers['x-auth']).toBe('owner-credential');
      expect(Object.keys(call.headers).map((name) => name.toLowerCase())).not.toContain('authorization');
    }
    expect(calls[8].body).toEqual({ id: 'r1' });
    expect(calls[10].body).toEqual({ ids: ['r1'], decision: 'stale' });
  });

  it('reads the count as numbers', async () => {
    answer = { open: 3, links: 1 };
    expect(await inboxCount(session)).toEqual({ open: 3, links: 1 });
  });
});

describe('decryptUntrusted', () => {
  it('opens what the account key encrypted, and falls back to the legacy key', () => {
    const value = { kind: 'edit', shows: [] };
    expect(decryptUntrusted(CryptoJS.AES.encrypt(JSON.stringify(value), session.key).toString(), session)).toEqual(value);
    expect(decryptUntrusted(CryptoJS.AES.encrypt(JSON.stringify(value), session.legacyKey).toString(), session)).toEqual(value);
  });

  it('refuses a prototype key at any depth', () => {
    const text = '{"kind":"edit","shows":[{"__proto__":{"polluted":true}}]}';
    expect(() => decryptUntrusted(CryptoJS.AES.encrypt(text, session.key).toString(), session)).toThrow(UntrustedJsonError);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('throws when nothing decrypts', () => {
    expect(() => decryptUntrusted(CryptoJS.AES.encrypt('"x"', 'c'.repeat(64)).toString(), session)).toThrow();
  });
});
