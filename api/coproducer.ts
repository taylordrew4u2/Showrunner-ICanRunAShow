// /api/coproducer — co-producer links.
//
// An owner gives another producer a link to see everything in the account.
// The other producer (the co-producer) can change nothing: every change,
// share and download they attempt is stored here as a request, encrypted
// under the account key, and only the owner's app applies it, through the
// owner's own saves, after showing the owner everything it would change.
//
// Two kinds of caller, never mixed (see _lib/coproducerAuth.ts):
//
// - The owner (x-user-id and x-auth), on routes that make and withdraw
//   links, list and decide requests, adopt the files a request carries, and
//   list what approved shares handed out:
//     links, inbox, staged, adopt, decide, decide-many, handouts.
// - A co-producer (Authorization: Bearer <link token>, from the review
//   origin), on routes that read redacted, schema-checked views of the
//   account and write nothing but their own requests and staged files:
//     session, revisions, shows, settings, media, profile-photo, stage,
//     requests, use.
//
// Making a link sends the account's derived keys here, once. They are sealed
// under the link's token (never stored), and opened only for the length of
// each co-producer call, to decrypt what is served and to encrypt what the
// co-producer asks for. Nothing a co-producer sends reaches user_shows,
// user_settings, user_media or any link of the owner's: those change only
// when the owner's app saves them.
//
// Errors never log request bodies, tokens, keys or plaintext. Times in JSON
// are ISO strings; times in the database are epoch seconds. Every statement
// on these tables names its owner, and every co-producer statement its link.
import type { Client, InStatement } from '@libsql/client';
import type { Executor } from './_lib/coproducerRequests';
import { authorize } from './_lib/auth';
import { decryptForLink, decryptShow, encryptShow } from './_lib/chatgptCipher';
import { randomToken, sealKeys } from './_lib/seal';
import {
  appOrigin,
  bearerLink,
  COPRODUCER_SEAL_INFO,
  COPRODUCER_SEAL_VERSION,
  CoproducerError,
  coproduceConfigured,
  reviewOrigin,
  sealBinding,
  type BearerLink,
} from './_lib/coproducerAuth';
import {
  COPRODUCER_HOLDER_SWEEP,
  COPRODUCER_SWEEP,
  coproducerRoom,
  isoTime,
  linkStagedSweep,
  ownerDetail,
  ownerRow,
  REQUEST_ROW_COLUMNS,
  withdrawLinks,
  type RoomAnswer,
} from './_lib/coproducerRequests';
import { coproducerSettingsView, coproducerShowView } from './_lib/coproducerViews';
import { ensureSchema, getDb, ServerNotConfiguredError } from './_lib/db';
import { json, TooManyRequestsError } from './_lib/http';
import { producerLocked } from './_lib/plan';
import { clientAddress, rateLimit } from './_lib/ratelimit';
import { cipherHash } from './_lib/showWrites';
import { signTokenOwnership } from './_lib/tokenOwnership';
import { buildOutline } from '../src/coproducer/outline';
import { knownPeople, type KnownPeople } from '../src/coproducer/newComics';
import { ALLOWED_MEDIA_TYPES, changedMediaIds, NEW_PERSON_PROBLEM, sniffMediaType, validatePayload } from '../src/coproducer/schema';
import {
  COPRODUCER_LIMITS,
  type ApprovalResult,
  type CoproducerLinkInfo,
  type CoproducerRequestView,
  type HandoutRow,
  type RequestKind,
  type RequestOutline,
  type RequestPayload,
  type RequestStatus,
} from '../src/coproducer/types';
import { checkUntrusted } from '../src/coproducer/untrusted';
import type { AppSettings, Show } from '../src/types';

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';
type Handler<C> = (req: Request, db: Client, caller: C, url: URL) => Promise<Response>;

const OPEN = `('pending', 'stale')`;
const HEX_KEY = /^[a-f0-9]{64}$/i;
const CONTROL = /[\p{Cc}\p{Cf}]/u;
const MEDIA_ID = /^[A-Za-z0-9-]{8,64}$/;
const DATA_URL_HEAD = /^data:([^;,]+);base64,/;
const CREATE_BODY_CHARS = 16 * 1024;
const SMALL_BODY_CHARS = 4 * 1024;
const DECIDE_BODY_CHARS = COPRODUCER_LIMITS.maxResultChars + COPRODUCER_LIMITS.maxHandoutChars + 4 * 1024;
const STAGE_BODY_CHARS = COPRODUCER_LIMITS.maxStageSliceChars + 1024;
/** Stored chunks above this, or files of more chunks, are not served (as /api/media). */
const MAX_STORED_CHUNK_CHARS = 3_500_000;
const INBOX_PAGE = 100;
const RECENT_SECONDS = 7 * 24 * 60 * 60;
const MAX_ROW_ID = 100;
const MAX_MEDIA_IDS = 100;
const IDS_PER_STATEMENT = 200;

// ── Responses ─────────────────────────────────────────────────────────────

/** Nothing here belongs in a shared cache, or may be sniffed into something else. */
function respond(response: Response): Response {
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Pragma', 'no-cache');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}

function refuse(code: string, status: number, extra: Record<string, unknown> = {}): never {
  throw new CoproducerError(code, status, extra);
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** A JSON object body of at most `maxChars`, or a refusal. */
async function readBody(req: Request, maxChars: number): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > maxChars) refuse('payload_too_large', 413);
  let body: unknown;
  try { body = JSON.parse(text); } catch { refuse('bad_request', 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) refuse('bad_request', 400);
  return body as Record<string, unknown>;
}

function onlyKeys(body: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(body).some((key) => !allowed.includes(key))) refuse('bad_request', 400);
}

function rowId(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > MAX_ROW_ID) refuse('bad_request', 400);
  return value;
}

/** One `id` query parameter, exactly once and 1-100 characters. */
function oneId(url: URL): string {
  const ids = url.searchParams.getAll('id');
  if (ids.length !== 1) refuse('bad_request', 400);
  return rowId(ids[0]);
}

function seqParam(url: URL): number {
  const raw = url.searchParams.get('seq');
  const seq = raw !== null && /^\d{1,3}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(seq) || seq < 0) refuse('bad_request', 400);
  return seq;
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

/** Lowercase hex SHA-256 of `${length}:${last 32 chars}`: changes with every save, without reading a blob twice. */
async function revisionOf(length: number, tail: string): Promise<string> {
  return cipherHash(`${length}:${tail}`);
}

