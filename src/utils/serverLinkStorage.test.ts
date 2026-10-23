import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import live from '../../api/live';
import liveMedia from '../../api/live-media';
import profilePhoto from '../../api/profile-photo';
import sign from '../../api/sign';
import signDoc from '../../api/sign-doc';
import { applySchema } from '../../api/_lib/db';
import { MAX_LINK_BYTES, MAX_LINK_TOKENS } from '../../api/_lib/linkStorage';
import { liveTokenOwnership, signTokenOwnership } from '../../api/_lib/tokenOwnership';

const connection = vi.hoisted(() => ({ db: null as Client | null }));
vi.mock('../../api/_lib/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/_lib/db')>()),
  ensureSchema: async () => {},
  getDb: () => connection.db,
}));
vi.mock('../../api/_lib/auth', () => ({
  authorize: async (req: Request) => req.headers.get('x-user-id'),
}));

let dir: string;
const contract = 'contract-link-token-0001';
const viewer = 'viewer-link-token';

/** One request to a route, as `user` when given and anonymously when not. */
function call(route: (req: Request) => Promise<Response>, method: string, path: string, body?: unknown, user?: string) {
  return route(new Request(`https://example.test${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(user ? { 'x-user-id': user } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
}

const putDoc = (user: string, token: string, data: string, seq = 0, total = 1) =>
  call(signDoc, 'PUT', '/api/sign-doc', { token, seq, total, data }, user);
const putAudio = (user: string, token: string, data: string, id = 'walk-on-0001', seq = 0, total = 1) =>
  call(liveMedia, 'PUT', '/api/live-media', { token, id, seq, total, data }, user);
const putPhoto = (token: string, data: string, seq = 0, total = 1) =>
  call(profilePhoto, 'PUT', '/api/profile-photo', { token, seq, total, data });
const putRequest = (user: string, token: string, payload = 'request') =>
  call(sign, 'PUT', '/api/sign', { token, payload }, user);
const publish = (user: string, token: string) =>
  call(live, 'POST', '/api/live', { token, payload: { showName: 'Basement', status: 'idle' } }, user);
const signLink = (token: string, signature: string) => call(sign, 'POST', '/api/sign', { token, signature });
const withdrawViewer = (token: string, user?: string) => call(live, 'DELETE', `/api/live?token=${token}`, undefined, user);

const run = (sql: string, ...args: (string | number | null)[]) => connection.db!.execute({ sql, args });
const rows = async (sql: string, ...args: (string | number | null)[]) =>
  (await run(sql, ...args)).rows.map((row) => Array.from(row));
const error = async (res: Response) => ((await res.json()) as { error?: string }).error;

/** `count` links that each already hold a chunk for `user`. */
async function holdLinks(user: string, count: number) {
  await run(
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
     INSERT INTO sign_doc (token, seq, total, data, user_id, bytes)
     SELECT printf('%s-held-link-%05d', ?, i), 0, 1, 'x', ?, 1 FROM n`,
    count, user, user,
  );
}

/** A document of `bytes` already stored for `user` — the size column is what is counted. */
async function holdBytes(user: string, bytes: number, token = `${user}-held-document`) {
  await run(`INSERT INTO sign_doc (token, seq, total, data, user_id, bytes) VALUES (?, 0, 1, 'x', ?, ?)`, token, user, bytes);
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'showrunner-link-storage-'));
  connection.db = createClient({ url: `file:${join(dir, 'test.db')}` });
  await applySchema(connection.db);
});
afterEach(() => {
  connection.db?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('a link belongs to the first account to write under it', () => {
  it('is claimed by the first chunk of a contract, and nobody else may then touch it', async () => {
    expect((await putDoc('producer', contract, 'page-one', 0, 2)).status).toBe(200);
    expect(await rows(`SELECT user_id, bytes FROM sign_doc WHERE token = ?`, contract)).toEqual([['producer', 8]]);
    expect(await signTokenOwnership(connection.db!, contract, 'producer')).toBe('mine');
    expect(await signTokenOwnership(connection.db!, contract, 'stranger')).toBe('other');

    // Any other signed-in account — before the request exists as well as after.
    expect((await putDoc('stranger', contract, 'swapped', 1, 2)).status).toBe(403);
    expect((await putRequest('stranger', contract, 'swapped-terms')).status).toBe(403);
    expect((await call(signDoc, 'DELETE', `/api/sign-doc?token=${contract}`, undefined, 'stranger')).status).toBe(403);
    expect((await call(sign, 'DELETE', `/api/sign?token=${contract}`, undefined, 'stranger')).status).toBe(403);
    expect(await rows(`SELECT * FROM sign_request`)).toEqual([]);
    expect(await rows(`SELECT seq, data FROM sign_doc WHERE token = ?`, contract)).toEqual([[0, 'page-one']]);
  });

  it('takes the document first and the request second, as every build cached on a phone sends them', async () => {
    // sendForSignature, in every build there has been: chunks, then the request.
    expect((await putDoc('producer', contract, 'page-one', 0, 2)).status).toBe(200);
    expect((await putDoc('producer', contract, 'page-two', 1, 2)).status).toBe(200);
    expect((await putRequest('producer', contract, 'terms')).status).toBe(200);
    expect(await rows(`SELECT user_id, payload FROM sign_request WHERE token = ?`, contract)).toEqual([['producer', 'terms']]);

    // The signer, with no account, opens the link and signs it.
    const opened = await call(sign, 'GET', `/api/sign?token=${contract}`);
    expect(await opened.json()).toMatchObject({ payload: 'terms', signedAt: null });
    for (const [seq, data] of ['page-one', 'page-two'].entries()) {
      const chunk = await call(signDoc, 'GET', `/api/sign-doc?token=${contract}&seq=${seq}`);
      expect(await chunk.json()).toEqual({ data, total: 2 });
    }
    expect((await call(sign, 'POST', '/api/sign', { token: contract, signature: 'agreed' })).status).toBe(200);

    // And it is still only the producer's to withdraw.
    expect((await call(sign, 'DELETE', `/api/sign?token=${contract}`, undefined, 'stranger')).status).toBe(403);
    expect((await call(sign, 'DELETE', `/api/sign?token=${contract}`, undefined, 'producer')).status).toBe(200);
    expect(await rows(`SELECT token FROM sign_doc`)).toEqual([]);
  });

  it('is claimed by a board’s audio when it lands before the live state does', async () => {
    expect((await putAudio('producer', viewer, 'walk-on')).status).toBe(200);
    expect(await liveTokenOwnership(connection.db!, viewer, 'producer')).toBe('mine');

    // Someone in the room with a free account of their own.
    expect((await putAudio('audience', viewer, 'something-else', 'walk-on-0002')).status).toBe(403);
    expect((await call(liveMedia, 'DELETE', `/api/live-media?token=${viewer}`, undefined, 'audience')).status).toBe(403);
    expect((await publish('audience', viewer)).status).toBe(403);
    expect(await rows(`SELECT * FROM live_view`)).toEqual([]);

    expect((await publish('producer', viewer)).status).toBe(200);
    expect(await rows(`SELECT user_id FROM live_view WHERE token = ?`, viewer)).toEqual([['producer']]);
  });

  it('is claimed from a viewer link made before owners were recorded by the board that sends audio under it', async () => {
    await run(`INSERT INTO live_view (token, payload) VALUES (?, '{}')`, viewer);
    expect((await putAudio('producer', viewer, 'walk-on')).status).toBe(200);
    expect((await publish('audience', viewer)).status).toBe(403);
    expect((await publish('producer', viewer)).status).toBe(200);
    expect(await rows(`SELECT user_id FROM live_view WHERE token = ?`, viewer)).toEqual([['producer']]);
  });
});

describe('one allowance for every link an account hands out', () => {
  it('refuses a link past the count, and still takes more under the links it already has', async () => {
    await holdLinks('producer', MAX_LINK_TOKENS - 2);
    // A profile link made while there was room, and the last link there is room for.
    expect((await putRequest('producer', 'profile-link-token-01')).status).toBe(200);
    expect((await putDoc('producer', contract, 'page-one', 0, 2)).status).toBe(200);

    // One more, through any of the routes, is refused with the code the app shows.
    const refused = await putAudio('producer', viewer, 'walk-on');
    expect(refused.status).toBe(413);
    expect(await error(refused)).toBe('link_storage_full');
    expect(await error(await putDoc('producer', 'another-contract-0001', 'page'))).toBe('link_storage_full');
    expect(await error(await putRequest('producer', 'profile-link-token-02'))).toBe('link_storage_full');
    expect(await error(await publish('producer', viewer))).toBe('link_storage_full');

    // Under a link it already has: the rest of the same document goes in, and
    // the headshot comes back through the profile link.
    expect((await putDoc('producer', contract, 'page-two', 1, 2)).status).toBe(200);
    expect((await putPhoto('profile-link-token-01', 'headshot')).status).toBe(200);
    // Nobody else's allowance is touched.
    expect((await putAudio('neighbour', viewer, 'walk-on')).status).toBe(200);
  });

  it('refuses the chunk that would pass the total, to the byte', async () => {
    await holdBytes('producer', MAX_LINK_BYTES - 100);
    expect((await putDoc('producer', contract, 'x'.repeat(100))).status).toBe(200);
    expect(await error(await putAudio('producer', viewer, 'x'))).toBe('link_storage_full');

    // A chunk sent again replaces its own size rather than adding to it.
    expect((await putDoc('producer', contract, 'y'.repeat(100))).status).toBe(200);
    expect((await putDoc('producer', contract, 'y'.repeat(99))).status).toBe(200);
    expect((await putDoc('producer', contract, 'z'.repeat(101))).status).toBe(413);
  });

  it('checks the first chunk of a file for the whole file, and every later chunk for itself', async () => {
    await holdBytes('producer', MAX_LINK_BYTES - 300);
    // Four chunks the size of the first would not fit; nothing is stored.
    expect(await error(await putAudio('producer', viewer, 'x'.repeat(100), 'walk-on-0001', 0, 4))).toBe('link_storage_full');
    expect(await rows(`SELECT * FROM live_media`)).toEqual([]);

    // Three would, and they go in to the last byte.
    for (let seq = 0; seq < 3; seq++) {
      expect((await putAudio('producer', viewer, 'x'.repeat(100), 'walk-on-0001', seq, 3)).status).toBe(200);
    }
    // `total` is only the client's word: a chunk claiming to belong to a
    // file already under way is still counted for itself.
    expect(await error(await putAudio('producer', viewer, 'x', 'walk-on-0002', 1, 2))).toBe('link_storage_full');
  });

  it('counts a headshot against the producer who made the link', async () => {
    expect((await putRequest('producer', contract)).status).toBe(200);
    await holdBytes('producer', MAX_LINK_BYTES - 10);
    expect(await error(await putPhoto(contract, 'x'.repeat(11)))).toBe('link_storage_full');
    expect((await putPhoto(contract, 'x'.repeat(10))).status).toBe(200);
    expect(await rows(`SELECT user_id, bytes FROM profile_photo WHERE token = ?`, contract)).toEqual([['producer', 10]]);
    expect(await error(await putDoc('producer', 'another-contract-0001', 'x'))).toBe('link_storage_full');
  });

  it('gives the space back when a contract is withdrawn or a board’s audio is turned off', async () => {
    // A signed contract filling the allowance, and a board using the last of it.
    expect((await putRequest('producer', contract)).status).toBe(200);
    await holdBytes('producer', MAX_LINK_BYTES - 10, contract);
    expect((await putAudio('producer', viewer, 'x'.repeat(10))).status).toBe(200);
    expect(await error(await putDoc('producer', 'another-contract-0001', 'x'))).toBe('link_storage_full');

    expect((await call(liveMedia, 'DELETE', `/api/live-media?token=${viewer}`, undefined, 'producer')).status).toBe(200);
    expect((await putDoc('producer', 'another-contract-0001', 'x'.repeat(10))).status).toBe(200);
    expect(await error(await putAudio('producer', viewer, 'x'))).toBe('link_storage_full');

    expect((await call(sign, 'DELETE', `/api/sign?token=${contract}`, undefined, 'producer')).status).toBe(200);
    expect((await putAudio('producer', viewer, 'x'.repeat(1000))).status).toBe(200);
  });

  it('gives a link’s place in the count back when it is withdrawn', async () => {
    await holdLinks('producer', MAX_LINK_TOKENS);
    expect(await error(await putDoc('producer', contract, 'page'))).toBe('link_storage_full');
    const held = 'producer-held-link-00001';
    expect((await call(signDoc, 'DELETE', `/api/sign-doc?token=${held}`, undefined, 'producer')).status).toBe(200);
    expect((await putDoc('producer', contract, 'page')).status).toBe(200);
  });

  it('leaves links from before owners were recorded as they were, and counts them against nobody', async () => {
    // A contract link, its document and a headshot sent through a profile
    // link, all from before any of them named an account.
    const old = 'old-contract-link-01';
    await run(`INSERT INTO sign_request (token, payload) VALUES (?, 'original-terms')`, old);
    await run(`INSERT INTO sign_doc (token, seq, total, data) VALUES (?, 0, 1, ?)`, old, 'x'.repeat(5000));
    await holdBytes('producer', MAX_LINK_BYTES - 100);

    expect((await putDoc('producer', contract, 'x'.repeat(100))).status).toBe(200);
    // A headshot through the old link still goes in, and counts against nobody.
    expect((await putPhoto(old, 'x'.repeat(5000))).status).toBe(200);
    expect(await rows(`SELECT user_id FROM profile_photo WHERE token = ?`, old)).toEqual([[null]]);
    expect(await error(await putAudio('producer', viewer, 'x'))).toBe('link_storage_full');

    // Nobody may replace the old document, and its producer can still withdraw it.
    expect(await signTokenOwnership(connection.db!, old, 'producer')).toBe('legacy');
    expect((await putDoc('producer', old, 'swapped')).status).toBe(403);
    expect((await call(sign, 'DELETE', `/api/sign?token=${old}`, undefined, 'producer')).status).toBe(200);
    expect(await rows(`SELECT token FROM sign_doc WHERE token = ?`, old)).toEqual([]);
  });

  it('lets a document stored before chunks named anyone be taken up by its producer’s request', async () => {
    // A send that straddled the deploy: chunks before it, the request after.
    await run(`INSERT INTO sign_doc (token, seq, total, data) VALUES (?, 0, 1, 'page')`, contract);
    expect(await signTokenOwnership(connection.db!, contract, 'producer')).toBe('free');
    expect((await putRequest('producer', contract)).status).toBe(200);
    expect(await signTokenOwnership(connection.db!, contract, 'producer')).toBe('mine');
  });
});

describe('the links themselves count', () => {
  it('gives a request a place among the account’s links, and refuses one past the count', async () => {
    await holdLinks('producer', MAX_LINK_TOKENS - 1);
    // A profile link has nothing before its request: the request takes the last place.
    expect((await putRequest('producer', 'profile-link-token-01')).status).toBe(200);
    const refused = await putRequest('producer', 'profile-link-token-02');
    expect(refused.status).toBe(413);
    expect(await error(refused)).toBe('link_storage_full');
    expect(await rows(`SELECT token FROM sign_request`)).toEqual([['profile-link-token-01']]);
    // Sending the same request again asks for no new place.
    expect((await putRequest('producer', 'profile-link-token-01', 'reworded')).status).toBe(200);
  });

  it('takes a contract’s request under the place its document already holds, as every build sends them', async () => {
    await holdLinks('producer', MAX_LINK_TOKENS - 1);
    expect((await putDoc('producer', contract, 'page-one')).status).toBe(200);
    // The account is now at the count, and the request is still the same link.
    expect((await putRequest('producer', contract)).status).toBe(200);
    expect(await rows(`SELECT user_id FROM sign_request WHERE token = ?`, contract)).toEqual([['producer']]);
    expect(await error(await putRequest('producer', 'another-contract-0001'))).toBe('link_storage_full');
  });

  it('gives a viewer link a place from its first publish, and asks nothing of one it already publishes to', async () => {
    await holdLinks('producer', MAX_LINK_TOKENS - 1);
    // A viewer link is published when it is made, as every build does.
    expect((await publish('producer', viewer)).status).toBe(200);
    // Every cue after that goes in, and the audio under the same link too.
    expect((await publish('producer', viewer)).status).toBe(200);
    expect((await putAudio('producer', viewer, 'walk-on')).status).toBe(200);

    const refused = await publish('producer', 'another-viewer-link');
    expect(refused.status).toBe(413);
    expect(await error(refused)).toBe('link_storage_full');
    expect(await rows(`SELECT token FROM live_view`)).toEqual([[viewer]]);
  });

  it('lets a board’s audio that landed first hold the place its live state takes', async () => {
    await holdLinks('producer', MAX_LINK_TOKENS - 1);
    expect((await putAudio('producer', viewer, 'walk-on')).status).toBe(200);
    expect((await publish('producer', viewer)).status).toBe(200);
  });

  it('counts a signature against the producer who made the link, to the byte', async () => {
    expect((await putRequest('producer', contract)).status).toBe(200);
    await holdBytes('producer', MAX_LINK_BYTES - 10);

    // Anyone holding the link can send one in; past the producer's room, nothing lands.
    const refused = await signLink(contract, 'x'.repeat(11));
    expect(refused.status).toBe(413);
    expect(await error(refused)).toBe('link_storage_full');
    expect(await rows(`SELECT signature, signed_at, bytes FROM sign_request`)).toEqual([[null, null, null]]);

    expect((await signLink(contract, 'x'.repeat(10))).status).toBe(200);
    expect(await rows(`SELECT bytes FROM sign_request WHERE token = ?`, contract)).toEqual([[10]]);
    // The signature is now what fills the allowance.
    expect(await error(await putDoc('producer', 'another-contract-0001', 'x'))).toBe('link_storage_full');
    // A phone that lost the answer sends the same signature again, and is told it landed.
    expect((await signLink(contract, 'x'.repeat(10))).status).toBe(200);
    expect(await (await call(sign, 'GET', `/api/sign?token=${contract}`)).json()).toMatchObject({ signature: 'x'.repeat(10) });
  });

  it('counts nobody’s room against a signer on a link from before links named an account', async () => {
    const old = 'old-contract-link-01';
    await run(`INSERT INTO sign_request (token, payload) VALUES (?, 'original-terms')`, old);
    await holdBytes('producer', MAX_LINK_BYTES);
    expect((await signLink(old, 'x'.repeat(5000))).status).toBe(200);
    expect(await rows(`SELECT user_id, bytes FROM sign_request WHERE token = ?`, old)).toEqual([[null, 5000]]);
  });

  it('gives a request’s place, and its signature’s bytes, back when it is withdrawn', async () => {
    // Every held link is a byte, and one more document fills the rest but 100.
    await holdLinks('producer', MAX_LINK_TOKENS - 2);
    await holdBytes('producer', MAX_LINK_BYTES - (MAX_LINK_TOKENS - 2) - 100);
    expect((await putRequest('producer', contract)).status).toBe(200);
    expect((await signLink(contract, 'x'.repeat(100))).status).toBe(200);
    // Full on both counts: no new link, and not a byte more under this one.
    expect(await error(await putRequest('producer', 'another-contract-0001'))).toBe('link_storage_full');
    expect(await error(await putDoc('producer', contract, 'x'))).toBe('link_storage_full');

    expect((await call(sign, 'DELETE', `/api/sign?token=${contract}`, undefined, 'producer')).status).toBe(200);
    expect((await putRequest('producer', 'another-contract-0001')).status).toBe(200);
    expect((await signLink('another-contract-0001', 'x'.repeat(100))).status).toBe(200);
  });

  it('gives a viewer link’s place back when its producer withdraws it, audio and all', async () => {
    await holdLinks('producer', MAX_LINK_TOKENS - 1);
    expect((await publish('producer', viewer)).status).toBe(200);
    expect((await putAudio('producer', viewer, 'walk-on')).status).toBe(200);
    expect(await error(await publish('producer', 'another-viewer-link'))).toBe('link_storage_full');

    // Not by anyone in the room, signed in or not.
    expect((await withdrawViewer(viewer)).status).toBe(401);
    expect((await withdrawViewer(viewer, 'audience')).status).toBe(403);
    expect(await rows(`SELECT token FROM live_view`)).toEqual([[viewer]]);

    expect((await withdrawViewer(viewer, 'producer')).status).toBe(200);
    expect(await rows(`SELECT token FROM live_view UNION ALL SELECT token FROM live_media`)).toEqual([]);
    expect(await (await call(live, 'GET', `/api/live?token=${viewer}`)).json()).toEqual({ payload: null });
    expect((await publish('producer', 'another-viewer-link')).status).toBe(200);
  });

  it('counts a link once, however many of its tables hold something under it', async () => {
    await holdLinks('producer', MAX_LINK_TOKENS - 2);
    // A contract: document, request, a headshot back through it.
    expect((await putDoc('producer', contract, 'page')).status).toBe(200);
    expect((await putRequest('producer', contract)).status).toBe(200);
    expect((await putPhoto(contract, 'headshot')).status).toBe(200);
    // A viewer link: live state and audio.
    expect((await publish('producer', viewer)).status).toBe(200);
    expect((await putAudio('producer', viewer, 'walk-on')).status).toBe(200);
    expect(await error(await putRequest('producer', 'another-contract-0001'))).toBe('link_storage_full');
  });
});

describe('the checks every write makes', () => {
  it('find whose a link is and what an account holds in indexes, never in the chunks', async () => {
    // A chunk's owner and size sit after its data in the row, so a check that
    // reads them from the row reads through the whole chunk first. The board
    // asks on every cue it publishes, across every song it sent the viewer.
    type Statement = { sql: string; args: (string | number | null)[] };
    const seen: Statement[] = [];
    const db = connection.db!;
    const execute = db.execute.bind(db);
    const spy = vi.spyOn(db, 'execute').mockImplementation(((stmt: Statement) => {
      seen.push(stmt);
      return execute(stmt);
    }) as never);

    await putDoc('producer', contract, 'page-one', 0, 2);
    await putDoc('stranger', contract, 'swapped', 1, 2);
    await putRequest('producer', contract);
    await putRequest('producer', 'profile-link-token-01');
    await putPhoto(contract, 'headshot');
    await signLink('profile-link-token-01', 'answers');
    await putAudio('producer', viewer, 'walk-on');
    await publish('producer', viewer);
    await publish('producer', viewer);
    await publish('producer', 'another-viewer-link');
    await publish('audience', viewer);
    await call(liveMedia, 'DELETE', `/api/live-media?token=${viewer}`, undefined, 'producer');
    await withdrawViewer('another-viewer-link', 'producer');
    await call(sign, 'DELETE', `/api/sign?token=${contract}`, undefined, 'producer');
    spy.mockRestore();

    const asked = seen.map((stmt) => stmt.sql);
    expect(asked.some((sql) => /NOT EXISTS \(SELECT 1 FROM live_media/.test(sql))).toBe(true);
    expect(asked.some((sql) => /NOT EXISTS \(SELECT 1 FROM sign_doc/.test(sql))).toBe(true);
    expect(asked.some((sql) => /SELECT user_id FROM sign_doc/.test(sql))).toBe(true);
    expect(asked.some((sql) => /COUNT\(DISTINCT token\)/.test(sql))).toBe(true);
    expect(asked.some((sql) => /FROM live_view WHERE user_id = \?/.test(sql))).toBe(true);

    for (const { sql, args } of seen) {
      // Writing or removing chunks has to touch them.
      if (/^\s*(INSERT INTO|DELETE FROM) (sign_doc|live_media|profile_photo)\b/.test(sql)) continue;
      const plan = (await run(`EXPLAIN QUERY PLAN ${sql}`, ...args)).rows.map((row) => String(row.detail));
      for (const step of plan.filter((line) => /\b(sign_doc|live_media|profile_photo)\b/.test(line))) {
        expect(step, sql).toContain('COVERING INDEX');
      }
      // The link rows are read whole where the link itself is being read or
      // written. Counting an account's links, or asking whether it already
      // holds one, reads their indexes: a row's owner can sit after its
      // payload and its signature.
      if (!/COUNT\(DISTINCT token\)|FROM live_view WHERE user_id = \?/.test(sql)) continue;
      for (const step of plan.filter((line) => /\b(sign_request|live_view)\b/.test(line))) {
        expect(step, sql).toContain('COVERING INDEX');
      }
    }
  });

  it('read the link rows’ indexes on a database from before the rows were counted', async () => {
    // The owner after the payload and the signature, as ADD COLUMN left it.
    connection.db!.close();
    connection.db = createClient({ url: `file:${join(dir, 'before.db')}` });
    await connection.db.executeMultiple(`
      CREATE TABLE sign_request (token TEXT PRIMARY KEY, payload TEXT NOT NULL, signature TEXT,
        signed_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE live_view (token TEXT PRIMARY KEY, payload TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    `);
    await applySchema(connection.db);
    const plan = async (sql: string, ...args: string[]) =>
      (await run(`EXPLAIN QUERY PLAN ${sql}`, ...args)).rows.map((row) => String(row.detail)).join(' | ');
    expect(await plan(`SELECT 1 FROM live_view WHERE user_id = ? AND +token = ?`, 'producer', viewer))
      .toContain('COVERING INDEX live_view_by_user');
    expect(await plan(`SELECT token, bytes FROM sign_request WHERE user_id = ?`, 'producer'))
      .toContain('COVERING INDEX sign_request_by_user');
  });
});

describe('a database from before chunks named anyone', () => {
  it('gains the columns and indexes, and keeps what it holds readable and its producer’s', async () => {
    connection.db!.close();
    connection.db = createClient({ url: `file:${join(dir, 'before.db')}` });
    // The link tables as they stood: owners on the link rows, none on chunks.
    await connection.db.executeMultiple(`
      CREATE TABLE sign_request (token TEXT PRIMARY KEY, user_id TEXT, payload TEXT NOT NULL,
        signature TEXT, signed_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE sign_doc (token TEXT NOT NULL, seq INTEGER NOT NULL, total INTEGER NOT NULL,
        data TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (token, seq));
      CREATE TABLE profile_photo (token TEXT NOT NULL, seq INTEGER NOT NULL, total INTEGER NOT NULL,
        data TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (token, seq));
      CREATE TABLE live_view (token TEXT PRIMARY KEY, user_id TEXT, payload TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE live_media (token TEXT NOT NULL, id TEXT NOT NULL, seq INTEGER NOT NULL, total INTEGER NOT NULL,
        data TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (token, id, seq));
      INSERT INTO sign_request (token, user_id, payload) VALUES ('${contract}', 'producer', 'terms');
      INSERT INTO sign_doc (token, seq, total, data) VALUES ('${contract}', 0, 2, 'page-one'), ('${contract}', 1, 2, 'page-two');
      INSERT INTO profile_photo (token, seq, total, data) VALUES ('${contract}', 0, 1, 'headshot');
      INSERT INTO live_view (token, user_id, payload) VALUES ('${viewer}', 'producer', '{}');
      INSERT INTO live_media (token, id, seq, total, data) VALUES ('${viewer}', 'walk-on-0001', 0, 1, 'walk-on');
    `);
    // As every cold start does, more than once.
    await applySchema(connection.db);
    await applySchema(connection.db);

    for (const table of ['sign_doc', 'live_media', 'profile_photo', 'sign_request']) {
      const columns = (await run(`SELECT name FROM pragma_table_info(?)`, table)).rows.map((row) => String(row[0]));
      expect(columns, table).toEqual(expect.arrayContaining(['user_id', 'bytes']));
    }
    const indexes = await rows(`SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE '%\\_by\\_%' ESCAPE '\\' ORDER BY name`);
    expect(indexes.flat()).toEqual([
      'live_media_by_token', 'live_media_by_user', 'live_view_by_user', 'profile_photo_by_user',
      'sign_doc_by_token', 'sign_doc_by_user', 'sign_request_by_user',
    ]);
    expect(await rows(`SELECT user_id, bytes FROM sign_doc`)).toEqual([[null, null], [null, null]]);
    // The links themselves already name their producer, so they count among
    // the producer's links as they stand; the request holds no signature yet.
    expect(await rows(`SELECT user_id, bytes FROM sign_request`)).toEqual([['producer', null]]);

    // Still readable by the signer, the room and the producer.
    expect(await (await call(signDoc, 'GET', `/api/sign-doc?token=${contract}&seq=1`)).json()).toEqual({ data: 'page-two', total: 2 });
    expect(await (await call(liveMedia, 'GET', `/api/live-media?token=${viewer}&id=walk-on-0001&seq=0`)).json()).toEqual({ data: 'walk-on', total: 1 });
    expect(await (await call(profilePhoto, 'GET', `/api/profile-photo?token=${contract}&seq=0`, undefined, 'producer')).json()).toEqual({ data: 'headshot', total: 1 });

    // Still the producer's, by the link rows, and nobody else's.
    expect((await putAudio('audience', viewer, 'something-else', 'walk-on-0002')).status).toBe(403);
    expect((await putAudio('producer', viewer, 'walk-on', 'walk-on-0002')).status).toBe(200);
    expect((await publish('producer', viewer)).status).toBe(200);
    expect((await call(sign, 'DELETE', `/api/sign?token=${contract}`, undefined, 'stranger')).status).toBe(403);
    expect((await call(sign, 'DELETE', `/api/sign?token=${contract}`, undefined, 'producer')).status).toBe(200);
    expect(await rows(`SELECT token FROM sign_doc UNION ALL SELECT token FROM profile_photo`)).toEqual([]);
  });
});