function storageRefusal(answer: RoomAnswer): never {
  if (answer === 'too_many_files') refuse('too_many_staged_files', 409);
  refuse('coproducer_storage_full', 413, { reason: answer });
}

// ── Owner routes ──────────────────────────────────────────────────────────

const LINK_INFO_SQL = `SELECT l.id, l.label_cipher, l.created_at, l.expires_at, l.first_used_at, l.last_used_at,
         (SELECT COUNT(*) FROM coproducer_requests r WHERE r.user_id = ? AND r.link_id = l.id AND r.status IN ${OPEN}),
         (SELECT COALESCE(SUM(bytes), 0) FROM coproducer_requests r WHERE r.user_id = ? AND r.link_id = l.id AND r.status IN ${OPEN})
           + (SELECT COALESCE(SUM(bytes), 0) FROM coproducer_media m WHERE m.user_id = ? AND m.link_id = l.id),
         (SELECT COUNT(*) FROM coproducer_handouts h WHERE h.user_id = ? AND h.link_id = l.id)
    FROM coproducer_links l`;

function linkInfo(row: ArrayLike<unknown>): CoproducerLinkInfo {
  return {
    id: String(row[0]),
    labelCipher: String(row[1]),
    createdAt: isoTime(row[2])!,
    expiresAt: isoTime(row[3])!,
    firstUsedAt: isoTime(row[4]),
    lastUsedAt: isoTime(row[5]),
    openRequests: Number(row[6]),
    storageBytes: Number(row[7]),
    handouts: Number(row[8]),
  };
}

/** O1: make a link. The token is returned once and never stored. */
const createLink: Handler<string> = async (req, db, userId) => {
  if (!coproduceConfigured(req)) refuse('coproduce_not_configured', 503);
  if (!(await rateLimit(db, `coprod:create:${userId}`, 20, 3600)).allowed) refuse('too_many_requests', 429);
  const body = await readBody(req, CREATE_BODY_CHARS);
  onlyKeys(body, ['label', 'key', 'legacyKey', 'consent']);
  const label = typeof body.label === 'string' ? body.label.trim() : '';
  if (!label || label.length > COPRODUCER_LIMITS.maxLabelChars || CONTROL.test(label)) refuse('bad_request', 400);
  if (typeof body.key !== 'string' || !HEX_KEY.test(body.key) || typeof body.legacyKey !== 'string' || !HEX_KEY.test(body.legacyKey)) refuse('bad_request', 400);
  if (body.consent !== true) refuse('bad_request', 400);
  const now = nowSeconds();
  const id = crypto.randomUUID();
  const token = randomToken();
  const sealed = await sealKeys({ key: body.key, legacyKey: body.legacyKey }, token, COPRODUCER_SEAL_INFO, COPRODUCER_SEAL_VERSION, sealBinding(id, userId));
  const labelCipher = await encryptShow(label, body.key);
  // Counted and inserted in one statement, so two at once cannot pass 20.
  const inserted = await db.execute({
    sql: `INSERT INTO coproducer_links (id, user_id, token_hash, sealed_keys, label_cipher, created_at, expires_at)
          SELECT ?, ?, ?, ?, ?, ?, ?
           WHERE (SELECT COUNT(*) FROM coproducer_links WHERE user_id = ? AND expires_at > ?) < ?`,
    args: [id, userId, await cipherHash(token), sealed, labelCipher, now, now + COPRODUCER_LIMITS.linkSeconds, userId, now, COPRODUCER_LIMITS.maxLinksPerAccount],
  });
  if (inserted.rowsAffected !== 1) refuse('too_many_links', 409);
  const row = (await db.execute({ sql: `${LINK_INFO_SQL} WHERE l.id = ? AND l.user_id = ?`, args: [userId, userId, userId, userId, id, userId] })).rows[0];
  return json({ link: linkInfo(row), token }, 201);
};

/** O2: the owner's active links, newest first. */
const listLinks: Handler<string> = async (_req, db, userId) => {
  const rows = (await db.execute({
    sql: `${LINK_INFO_SQL} WHERE l.user_id = ? AND l.expires_at > ? ORDER BY l.created_at DESC, l.rowid DESC`,
    args: [userId, userId, userId, userId, userId, nowSeconds()],
  })).rows;
  return json({ links: rows.map(linkInfo) });
};

/** O3: withdraw one link, or all of them. What they were handed is kept, marked ended. */
const deleteLinks: Handler<string> = async (_req, db, userId, url) => {
  // An empty or repeated id is refused rather than read as "all".
  const linkId = url.searchParams.has('id') ? oneId(url) : null;
  await db.batch(withdrawLinks(userId, linkId, nowSeconds()), 'write');
  return json({ ok: true });
};

const OPEN_ON_ACTIVE_LINKS = `FROM coproducer_requests r JOIN coproducer_links l ON l.id = r.link_id AND l.user_id = r.user_id
   WHERE r.user_id = ? AND l.expires_at > ?`;

/** O4, O5 and O6: the count, a page of the inbox, or one request. */
const inbox: Handler<string> = async (_req, db, userId, url) => {
  const now = nowSeconds();
  if (url.searchParams.get('count') === '1') {
    const row = (await db.execute({
      sql: `SELECT (SELECT COUNT(*) ${OPEN_ON_ACTIVE_LINKS} AND r.status IN ${OPEN}),
                   (SELECT COUNT(*) FROM coproducer_links WHERE user_id = ? AND expires_at > ?)`,
      args: [userId, now, userId, now],
    })).rows[0];
    return json({ open: Number(row[0]), links: Number(row[1]) });
  }
  if (url.searchParams.has('id')) {
    const id = oneId(url);
    const row = (await db.execute({
      sql: `SELECT ${REQUEST_ROW_COLUMNS}, payload, result FROM coproducer_requests WHERE id = ? AND user_id = ?`,
      args: [id, userId],
    })).rows[0];
    if (!row) refuse('not_found', 404);
    return json({ request: ownerDetail(row) });
  }
  const status = url.searchParams.get('status');
  if (status !== 'open' && status !== 'recent') refuse('bad_request', 400);
  const after = url.searchParams.get('after');
  let cursor: [number, string] | null = null;
  if (after !== null) {
    const match = /^(\d{1,12}):(.{1,100})$/.exec(after);
    if (!match) refuse('bad_request', 400);
    cursor = [Number(match[1]), match[2]];
  }
  const columns = REQUEST_ROW_COLUMNS.split(', ').map((column) => `r.${column}`).join(', ');
  const open = status === 'open';
  const where = open ? `r.status IN ${OPEN}` : `r.decided_at IS NOT NULL AND r.decided_at >= ?`;
  const page = open
    ? (cursor ? 'AND (r.created_at > ? OR (r.created_at = ? AND r.id > ?))' : '')
    : (cursor ? 'AND (r.created_at < ? OR (r.created_at = ? AND r.id < ?))' : '');
  const args: (string | number)[] = [userId, now];
  if (!open) args.push(now - RECENT_SECONDS);
  if (cursor) args.push(cursor[0], cursor[0], cursor[1]);
  args.push(INBOX_PAGE + 1);
  const rows = (await db.execute({
    sql: `SELECT ${columns} ${OPEN_ON_ACTIVE_LINKS} AND ${where} ${page}
           ORDER BY r.created_at ${open ? 'ASC' : 'DESC'}, r.id ${open ? 'ASC' : 'DESC'} LIMIT ?`,
    args,
  })).rows;
  const shown = rows.slice(0, INBOX_PAGE).map(ownerRow);
  const last = rows.length > INBOX_PAGE ? rows[INBOX_PAGE - 1] : null;
  return json({ requests: shown, next: last ? `${Number(last[4])}:${String(last[0])}` : null });
};

/** O7: one staged chunk, as ciphertext under the account key (the owner decrypts). */
const stagedChunk: Handler<string> = async (_req, db, userId, url) => {
  const id = url.searchParams.get('id') ?? '';
  if (!MEDIA_ID.test(id)) refuse('bad_request', 400);
  const seq = seqParam(url);
  const row = (await db.execute({
    sql: 'SELECT data, total FROM coproducer_media WHERE user_id = ? AND id = ? AND seq = ?',
    args: [userId, id, seq],
  })).rows[0];
  if (!row) refuse('not_found', 404);
  return json({ data: String(row[0]), total: Number(row[1]) });
};

async function openRequest(db: Client, userId: string, id: string): Promise<RequestStatus> {
  const row = (await db.execute({ sql: 'SELECT status FROM coproducer_requests WHERE id = ? AND user_id = ?', args: [id, userId] })).rows[0];
  if (!row) refuse('not_found', 404);
  return String(row[0]) as RequestStatus;
}

/**
 * O8: the files a request carries, copied into the owner's media byte for
 * byte (they were encrypted in user_media's own format) and out of staging.
 * Safe to repeat.
 */
const adopt: Handler<string> = async (req, db, userId) => {
  const body = await readBody(req, SMALL_BODY_CHARS);
  onlyKeys(body, ['id']);
  const id = rowId(body.id);
  const status = await openRequest(db, userId, id);
  if (status !== 'pending' && status !== 'stale') refuse('not_open', 409);
  const stillOpen = `EXISTS (SELECT 1 FROM coproducer_requests WHERE id = ? AND user_id = ? AND status IN ${OPEN})`;
  const [copied] = await db.batch([
    {
      sql: `INSERT INTO user_media (user_id, id, seq, total, data)
            SELECT user_id, id, seq, total, data FROM coproducer_media
             WHERE request_id = ? AND user_id = ? AND ${stillOpen}
            ON CONFLICT(user_id, id, seq) DO NOTHING`,
      args: [id, userId, id, userId],
    },
    { sql: `DELETE FROM coproducer_media WHERE request_id = ? AND user_id = ? AND ${stillOpen}`, args: [id, userId, id, userId] },
  ], 'write');
  return json({ ok: true, adopted: copied.rowsAffected });
};

async function requestRow(db: Client, userId: string, id: string) {
  const row = (await db.execute({ sql: `SELECT ${REQUEST_ROW_COLUMNS} FROM coproducer_requests WHERE id = ? AND user_id = ?`, args: [id, userId] })).rows[0];
  if (!row) refuse('not_found', 404);
  return ownerRow(row);
}

function optionalCipher(value: unknown, max: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value === '') refuse('bad_request', 400);
  if (value.length > max) refuse('payload_too_large', 413);
  return value;
}

/** O9: decide one request. Each decision is one conditional update, so a request is decided once. */
const decide: Handler<string> = async (req, db, userId) => {
  const body = await readBody(req, DECIDE_BODY_CHARS);
  onlyKeys(body, ['id', 'decision', 'result', 'handout']);
  const id = rowId(body.id);
  const decision = body.decision;
  if (decision !== 'approved' && decision !== 'rejected' && decision !== 'stale') refuse('bad_request', 400);
  const result = optionalCipher(body.result, COPRODUCER_LIMITS.maxResultChars);
  const handout = optionalCipher(body.handout, COPRODUCER_LIMITS.maxHandoutChars);
  if (decision !== 'approved' && (result !== undefined || handout !== undefined)) refuse('bad_request', 400);
  const now = nowSeconds();
  let changed: number;
  if (decision === 'stale') {
    changed = (await db.execute({
      sql: `UPDATE coproducer_requests SET status = 'stale' WHERE id = ? AND user_id = ? AND status = 'pending'`,
      args: [id, userId],
    })).rowsAffected;
  } else if (decision === 'rejected') {
    const [update] = await db.batch([
      { sql: `UPDATE coproducer_requests SET status = 'rejected', decided_at = ? WHERE id = ? AND user_id = ? AND status IN ${OPEN}`, args: [now, id, userId] },
      { sql: `DELETE FROM coproducer_media WHERE request_id = ? AND user_id = ? AND EXISTS (SELECT 1 FROM coproducer_requests WHERE id = ? AND user_id = ? AND status = 'rejected')`, args: [id, userId, id, userId] },
    ], 'write');
    changed = update.rowsAffected;
  } else {
    const tx = await db.transaction('write');
    try {
      changed = (await tx.execute({
        sql: `UPDATE coproducer_requests SET status = 'approved', decided_at = ?, result = ?,
                     bytes = length(payload) + length(outline) + length(COALESCE(?, ''))
               WHERE id = ? AND user_id = ? AND status IN ${OPEN}`,
        args: [now, result ?? null, result ?? null, id, userId],
      })).rowsAffected;
      if (changed === 1 && handout !== undefined) {
        await tx.execute({
          sql: `INSERT INTO coproducer_handouts (id, user_id, link_id, label_cipher, refs_cipher, created_at)
                SELECT ?, r.user_id, r.link_id, l.label_cipher, ?, ?
                  FROM coproducer_requests r JOIN coproducer_links l ON l.id = r.link_id AND l.user_id = r.user_id
                 WHERE r.id = ? AND r.user_id = ?`,
          args: [crypto.randomUUID(), handout, now, id, userId],
        });
        // Past the cap, the oldest go first.
        await tx.execute({
          sql: `DELETE FROM coproducer_handouts WHERE user_id = ? AND rowid NOT IN
                  (SELECT rowid FROM coproducer_handouts WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?)`,
          args: [userId, userId, COPRODUCER_LIMITS.maxHandoutsPerAccount],
        });
      }
      await tx.commit();
    } finally { tx.close(); }
  }
  if (changed !== 1) {
    await requestRow(db, userId, id);
    refuse('already_decided', 409);
  }
  return json({ request: await requestRow(db, userId, id) });
};

/** O10: mark many stale, or reject many, in one go. Only this owner's open requests change. */
const decideMany: Handler<string> = async (req, db, userId) => {
  const body = await readBody(req, 64 * 1024);
  onlyKeys(body, ['ids', 'decision']);
  const { ids, decision } = body;
  if (decision !== 'stale' && decision !== 'rejected') refuse('bad_request', 400);
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 200) refuse('bad_request', 400);
  const list = ids.map(rowId);
  if (new Set(list).size !== list.length) refuse('bad_request', 400);
  const now = nowSeconds();
  const tx = await db.transaction('write');
  try {
    const decided = (await tx.execute(decision === 'stale'
      ? { sql: `UPDATE coproducer_requests SET status = 'stale' WHERE user_id = ? AND status = 'pending' AND id IN (${placeholders(list.length)}) RETURNING id`, args: [userId, ...list] }
      : { sql: `UPDATE coproducer_requests SET status = 'rejected', decided_at = ? WHERE user_id = ? AND status IN ${OPEN} AND id IN (${placeholders(list.length)}) RETURNING id`, args: [now, userId, ...list] },
    )).rows.map((row) => String(row[0]));
    if (decision === 'rejected' && decided.length) {
      await tx.execute({ sql: `DELETE FROM coproducer_media WHERE user_id = ? AND request_id IN (${placeholders(decided.length)})`, args: [userId, ...decided] });
    }
    await tx.commit();
    return json({ decided });
  } finally { tx.close(); }
};

/** O11: what approved shares handed out, newest first. A link that has run out reads as ended before the clean-up marks it. */
const listHandouts: Handler<string> = async (_req, db, userId) => {
  const rows = (await db.execute({
    sql: `SELECT h.id, h.link_id, h.label_cipher, h.refs_cipher, h.created_at,
                 COALESCE(h.link_ended_at, (SELECT l.expires_at FROM coproducer_links l WHERE l.id = h.link_id AND l.user_id = ? AND l.expires_at <= ?))
            FROM coproducer_handouts h WHERE h.user_id = ? ORDER BY h.created_at DESC, h.rowid DESC`,
    args: [userId, nowSeconds(), userId],
  })).rows;
  const handouts: HandoutRow[] = rows.map((row) => ({
    id: String(row[0]),
    linkId: String(row[1]),
    labelCipher: String(row[2]),
    refsCipher: String(row[3]),
    createdAt: isoTime(row[4])!,
    linkEndedAt: isoTime(row[5]),
  }));
  return json({ handouts });
};

/** O12: dismiss one record of a handed-out link (withdrawing the link itself is the owner app's). */
const dismissHandout: Handler<string> = async (_req, db, userId, url) => {
  await db.execute({ sql: 'DELETE FROM coproducer_handouts WHERE id = ? AND user_id = ?', args: [oneId(url), userId] });
  return json({ ok: true });
};

// ── Co-producer routes ────────────────────────────────────────────────────

function keysOf(link: BearerLink): string[] {
  return link.legacyKey ? [link.key, link.legacyKey] : [link.key];
}

/** C1: who the link is for, and what the owner's plan holds back. */
const session: Handler<BearerLink> = async (_req, db, link) => {
  let label: unknown;
  try { label = await decryptShow<unknown>(link.labelCipher, keysOf(link)); } catch { refuse('link_unreadable', 410); }
  if (typeof label !== 'string') refuse('link_unreadable', 410);
  if (link.firstUsedAt === null) {
    await db.execute({
      sql: 'UPDATE coproducer_links SET first_used_at = ? WHERE id = ? AND user_id = ? AND first_used_at IS NULL',
      args: [nowSeconds(), link.linkId, link.userId],
    });
  }
  return json({
    link: { id: link.linkId, label, expiresAt: isoTime(link.expiresAt) },
    producerLocked: await producerLocked(db, link.userId),
  });
};

/** One stored show as the co-producer is served it, or null when it does not open. */
async function showView(link: BearerLink, id: string, data: string): Promise<{ show: Show; revision: string } | null> {
  let show: Show;
  try { show = await decryptShow<Show>(data, keysOf(link)); } catch { return null; }
  if (!show || typeof show !== 'object' || show.id !== id) return null;
  const view = await coproducerShowView(show);
  return view ? { show: view, revision: await revisionOf(data.length, data.slice(-32)) } : null;
}

/** C2: a page of shows, by id, sized by their ciphertext; or up to 50 named shows. */
const shows: Handler<BearerLink> = async (_req, db, link, url) => {
  const named = url.searchParams.get('ids');
  let sizes: { id: string; length: number }[];
  let more = false;
  if (named !== null) {
    const ids = [...new Set(named.split(','))];
    if (ids.length < 1 || ids.length > COPRODUCER_LIMITS.showsPageMaxRows || ids.some((id) => id.length < 1 || id.length > 128)) refuse('bad_request', 400);
    const rows = (await db.execute({
      sql: `SELECT id, length(encrypted_data) FROM user_shows WHERE user_id = ? AND id IN (${placeholders(ids.length)}) ORDER BY id`,
      args: [link.userId, ...ids],
    })).rows;
    sizes = rows.map((row) => ({ id: String(row[0]), length: Number(row[1]) }));
  } else {
    const after = url.searchParams.get('after') ?? '';
    if (after.length > 128) refuse('bad_request', 400);
    const rows = (await db.execute({
      sql: 'SELECT id, length(encrypted_data) FROM user_shows WHERE user_id = ? AND id > ? ORDER BY id LIMIT ?',
      args: [link.userId, after, COPRODUCER_LIMITS.showsPageMaxRows + 1],
    })).rows;
    more = rows.length > COPRODUCER_LIMITS.showsPageMaxRows;
    sizes = rows.slice(0, COPRODUCER_LIMITS.showsPageMaxRows).map((row) => ({ id: String(row[0]), length: Number(row[1]) }));
  }
  // Take shows while the page stays under its size, always at least one.
  const taken: string[] = [];
  let total = 0;
  for (const { id, length } of sizes) {
    if (taken.length > 0 && total + length > COPRODUCER_LIMITS.showsPageMaxBytes) break;
    taken.push(id);
    total += length;
  }
  if (taken.length < sizes.length) more = named === null;
  const page: { show: Show; revision: string }[] = [];
  let unreadable = 0;
  if (taken.length) {
    const rows = (await db.execute({
      sql: `SELECT id, encrypted_data FROM user_shows WHERE user_id = ? AND id IN (${placeholders(taken.length)}) ORDER BY id`,
      args: [link.userId, ...taken],
    })).rows;
    for (const row of rows) {
      const view = await showView(link, String(row[0]), String(row[1]));
      if (view) page.push(view);
      else unreadable += 1;
    }
  }
  return json({ shows: page, next: more && taken.length ? taken[taken.length - 1] : null, unreadable });
};

/** C3: every show's revision and the settings', without reading or decrypting a blob. */
const revisions: Handler<BearerLink> = async (_req, db, link) => {
  const [showRows, settingsRows] = await db.batch([
    { sql: 'SELECT id, length(encrypted_data), substr(encrypted_data, -32) FROM user_shows WHERE user_id = ? ORDER BY id', args: [link.userId] },
    { sql: 'SELECT length(encrypted_data), substr(encrypted_data, -32) FROM user_settings WHERE user_id = ?', args: [link.userId] },
  ], 'read');
  const list = await Promise.all(showRows.rows.map(async (row) => ({ id: String(row[0]), revision: await revisionOf(Number(row[1]), String(row[2])) })));
  const settings = settingsRows.rows[0];
  return json({ shows: list, settings: settings ? await revisionOf(Number(settings[0]), String(settings[1])) : null });
};

/** The owner's settings, decrypted; null when never saved. Refuses 410 when they no longer open. */
async function ownerSettings(db: Client, link: BearerLink): Promise<{ settings: AppSettings; data: string } | null> {
  const row = (await db.execute({ sql: 'SELECT encrypted_data FROM user_settings WHERE user_id = ?', args: [link.userId] })).rows[0];
  if (!row) return null;
  const data = String(row[0]);
  try {
    return { settings: await decryptShow<AppSettings>(data, keysOf(link)), data };
  } catch {
    refuse('link_unreadable', 410);
  }
}

/** C4: the settings as the co-producer is served them. */
const settings: Handler<BearerLink> = async (_req, db, link) => {
  const found = await ownerSettings(db, link);
  if (!found) return json({ settings: null, revision: null });
  const view = await coproducerSettingsView(found.settings);
  if (!view) refuse('link_unreadable', 410);
  return json({ settings: view, revision: await revisionOf(found.data.length, found.data.slice(-32)) });
};

/** A stored chunk's plaintext slice, or a refusal. */
async function plainChunk(data: string, total: number, open: (data: string) => Promise<unknown>): Promise<Response> {
  if (data.length > MAX_STORED_CHUNK_CHARS || total < 1 || total > COPRODUCER_LIMITS.maxStageChunks) refuse('not_found', 404);
  let slice: unknown;
  try { slice = await open(data); } catch { refuse('not_found', 404); }
  if (typeof slice !== 'string') refuse('not_found', 404);
  return json({ data: slice, total });
}

/** C5: one chunk of a file, as plaintext: the owner's, or one this link staged. */
const media: Handler<BearerLink> = async (_req, db, link, url) => {
  const id = url.searchParams.get('id') ?? '';
  if (!MEDIA_ID.test(id)) refuse('bad_request', 400);
  const seq = seqParam(url);
  const [owned, staged] = await db.batch([
    { sql: 'SELECT data, total FROM user_media WHERE user_id = ? AND id = ? AND seq = ?', args: [link.userId, id, seq] },
    { sql: 'SELECT data, total FROM coproducer_media WHERE user_id = ? AND link_id = ? AND id = ? AND seq = ?', args: [link.userId, link.linkId, id, seq] },
  ], 'read');
  const row = owned.rows[0] ?? staged.rows[0];
  if (!row) refuse('not_found', 404);
  return plainChunk(String(row[0]), Number(row[1]), (data) => decryptShow<unknown>(data, keysOf(link)));
};

/** C6: a headshot sent back through a details link, found by the row id the co-producer sees. */
const profilePhoto: Handler<BearerLink> = async (_req, db, link, url) => {
  const requestId = url.searchParams.get('request') ?? '';
  if (requestId.length < 1 || requestId.length > 128) refuse('bad_request', 400);
  const seq = seqParam(url);
  const found = await ownerSettings(db, link);
  const listed = found ? found.settings.profileRequests : undefined;
  const rows = Array.isArray(listed) ? listed : [];
  const request = rows.find((row) => row && typeof row === 'object' && row.id === requestId);
  const token = request?.token;
  const key = request?.key;
  if (typeof token !== 'string' || token.length < 16 || token.length > 128 || typeof key !== 'string') refuse('not_found', 404);
  if ((await signTokenOwnership(db, token, link.userId)) === 'other') refuse('not_found', 404);
  const row = (await db.execute({ sql: 'SELECT data, total FROM profile_photo WHERE token = ? AND seq = ?', args: [token, seq] })).rows[0];
  if (!row) refuse('not_found', 404);
  return plainChunk(String(row[0]), Number(row[1]), (data) => decryptForLink<unknown>(data, key));
};

/**
 * C7: one chunk of a file the co-producer wants to add, encrypted here under
 * the account key exactly as user_media holds it. Its first chunk must be a
 * kind of file the app takes, by its bytes, not its label.
 */
const stage: Handler<BearerLink> = async (req, db, link) => {
  const body = await readBody(req, STAGE_BODY_CHARS);
  onlyKeys(body, ['id', 'seq', 'total', 'data']);
  const { id, seq, total, data } = body;
  if (
    typeof id !== 'string' || !MEDIA_ID.test(id) ||
    typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0 ||
    typeof total !== 'number' || !Number.isInteger(total) || total < 1 || total > COPRODUCER_LIMITS.maxStageChunks || seq >= total ||
    typeof data !== 'string' || data.length === 0
  ) {
    refuse('bad_request', 400);
  }
  if (data.length > COPRODUCER_LIMITS.maxStageSliceChars) refuse('payload_too_large', 413);
  const now = nowSeconds();
  if (seq === 0) {
    const head = DATA_URL_HEAD.exec(data);
    const type = head?.[1].toLowerCase() ?? '';
    if (!head || !ALLOWED_MEDIA_TYPES.includes(type) || sniffMediaType(data.slice(head[0].length, head[0].length + 64)) !== type) {
      refuse('unsupported_media', 400);
    }
    await db.execute(linkStagedSweep(link.userId, link.linkId, now));
  }
  const [owned, staged] = await db.batch([
    { sql: 'SELECT 1 FROM user_media WHERE user_id = ? AND id = ? LIMIT 1', args: [link.userId, id] },
    { sql: 'SELECT link_id, request_id FROM coproducer_media WHERE user_id = ? AND id = ?', args: [link.userId, id] },
  ], 'read');
  if (owned.rows.length || staged.rows.some((row) => String(row[0]) !== link.linkId)) refuse('id_taken', 409);
  if (staged.rows.some((row) => row[1] != null)) refuse('media_in_use', 409);
  const cipher = await encryptShow(data, link.key);
  const room = await coproducerRoom(db, link.userId, link.linkId, { kind: 'stage', mediaId: id, seq, total, bytes: cipher.length });
  if (room !== 'ok') storageRefusal(room);
  await db.execute({
    sql: `INSERT INTO coproducer_media (user_id, link_id, id, seq, total, data, bytes, request_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
          ON CONFLICT(user_id, id, seq) DO UPDATE SET
            data = excluded.data, total = excluded.total, bytes = excluded.bytes, created_at = excluded.created_at
          WHERE coproducer_media.link_id = excluded.link_id AND coproducer_media.request_id IS NULL`,
    args: [link.userId, link.linkId, id, seq, total, cipher, cipher.length, now],
  });
  return json({ ok: true });
};

const KINDS: readonly RequestKind[] = ['edit', 'share', 'download'];

/** A decrypted ApprovalResult, or null when it is not one. */
function approvalResult(value: unknown): ApprovalResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some((key) => key !== 'links' && key !== 'text')) return null;
  if (result.text !== undefined && typeof result.text !== 'string') return null;
  if (result.links !== undefined) {
    if (!Array.isArray(result.links)) return null;
    for (const item of result.links) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const entry = item as Record<string, unknown>;
      if (Object.keys(entry).length !== 2 || typeof entry.label !== 'string' || typeof entry.url !== 'string') return null;
    }
  }
  return result as ApprovalResult;
}

async function openUntrusted(cipher: string, link: BearerLink): Promise<unknown> {
  const value = await decryptShow<unknown>(cipher, keysOf(link));
  checkUntrusted(value);
  return value;
}

/** A request row (id, kind, status, created_at, decided_at, used_at, outline, result) as its co-producer sees it; null when it does not open. */
async function requestView(row: ArrayLike<unknown>, link: BearerLink): Promise<CoproducerRequestView | null> {
  let outline: RequestOutline;
  try { outline = await openUntrusted(String(row[6]), link) as RequestOutline; } catch { return null; }
  let result: ApprovalResult | null = null;
  if (row[7] != null) {
    try { result = approvalResult(await openUntrusted(String(row[7]), link)); } catch { result = null; }
  }
  return {
    id: String(row[0]),
    kind: String(row[1]) as RequestKind,
    status: String(row[2]) as RequestStatus,
    createdAt: isoTime(row[3])!,
    decidedAt: isoTime(row[4]),
    usedAt: isoTime(row[5]),
    outline,
    result,
  };
}

const VIEW_COLUMNS = 'id, kind, status, created_at, decided_at, used_at, outline, result';

/**
 * Every media id named in a payload's changed values must be one the account
 * already holds, or one this link staged and this request carries; every
 * file the request says it carries must be named, staged by this link, and
 * carried by nothing else yet.
 */
async function checkMedia(db: Executor, link: BearerLink, payload: RequestPayload, mediaIds: string[]): Promise<void> {
  const refs = payload.kind === 'edit' ? changedMediaIds(payload) : [];
  const carried = new Set(mediaIds);
  const referenced = new Set(refs);
  if (mediaIds.some((id) => !referenced.has(id))) refuse('unknown_media', 400);
  const elsewhere = refs.filter((id) => !carried.has(id));
  const known = new Set<string>();
  const attached = new Set<string>();
  for (let i = 0; i < elsewhere.length; i += IDS_PER_STATEMENT) {
    const group = elsewhere.slice(i, i + IDS_PER_STATEMENT);
    const owned = await db.execute({ sql: `SELECT DISTINCT id FROM user_media WHERE user_id = ? AND id IN (${placeholders(group.length)})`, args: [link.userId, ...group] });
    const staged = await db.execute({ sql: `SELECT DISTINCT id FROM coproducer_media WHERE user_id = ? AND request_id IS NOT NULL AND id IN (${placeholders(group.length)})`, args: [link.userId, ...group] });
    for (const row of owned.rows) known.add(String(row[0]));
    for (const row of staged.rows) attached.add(String(row[0]));
  }
  for (const id of elsewhere) {
    if (known.has(id)) continue;
    refuse(attached.has(id) ? 'media_in_use' : 'unknown_media', attached.has(id) ? 409 : 400);
  }
  if (mediaIds.length) {
    const rows = (await db.execute({
      sql: `SELECT id, link_id, request_id FROM coproducer_media WHERE user_id = ? AND id IN (${placeholders(mediaIds.length)})`,
      args: [link.userId, ...mediaIds],
    })).rows;
    for (const id of mediaIds) {
      const mine = rows.filter((row) => String(row[0]) === id);
      if (mine.some((row) => row[2] != null)) refuse('media_in_use', 409);
      if (!mine.length || mine.some((row) => String(row[1]) !== link.linkId)) refuse('unknown_media', 400);
    }
  }
}

const NOBODY: KnownPeople = knownPeople([], null);

/**
 * The strict schema over a request, with the rule for people a co-producer
 * brings in (src/coproducer/newComics.ts) held against the owner's own
 * account: someone new comes with a name, a tape and social media and nothing
 * else, and someone already there is booked as before.
 *
 * Who is new is read from the account alone, never from what the request
 * says was there before. Knowing more people only ever clears a refusal, so
 * the account is read no further than a request needs: not at all for one
 * that names nobody the owner has, the settings for one that books from the
 * Rolodex, and the shows only for a name the Rolodex does not explain (an
 * act already on a bill with no entry, or booked under an older name).
 */
async function checkPayload(db: Client, link: BearerLink, raw: unknown, appOrigins: string[]): Promise<ReturnType<typeof validatePayload>> {
  let checked = validatePayload(raw, { appOrigins, people: NOBODY });
  if (checked.payload || !checked.problems.every((problem) => NEW_PERSON_PROBLEM.test(problem.problem))) return checked;
  const found = await ownerSettings(db, link);
  checked = validatePayload(raw, { appOrigins, people: knownPeople([], found?.settings ?? null) });
  if (checked.payload) return checked;
  const rows = (await db.execute({ sql: 'SELECT encrypted_data FROM user_shows WHERE user_id = ?', args: [link.userId] })).rows;
  const shows: Show[] = [];
  for (const row of rows) {
    try {
      const show = await decryptShow<Show>(String(row[0]), keysOf(link));
      if (show && typeof show === 'object') shows.push(show);
    } catch { /* A show that does not open names nobody. */ }
  }
  return validatePayload(raw, { appOrigins, people: knownPeople(shows, found?.settings ?? null) });
}

/** C8: ask for something. Checked against the strict schema, then stored encrypted under the account key. */
const createRequest: Handler<BearerLink> = async (req, db, link) => {
  const body = await readBody(req, COPRODUCER_LIMITS.maxRequestBodyChars);
  try { checkUntrusted(body); } catch { refuse('bad_request', 400); }
  onlyKeys(body, ['kind', 'payload', 'mediaIds']);
  const kind = body.kind as RequestKind;
  if (!KINDS.includes(kind)) refuse('bad_request', 400);
  const rawPayload = body.payload as Record<string, unknown> | null;
  if (!rawPayload || typeof rawPayload !== 'object' || rawPayload.kind !== kind) refuse('bad_request', 400);
  const mediaIds = body.mediaIds;
  if (
    !Array.isArray(mediaIds) || mediaIds.length > MAX_MEDIA_IDS ||
    mediaIds.some((id) => typeof id !== 'string' || !MEDIA_ID.test(id)) || new Set(mediaIds).size !== mediaIds.length
  ) {
    refuse('bad_request', 400);
  }
  const checked = await checkPayload(db, link, rawPayload, [appOrigin(req), reviewOrigin(req)]);
  if (!checked.payload) refuse('bad_request', 400, { problems: checked.problems.slice(0, 20) });
  const payload = checked.payload;
  const outline = buildOutline(payload);
  const payloadCipher = await encryptShow(payload, link.key);
  const outlineCipher = await encryptShow(outline, link.key);
  const bytes = payloadCipher.length + outlineCipher.length;
  // Under one lock: the files' owner, the room and the count cannot change
  // between the checks and the insert.
  const tx = await db.transaction('write');
  try {
    await checkMedia(tx, link, payload, mediaIds as string[]);
    const room = await coproducerRoom(tx, link.userId, link.linkId, { kind: 'request', bytes });
    if (room !== 'ok') storageRefusal(room);
    const open = (await tx.execute({
      sql: `SELECT COUNT(*) FROM coproducer_requests WHERE user_id = ? AND link_id = ? AND status IN ${OPEN}`,
      args: [link.userId, link.linkId],
    })).rows[0];
    if (Number(open[0]) >= COPRODUCER_LIMITS.maxOpenRequestsPerLink) refuse('too_many_open_requests', 409);
    const id = crypto.randomUUID();
    const now = nowSeconds();
    const statements: InStatement[] = [{
      sql: `INSERT INTO coproducer_requests (id, user_id, link_id, kind, status, payload, outline, result, media_ids, created_at, decided_at, used_at, bytes)
            VALUES (?, ?, ?, ?, 'pending', ?, ?, NULL, ?, ?, NULL, NULL, ?)`,
      args: [id, link.userId, link.linkId, kind, payloadCipher, outlineCipher, JSON.stringify(mediaIds), now, bytes],
    }];
    if ((mediaIds as string[]).length) {
      statements.push({
        sql: `UPDATE coproducer_media SET request_id = ? WHERE user_id = ? AND link_id = ? AND request_id IS NULL AND id IN (${placeholders((mediaIds as string[]).length)})`,
        args: [id, link.userId, link.linkId, ...(mediaIds as string[])],
      });
    }
    await tx.batch(statements);
    await tx.commit();
    const view: CoproducerRequestView = { id, kind, status: 'pending', createdAt: isoTime(now)!, decidedAt: null, usedAt: null, outline, result: null };
    return json({ request: view }, 201);
  } finally { tx.close(); }
};

/** C9 and C10: this link's recent requests (never their payloads), or one of them with its payload. */
const listRequests: Handler<BearerLink> = async (_req, db, link, url) => {
  if (url.searchParams.has('id')) {
    const id = oneId(url);
    const row = (await db.execute({
      sql: `SELECT ${VIEW_COLUMNS}, payload FROM coproducer_requests WHERE id = ? AND user_id = ? AND link_id = ?`,
      args: [id, link.userId, link.linkId],
    })).rows[0];
    if (!row) refuse('not_found', 404);
    const view = await requestView(row, link);
    let payload: unknown;
    try { payload = await openUntrusted(String(row[8]), link); } catch { refuse('link_unreadable', 410); }
    if (!view) refuse('link_unreadable', 410);
    return json({ request: { ...view, payload } });
  }
  const rows = (await db.execute({
    sql: `SELECT ${VIEW_COLUMNS} FROM coproducer_requests
           WHERE user_id = ? AND link_id = ?
             AND (status IN ${OPEN} OR (status IN ('approved', 'rejected') AND decided_at >= ?))
           ORDER BY created_at DESC, rowid DESC LIMIT 100`,
    args: [link.userId, link.linkId, nowSeconds() - RECENT_SECONDS],
  })).rows;
  const requests: CoproducerRequestView[] = [];
  for (const row of rows) {
    const view = await requestView(row, link);
    if (view) requests.push(view);
  }
  return json({ requests });
};

async function ownRequestKind(db: Client, link: BearerLink, id: string): Promise<{ kind: RequestKind; status: RequestStatus }> {
  const row = (await db.execute({
    sql: 'SELECT kind, status FROM coproducer_requests WHERE id = ? AND user_id = ? AND link_id = ?',
    args: [id, link.userId, link.linkId],
  })).rows[0];
  if (!row) refuse('not_found', 404);
  return { kind: String(row[0]) as RequestKind, status: String(row[1]) as RequestStatus };
}

/** C11: withdraw a request still waiting; the files it carried go with it. */
const withdrawRequest: Handler<BearerLink> = async (_req, db, link, url) => {
  const id = oneId(url);
  const [update] = await db.batch([
    {
      sql: `UPDATE coproducer_requests SET status = 'withdrawn', decided_at = ? WHERE id = ? AND user_id = ? AND link_id = ? AND status IN ${OPEN}`,
      args: [nowSeconds(), id, link.userId, link.linkId],
    },
    {
      sql: `DELETE FROM coproducer_media WHERE request_id = ? AND user_id = ? AND link_id = ?
              AND EXISTS (SELECT 1 FROM coproducer_requests WHERE id = ? AND user_id = ? AND link_id = ? AND status = 'withdrawn')`,
      args: [id, link.userId, link.linkId, id, link.userId, link.linkId],
    },
  ], 'write');
  if (update.rowsAffected !== 1) {
    await ownRequestKind(db, link, id);
    refuse('already_decided', 409);
  }
  return json({ ok: true });
};

/** C12: an approved share or download was handed over. A record for the owner, not a limit. */
const markUsed: Handler<BearerLink> = async (req, db, link) => {
  const body = await readBody(req, SMALL_BODY_CHARS);
  onlyKeys(body, ['id']);
  const id = rowId(body.id);
  const changed = (await db.execute({
    sql: `UPDATE coproducer_requests SET used_at = COALESCE(used_at, ?)
           WHERE id = ? AND user_id = ? AND link_id = ? AND status = 'approved' AND kind != 'edit'`,
    args: [nowSeconds(), id, link.userId, link.linkId],
  })).rowsAffected;
  if (changed !== 1) {
    await ownRequestKind(db, link, id);
    refuse('not_approved', 409);
  }
  return json({ ok: true });
};

// ── Dispatch ──────────────────────────────────────────────────────────────

/** Rate buckets for co-producer calls: per link and address, and (for uploads) per link across addresses. */
const BUCKETS = {
  read: { max: 300, window: 600 },
  rev: { max: 120, window: 600 },
  media: { max: 600, window: 600 },
  stage: { max: 400, window: 600, all: 600 },
  write: { max: 120, window: 600 },
} as const;
type Bucket = keyof typeof BUCKETS;

const OWNER_ROUTES: Record<string, Partial<Record<Method, Handler<string>>>> = {
  links: { GET: listLinks, POST: createLink, DELETE: deleteLinks },
  inbox: { GET: inbox },
  staged: { GET: stagedChunk },
  adopt: { POST: adopt },
  decide: { POST: decide },
  'decide-many': { POST: decideMany },
  handouts: { GET: listHandouts, DELETE: dismissHandout },
};

const COPRODUCER_ROUTES: Record<string, Partial<Record<Method, [Handler<BearerLink>, Bucket]>>> = {
  session: { GET: [session, 'read'] },
  revisions: { GET: [revisions, 'rev'] },
  shows: { GET: [shows, 'read'] },
  settings: { GET: [settings, 'read'] },
  media: { GET: [media, 'media'] },
  'profile-photo': { GET: [profilePhoto, 'media'] },
  stage: { PUT: [stage, 'stage'] },
  requests: { GET: [listRequests, 'read'], POST: [createRequest, 'write'], DELETE: [withdrawRequest, 'write'] },
  use: { POST: [markUsed, 'write'] },
};

async function withinLimits(db: Client, req: Request, link: BearerLink, bucket: Bucket): Promise<void> {
  const limit = BUCKETS[bucket];
  const checks = [rateLimit(db, `coprod:${bucket}:${link.linkId}:${clientAddress(req)}`, limit.max, limit.window)];
  if ('all' in limit) checks.push(rateLimit(db, `coprod:${bucket}:${link.linkId}:all`, limit.all, limit.window));
  if ((await Promise.all(checks)).some((answer) => !answer.allowed)) refuse('too_many_requests', 429);
}

export default async function handler(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const route = url.searchParams.get('route') ?? '';
    const method = req.method as Method;
    const owner = Object.hasOwn(OWNER_ROUTES, route) ? OWNER_ROUTES[route] : null;
    const coproducer = Object.hasOwn(COPRODUCER_ROUTES, route) ? COPRODUCER_ROUTES[route] : null;
    if (!owner && !coproducer) return respond(json({ error: 'not_found' }, 404));
    const origin = req.headers.get('origin');
    if (owner) {
      const run = Object.hasOwn(owner, method) ? owner[method] : undefined;
      if (!run) return respond(json({ error: 'method_not_allowed' }, 405));
      // The owner works from the app's own origin, never the review origin.
      if (origin && origin !== appOrigin(req)) return respond(json({ error: 'invalid_origin' }, 403));
      await ensureSchema();
      const db = getDb();
      const userId = await authorize(req);
      if (!userId) return respond(json({ error: 'unauthorized' }, 401));
      if (method === 'POST' || method === 'DELETE') await db.batch(COPRODUCER_SWEEP(nowSeconds()), 'write');
      return respond(await run(req, db, userId, url));
    }
    const entry = Object.hasOwn(coproducer!, method) ? coproducer![method] : undefined;
    if (!entry) return respond(json({ error: 'method_not_allowed' }, 405));
    // A co-producer works only from the review origin.
    if (origin && origin !== reviewOrigin(req)) return respond(json({ error: 'invalid_origin' }, 403));
    await ensureSchema();
    const db = getDb();
    const link = await bearerLink(db, req);
    await withinLimits(db, req, link, entry[1]);
    if (method === 'POST' || method === 'DELETE') await db.batch(COPRODUCER_HOLDER_SWEEP(nowSeconds()), 'write');
    return respond(await entry[0](req, db, link, url));
  } catch (err) {
    if (err instanceof CoproducerError) return respond(json({ error: err.code, ...err.extra }, err.status));
    if (err instanceof TooManyRequestsError) return respond(json({ error: 'too_many_requests' }, 429));
    if (err instanceof ServerNotConfiguredError) return respond(json({ error: 'server_not_configured' }, 503));
    // This route holds delegated keys and the account's plaintext while it
    // works: nothing about the request or the error goes to the logs.
    return respond(json({ error: 'server_error' }, 500));
  }
}

export const config = { runtime: 'edge' };
