import { createHash, randomBytes, randomUUID } from 'node:crypto';
import CryptoJS from 'crypto-js';
import { MAIN_ORIGIN, REVIEW_ORIGIN } from './coproduceOrigins.mjs';
/**
 * The fake API's /api/coproducer: a mirror of api/coproducer.ts, for the
 * end-to-end specs. Every rule here is one the real route keeps, with its
 * constants copied over; see that file for why each is there.
 *
 * What differs, on purpose:
 * - The fake holds one account's shows, settings and media (FakeState), so
 *   the owner of every link reads that one account.
 * - Link keys are kept unsealed (the seal is covered by the unit tests in
 *   src/utils/serverSeal.test.ts); the token itself is still kept only as
 *   its hash.
 * - The strict schema, the outline and the drop-mode sanitising are the
 *   app's own modules (src/coproducer/schema.ts, outline.ts, untrusted.ts),
 *   loaded through the loader the specs run under. Plain node cannot load
 *   them, so they load when a spec installs the fake, never at import:
 *   scripts/capture-screenshots.mjs imports this file too and never calls
 *   this route.
 * - The redaction rules are a copy of api/_lib/coproducerViews.ts.
 * - The account-key cipher is CryptoJS, as in the app; the server's own
 *   copy of the format is api/_lib/chatgptCipher.ts.
 * - Origins are the two the suite serves (coproduceOrigins.mjs).
 */

// ── Constants copied from the code they mirror ──────────────────────────────
// src/coproducer/types.ts COPRODUCER_LIMITS
const LIMITS = {
  linkSeconds: 30 * 24 * 60 * 60,
  maxLinksPerAccount: 20,
  maxOpenRequestsPerLink: 200,
  maxRequestBodyChars: 2_000_000,
  maxOpenRequestBytesPerLink: 50_000_000,
  maxStagedBytesPerLink: 200_000_000,
  maxUnattachedStagedFilesPerLink: 20,
  maxCoproducerBytesPerAccount: 1_000_000_000,
  maxResultChars: 65_536,
  maxHandoutChars: 16_384,
  maxLabelChars: 60,
  maxStageSliceChars: 1_600_000,
  maxStageChunks: 64,
  showsPageMaxRows: 50,
  showsPageMaxBytes: 8_000_000,
  maxHandoutsPerAccount: 500,
};
// src/coproducer/types.ts
const PSEUDONYM_LABEL = 'icanrunashow coproducer token v1:';
const REDACTED_TOKEN_PREFIX = 'redacted-';
// api/coproducer.ts
const HEX_KEY = /^[a-f0-9]{64}$/i;
const CONTROL = /[\p{Cc}\p{Cf}]/u;
const MEDIA_ID = /^[A-Za-z0-9-]{8,64}$/;
const DATA_URL_HEAD = /^data:([^;,]+);base64,/;
const CREATE_BODY_CHARS = 16 * 1024;
const SMALL_BODY_CHARS = 4 * 1024;
const DECIDE_BODY_CHARS = LIMITS.maxResultChars + LIMITS.maxHandoutChars + 4 * 1024;
const STAGE_BODY_CHARS = LIMITS.maxStageSliceChars + 1024;
const MAX_STORED_CHUNK_CHARS = 3_500_000;
const INBOX_PAGE = 100;
const RECENT_SECONDS = 7 * 24 * 60 * 60;
const MAX_MEDIA_IDS = 100;
const OPEN = ['pending', 'stale'];
const BUCKETS = {
  read: { max: 300, window: 600 },
  rev: { max: 120, window: 600 },
  media: { max: 600, window: 600 },
  stage: { max: 400, window: 600, all: 600 },
  write: { max: 120, window: 600 },
};
// api/_lib/coproducerAuth.ts
const MAX_FAILURES = 30;
const FAILURE_WINDOW_SECONDS = 300;
// api/_lib/coproducerRequests.ts
const DAY = 24 * 60 * 60;

const OWNER_ROUTES = {
  links: ['GET', 'POST', 'DELETE'],
  inbox: ['GET'],
  staged: ['GET'],
  adopt: ['POST'],
  decide: ['POST'],
  'decide-many': ['POST'],
  handouts: ['GET', 'DELETE'],
};
const COPRODUCER_ROUTES = {
  session: { GET: 'read' },
  revisions: { GET: 'rev' },
  shows: { GET: 'read' },
  settings: { GET: 'read' },
  media: { GET: 'media' },
  'profile-photo': { GET: 'media' },
  stage: { PUT: 'stage' },
  requests: { GET: 'read', POST: 'write', DELETE: 'write' },
  use: { POST: 'write' },
};

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const nowSeconds = () => Math.floor(Date.now() / 1000);
const iso = (seconds) => (seconds == null ? null : new Date(seconds * 1000).toISOString());
let order = 0;

/** The app's account-key cipher (src/utils/encryption.ts encryptWithKey). */
function encrypt(data, key) {
  return CryptoJS.AES.encrypt(JSON.stringify(data), key).toString();
}
/** decryptWithKeys: the first key that opens it. Throws when none does. */
function decrypt(cipher, keys) {
  for (const key of keys) {
    if (!key) continue;
    try {
      const text = CryptoJS.AES.decrypt(cipher, key).toString(CryptoJS.enc.Utf8);
      if (text) return JSON.parse(text);
    } catch {
      // The next key, as the app reads older rows.
    }
  }
  throw new Error('decryption failed');
}

let modules = null;
/**
 * The app's schema, outline and untrusted-JSON modules. Loaded once, when a
 * spec installs the fake, through the loader the specs run under.
 */
export async function loadCoproducerModules() {
  if (!modules) {
    const [schema, outline, untrusted] = await Promise.all([
      import('../../src/coproducer/schema'),
      import('../../src/coproducer/outline'),
      import('../../src/coproducer/untrusted'),
    ]);
    modules = { schema, outline, untrusted };
  }
  return modules;
}

/** An outline for a seeded payload: the app's buildOutline when it can read it, else just the kind. */
function outlineOf(payload, kind) {
  try {
    if (modules) return modules.outline.buildOutline(payload);
  } catch {
    // A seeded payload the outline cannot read; the owner's app rebuilds
    // the headline from the payload itself.
  }
  return { kind: payload?.kind ?? kind };
}

class Refusal extends Error {
  constructor(status, code, extra = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
const refuse = (status, code, extra) => { throw new Refusal(status, code, extra); };

// ── Redaction: a copy of api/_lib/coproducerViews.ts ────────────────────────
function pseudonym(token) {
  return REDACTED_TOKEN_PREFIX + sha256(PSEUDONYM_LABEL + token).slice(0, 32);
}
const isBag = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
function redactToken(holder, field) {
  if (!Object.hasOwn(holder, field)) return;
  const value = holder[field];
  if (typeof value === 'string' && value !== '') holder[field] = pseudonym(value);
  else if (value !== '') delete holder[field];
}
function redactShowInPlace(show) {
  redactToken(show, 'viewToken');
  delete show.viewerKey;
}
function showView(show) {
  const copy = JSON.parse(JSON.stringify(show));
  if (isBag(copy)) redactShowInPlace(copy);
  return modules.schema.sanitizeShow(copy);
}
function settingsView(settings) {
  if (!isBag(settings)) return null;
  const copy = JSON.parse(JSON.stringify(settings));
  if (Array.isArray(copy.trash)) {
    for (const item of copy.trash) if (isBag(item) && isBag(item.data)) redactShowInPlace(item.data);
  }
  for (const field of ['signatureRequests', 'profileRequests']) {
    if (!Array.isArray(copy[field])) continue;
    for (const row of copy[field]) {
      if (!isBag(row)) continue;
      redactToken(row, 'token');
      row.key = '';
    }
  }
  return modules.schema.sanitizeSettings(copy);
}

const revisionOf = (data) => sha256(`${data.length}:${data.slice(-32)}`);

// ── Helpers for specs ───────────────────────────────────────────────────────

/** The co-producer tables, for a state built before they existed. */
function ensure(state) {
  state.coproducerLinks ??= {};
  state.coproducerRequests ??= {};
  state.coproducerMedia ??= {};
  state.coproducerHandouts ??= {};
  return state;
}

function linkByToken(state, token) {
  ensure(state);
  const hash = sha256(token);
  return Object.values(state.coproducerLinks).find((link) => link.tokenHash === hash) ?? null;
}

/** Seconds from a number (seconds, or milliseconds past 1e11), a Date or an ISO string. */
function toSeconds(value) {
  if (value instanceof Date) return Math.floor(value.getTime() / 1000);
  if (typeof value === 'string') return Math.floor(Date.parse(value) / 1000);
  return value > 1e11 ? Math.floor(value / 1000) : value;
}

/**
 * Make a link as POST ?route=links would, and return its raw token. The
 * owner's account must be in state.users (sign up first): the real lookup
 * joins users, so a link whose owner is gone opens nothing.
 * `expiresAt` is epoch seconds or milliseconds, a Date or an ISO string;
 * thirty days from now when left out.
 *
 * @param {import('./fake-api.mjs').FakeState} state
 * @param {{userId: string, key: string, legacyKey?: string, label?: string, expiresAt?: number | string | Date}} link
 */
export function addCoproducerLink(state, { userId, key, legacyKey, label = 'Sam Rivera', expiresAt }) {
  ensure(state);
  const token = randomBytes(32).toString('base64url');
  const id = randomUUID();
  const now = nowSeconds();
  state.coproducerLinks[id] = {
    id,
    userId,
    tokenHash: sha256(token),
    key,
    legacyKey: legacyKey ?? '',
    labelCipher: encrypt(label, key),
    createdAt: now,
    expiresAt: expiresAt === undefined ? now + LIMITS.linkSeconds : toSeconds(expiresAt),
    firstUsedAt: null,
    lastUsedAt: null,
    order: order++,
  };
  return token;
}

/**
 * Store a request as POST ?route=requests would: payload and outline
 * encrypted under the link's key. No validation, so specs can seed requests
 * the owner's app must refuse. Files named in `mediaIds` that the link
 * staged are attached to it. Returns the request's id.
 *
 * @param {import('./fake-api.mjs').FakeState} state
 * @param {{token: string, kind: string, payload: unknown, status?: string, mediaIds?: string[]}} request
 */
export function addCoproducerRequest(state, { token, kind, payload, status = 'pending', mediaIds = [] }) {
  const link = linkByToken(state, token);
  if (!link) throw new Error('addCoproducerRequest: no link has that token');
  const id = randomUUID();
  const payloadCipher = encrypt(payload, link.key);
  const outlineCipher = encrypt(outlineOf(payload, kind), link.key);
  const decided = OPEN.includes(status) ? null : nowSeconds();
  state.coproducerRequests[id] = {
    id,
    userId: link.userId,
    linkId: link.id,
    kind,
    status,
    payload: payloadCipher,
    outline: outlineCipher,
    result: null,
    mediaIds: [...mediaIds],
    createdAt: nowSeconds(),
    decidedAt: decided,
    usedAt: null,
    bytes: payloadCipher.length + outlineCipher.length,
    order: order++,
  };
  for (const mediaId of mediaIds) {
    const staged = state.coproducerMedia[mediaId];
    if (staged && staged.linkId === link.id && staged.requestId === null) staged.requestId = id;
  }
  return id;
}

/**
 * A stored request, decrypted with the account key, for assertions.
 * @returns {{status: string, payload: unknown, outline: unknown, result: unknown, usedAt: string | null, mediaIds: string[]} | null}
 */
export function readCoproducerRequest(state, id, key) {
  ensure(state);
  const row = state.coproducerRequests[id];
  if (!row) return null;
  return {
    status: row.status,
    payload: decrypt(row.payload, [key]),
    outline: decrypt(row.outline, [key]),
    result: row.result === null ? null : decrypt(row.result, [key]),
    usedAt: iso(row.usedAt),
    mediaIds: [...row.mediaIds],
  };
}

/**
 * Decide a request as the owner's app would through POST ?route=decide, for
 * co-producer specs. `result` is a plaintext ApprovalResult, encrypted here
 * under the link's key.
 */
export function decideCoproducerRequest(state, id, decision, result) {
  ensure(state);
  const row = state.coproducerRequests[id];
  if (!row) throw new Error('decideCoproducerRequest: no such request');
  const link = state.coproducerLinks[row.linkId];
  row.status = decision;
  if (decision !== 'stale') row.decidedAt = nowSeconds();
  if (decision === 'approved' && result !== undefined) row.result = encrypt(result, link.key);
  if (decision === 'rejected') dropMedia(state, (media) => media.requestId === id);
  row.bytes = row.payload.length + row.outline.length + (row.result?.length ?? 0);
}

// ── Storage and clean-up: api/_lib/coproducerRequests.ts ────────────────────

function dropMedia(state, drop) {
  for (const [id, media] of Object.entries(state.coproducerMedia)) if (drop(media)) delete state.coproducerMedia[id];
}
const mediaBytes = (media) => media.chunks.reduce((sum, chunk) => sum + (chunk?.data.length ?? 0), 0);

function room(state, userId, linkId, write) {
  const staged = Object.values(state.coproducerMedia).filter((m) => m.userId === userId && m.linkId === linkId);
  const linkStaged = staged.reduce((sum, m) => sum + mediaBytes(m), 0);
  const open = Object.values(state.coproducerRequests).filter((r) => r.userId === userId && OPEN.includes(r.status));
  const account = Object.values(state.coproducerMedia).filter((m) => m.userId === userId).reduce((sum, m) => sum + mediaBytes(m), 0)
    + open.reduce((sum, r) => sum + r.bytes, 0);
  if (write.kind === 'stage') {
    const file = state.coproducerMedia[write.mediaId];
    const mine = file && file.linkId === linkId ? file : null;
    const replaced = mine ? mine.chunks.reduce((sum, chunk, seq) => sum + ((seq === write.seq || write.seq === 0) ? (chunk?.data.length ?? 0) : 0), 0) : 0;
    const unattached = staged.filter((m) => m.requestId === null).length;
    if (write.seq === 0 && !mine && unattached >= LIMITS.maxUnattachedStagedFilesPerLink) return 'too_many_files';
    const adding = write.seq === 0 ? write.bytes * write.total : write.bytes;
    if (linkStaged - replaced + adding > LIMITS.maxStagedBytesPerLink) return 'link_full';
    if (account - replaced + adding > LIMITS.maxCoproducerBytesPerAccount) return 'account_full';
    return 'ok';
  }
  const linkOpen = open.filter((r) => r.linkId === linkId).reduce((sum, r) => sum + r.bytes, 0);
  if (linkOpen + write.bytes > LIMITS.maxOpenRequestBytesPerLink) return 'link_full';
  if (account + write.bytes > LIMITS.maxCoproducerBytesPerAccount) return 'account_full';
  return 'ok';
}

function retention(state, now) {
  const ended = new Set(Object.values(state.coproducerLinks).filter((l) => l.expiresAt <= now).map((l) => l.id));
  dropMedia(state, (m) => ended.has(m.linkId));
  for (const [id, r] of Object.entries(state.coproducerRequests)) {
    if (ended.has(r.linkId)
      || (['rejected', 'withdrawn'].includes(r.status) && r.decidedAt <= now - 7 * DAY)
      || (r.status === 'approved' && r.decidedAt <= now - 30 * DAY)) {
      delete state.coproducerRequests[id];
    }
  }
  dropMedia(state, (m) => m.requestId === null && m.createdAt <= now - DAY);
  dropMedia(state, (m) => m.requestId !== null && !OPEN.includes(state.coproducerRequests[m.requestId]?.status));
  return ended;
}

/** COPRODUCER_SWEEP: what the owner's writes clean up first. */
function ownerSweep(state, now) {
  const ended = new Set(Object.values(state.coproducerLinks).filter((l) => l.expiresAt <= now).map((l) => l.id));
  for (const h of Object.values(state.coproducerHandouts)) if (h.linkEndedAt === null && ended.has(h.linkId)) h.linkEndedAt = now;
  retention(state, now);
  for (const id of ended) delete state.coproducerLinks[id];
}

/** Withdraw one link or all of an owner's: handouts kept and marked ended, the rest gone. */
function withdraw(state, userId, linkId, now) {
  const links = Object.values(state.coproducerLinks).filter((l) => l.userId === userId && (linkId === null || l.id === linkId)).map((l) => l.id);
  const gone = new Set(links);
  for (const h of Object.values(state.coproducerHandouts)) if (h.userId === userId && gone.has(h.linkId) && h.linkEndedAt === null) h.linkEndedAt = now;
  dropMedia(state, (m) => m.userId === userId && gone.has(m.linkId));
  for (const [id, r] of Object.entries(state.coproducerRequests)) if (r.userId === userId && gone.has(r.linkId)) delete state.coproducerRequests[id];
  for (const id of links) delete state.coproducerLinks[id];
}

/** api/account.ts: everything co-producer the account owns, and the throttles under its links. */
export function deleteCoproducerAccount(state, userId) {
  ensure(state);
  const links = new Set(Object.values(state.coproducerLinks).filter((l) => l.userId === userId).map((l) => l.id));
  for (const bucket of Object.keys(state.rateLimits)) {
    if (bucket === `coprod:create:${userId}` || (bucket.startsWith('coprod:') && [...links].some((id) => bucket.includes(`:${id}:`)))) {
      delete state.rateLimits[bucket];
    }
  }
  dropMedia(state, (m) => m.userId === userId);
  for (const [id, r] of Object.entries(state.coproducerRequests)) if (r.userId === userId) delete state.coproducerRequests[id];
  for (const [id, h] of Object.entries(state.coproducerHandouts)) if (h.userId === userId) delete state.coproducerHandouts[id];
  for (const id of links) delete state.coproducerLinks[id];
}

// ── Rows as the routes answer them ──────────────────────────────────────────

function linkInfo(state, link) {
  const open = Object.values(state.coproducerRequests).filter((r) => r.userId === link.userId && r.linkId === link.id && OPEN.includes(r.status));
  const staged = Object.values(state.coproducerMedia).filter((m) => m.userId === link.userId && m.linkId === link.id);
  return {
    id: link.id,
    labelCipher: link.labelCipher,
    createdAt: iso(link.createdAt),
    expiresAt: iso(link.expiresAt),
    firstUsedAt: iso(link.firstUsedAt),
    lastUsedAt: iso(link.lastUsedAt),
    openRequests: open.length,
    storageBytes: open.reduce((sum, r) => sum + r.bytes, 0) + staged.reduce((sum, m) => sum + mediaBytes(m), 0),
    handouts: Object.values(state.coproducerHandouts).filter((h) => h.userId === link.userId && h.linkId === link.id).length,
  };
}

function ownerRow(r) {
  return {
    id: r.id,
    linkId: r.linkId,
    kind: r.kind,
    status: r.status,
    createdAt: iso(r.createdAt),
    decidedAt: iso(r.decidedAt),
    usedAt: iso(r.usedAt),
    outline: r.outline,
    mediaIds: [...r.mediaIds],
    bytes: r.bytes,
  };
}

function approvalResult(value) {
  if (!isBag(value) || Object.keys(value).some((key) => key !== 'links' && key !== 'text')) return null;
  if (value.text !== undefined && typeof value.text !== 'string') return null;
  if (value.links !== undefined) {
    if (!Array.isArray(value.links)) return null;
    for (const item of value.links) {
      if (!isBag(item) || Object.keys(item).length !== 2 || typeof item.label !== 'string' || typeof item.url !== 'string') return null;
    }
  }
  return value;
}

function requestView(r, keys) {
  let outline;
  try {
    outline = decrypt(r.outline, keys);
    modules.untrusted.checkUntrusted(outline);
  } catch {
    return null;
  }
  let result = null;
  if (r.result !== null) {
    try {
      const value = decrypt(r.result, keys);
      modules.untrusted.checkUntrusted(value);
      result = approvalResult(value);
    } catch {
      result = null;
    }
  }
  return { id: r.id, kind: r.kind, status: r.status, createdAt: iso(r.createdAt), decidedAt: iso(r.decidedAt), usedAt: iso(r.usedAt), outline, result };
}

// ── The route ───────────────────────────────────────────────────────────────

/**
 * Answer one call to /api/coproducer. `ctx` carries what the fake's route
 * handler already has: the state, the request's parts, its own authorize
 * and the shared rate limiter.
 */
export async function handleCoproducer(ctx) {
  const { state, route, url, method, headers, raw, address, authorize, refused, rateLimit, rateLimitPeek } = ctx;
  ensure(state);
  const reply = (status, data) => route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'cache-control': 'no-store', pragma: 'no-cache', 'x-content-type-options': 'nosniff' },
    body: JSON.stringify(data),
  });
  try {
    await loadCoproducerModules();
    const name = url.searchParams.get('route') ?? '';
    const ownerMethods = Object.hasOwn(OWNER_ROUTES, name) ? OWNER_ROUTES[name] : null;
    const holderMethods = Object.hasOwn(COPRODUCER_ROUTES, name) ? COPRODUCER_ROUTES[name] : null;
    if (!ownerMethods && !holderMethods) return reply(404, { error: 'not_found' });
    const origin = headers.origin;
    const now = nowSeconds();

    const body = (max) => {
      if (raw.length > max) refuse(413, 'payload_too_large');
      let value;
      try { value = JSON.parse(raw); } catch { refuse(400, 'bad_request'); }
      if (!isBag(value)) refuse(400, 'bad_request');
      return value;
    };
    const onlyKeys = (value, allowed) => { if (Object.keys(value).some((key) => !allowed.includes(key))) refuse(400, 'bad_request'); };
    const rowId = (value) => (typeof value === 'string' && value.length >= 1 && value.length <= 100 ? value : refuse(400, 'bad_request'));
    const oneId = () => {
      const ids = url.searchParams.getAll('id');
      if (ids.length !== 1) refuse(400, 'bad_request');
      return rowId(ids[0]);
    };
    const seqParam = () => {
      const value = url.searchParams.get('seq');
      if (value === null || !/^\d{1,3}$/.test(value)) refuse(400, 'bad_request');
      return Number(value);
    };
    const storageRefusal = (answer) => (answer === 'too_many_files'
      ? refuse(409, 'too_many_staged_files')
      : refuse(413, 'coproducer_storage_full', { reason: answer }));

    // ── Owner routes ──
    if (ownerMethods) {
      if (!ownerMethods.includes(method)) return reply(405, { error: 'method_not_allowed' });
      if (origin && origin !== MAIN_ORIGIN) return reply(403, { error: 'invalid_origin' });
      const userId = authorize();
      if (!userId) return refused();
      if (method === 'POST' || method === 'DELETE') ownerSweep(state, now);
      const requests = () => Object.values(state.coproducerRequests).filter((r) => r.userId === userId);
      const activeLinks = () => Object.values(state.coproducerLinks).filter((l) => l.userId === userId && l.expiresAt > now);

      if (name === 'links' && method === 'POST') {
        if (state.coproduceUnavailable) refuse(503, 'coproduce_not_configured');
        if (!rateLimit(`coprod:create:${userId}`, 20, 3600)) refuse(429, 'too_many_requests');
        const b = body(CREATE_BODY_CHARS);
        onlyKeys(b, ['label', 'key', 'legacyKey', 'consent']);
        const label = typeof b.label === 'string' ? b.label.trim() : '';
        if (!label || label.length > LIMITS.maxLabelChars || CONTROL.test(label)) refuse(400, 'bad_request');
        if (typeof b.key !== 'string' || !HEX_KEY.test(b.key) || typeof b.legacyKey !== 'string' || !HEX_KEY.test(b.legacyKey)) refuse(400, 'bad_request');
        if (b.consent !== true) refuse(400, 'bad_request');
        if (activeLinks().length >= LIMITS.maxLinksPerAccount) refuse(409, 'too_many_links');
        const token = addCoproducerLink(state, { userId, key: b.key, legacyKey: b.legacyKey, label });
        return reply(201, { link: linkInfo(state, linkByToken(state, token)), token });
      }
      if (name === 'links' && method === 'GET') {
        const links = activeLinks().sort((a, b) => b.createdAt - a.createdAt || b.order - a.order);
        return reply(200, { links: links.map((link) => linkInfo(state, link)) });
      }
      if (name === 'links' && method === 'DELETE') {
        withdraw(state, userId, url.searchParams.has('id') ? oneId() : null, now);
        return reply(200, { ok: true });
      }
      if (name === 'inbox') {
        const active = new Set(activeLinks().map((l) => l.id));
        if (url.searchParams.get('count') === '1') {
          return reply(200, { open: requests().filter((r) => active.has(r.linkId) && OPEN.includes(r.status)).length, links: active.size });
        }
        if (url.searchParams.has('id')) {
          const id = oneId();
          const r = requests().find((row) => row.id === id) ?? refuse(404, 'not_found');
          return reply(200, { request: { ...ownerRow(r), payload: r.payload, result: r.result } });
        }
        const status = url.searchParams.get('status');
        if (status !== 'open' && status !== 'recent') refuse(400, 'bad_request');
        const after = url.searchParams.get('after');
        let cursor = null;
        if (after !== null) {
          const match = /^(\d{1,12}):(.{1,100})$/.exec(after);
          if (!match) refuse(400, 'bad_request');
          cursor = [Number(match[1]), match[2]];
        }
        const open = status === 'open';
        const rows = requests()
          .filter((r) => active.has(r.linkId) && (open ? OPEN.includes(r.status) : r.decidedAt !== null && r.decidedAt >= now - RECENT_SECONDS))
          .sort((a, b) => (open ? 1 : -1) * (a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)))
          .filter((r) => !cursor || (open
            ? r.createdAt > cursor[0] || (r.createdAt === cursor[0] && r.id > cursor[1])
            : r.createdAt < cursor[0] || (r.createdAt === cursor[0] && r.id < cursor[1])));
        const page = rows.slice(0, INBOX_PAGE);
        const last = rows.length > INBOX_PAGE ? page[page.length - 1] : null;
        return reply(200, { requests: page.map(ownerRow), next: last ? `${last.createdAt}:${last.id}` : null });
      }
      if (name === 'staged') {
        const id = url.searchParams.get('id') ?? '';
        if (!MEDIA_ID.test(id)) refuse(400, 'bad_request');
        const seq = seqParam();
        const media = state.coproducerMedia[id];
        const chunk = media && media.userId === userId ? media.chunks[seq] : null;
        if (!chunk) refuse(404, 'not_found');
        return reply(200, { data: chunk.data, total: media.total });
      }
      if (name === 'adopt') {
        const b = body(SMALL_BODY_CHARS);
        onlyKeys(b, ['id']);
        const id = rowId(b.id);
        const r = requests().find((row) => row.id === id) ?? refuse(404, 'not_found');
        if (!OPEN.includes(r.status)) refuse(409, 'not_open');
        let adopted = 0;
        for (const [mediaId, media] of Object.entries(state.coproducerMedia)) {
          if (media.requestId !== id || media.userId !== userId) continue;
          const chunks = (state.media[mediaId] ||= []);
          media.chunks.forEach((chunk, seq) => {
            if (chunk && chunks[seq] === undefined) {
              chunks[seq] = chunk.data;
              adopted += 1;
            }
          });
          state.mediaWrittenAt[mediaId] = Date.now();
          delete state.coproducerMedia[mediaId];
        }
        return reply(200, { ok: true, adopted });
      }
      if (name === 'decide') {
        const b = body(DECIDE_BODY_CHARS);
        onlyKeys(b, ['id', 'decision', 'result', 'handout']);
        const id = rowId(b.id);
        if (!['approved', 'rejected', 'stale'].includes(b.decision)) refuse(400, 'bad_request');
        const cipher = (value, max) => {
          if (value === undefined) return undefined;
          if (typeof value !== 'string' || value === '') refuse(400, 'bad_request');
          if (value.length > max) refuse(413, 'payload_too_large');
          return value;
        };
        const result = cipher(b.result, LIMITS.maxResultChars);
        const handout = cipher(b.handout, LIMITS.maxHandoutChars);
        if (b.decision !== 'approved' && (result !== undefined || handout !== undefined)) refuse(400, 'bad_request');
        const r = requests().find((row) => row.id === id) ?? refuse(404, 'not_found');
        if (b.decision === 'stale' ? r.status !== 'pending' : !OPEN.includes(r.status)) refuse(409, 'already_decided');
        if (b.decision === 'stale') {
          r.status = 'stale';
        } else if (b.decision === 'rejected') {
          r.status = 'rejected';
          r.decidedAt = now;
          dropMedia(state, (m) => m.requestId === id && m.userId === userId);
        } else {
          r.status = 'approved';
          r.decidedAt = now;
          r.result = result ?? null;
          r.bytes = r.payload.length + r.outline.length + (r.result?.length ?? 0);
          const link = state.coproducerLinks[r.linkId];
          if (handout !== undefined && link) {
            const handoutId = randomUUID();
            state.coproducerHandouts[handoutId] = { id: handoutId, userId, linkId: r.linkId, labelCipher: link.labelCipher, refsCipher: handout, createdAt: now, linkEndedAt: null, order: order++ };
            const mine = Object.values(state.coproducerHandouts).filter((h) => h.userId === userId)
              .sort((a, b2) => b2.createdAt - a.createdAt || b2.order - a.order);
            for (const old of mine.slice(LIMITS.maxHandoutsPerAccount)) delete state.coproducerHandouts[old.id];
          }
        }
        return reply(200, { request: ownerRow(r) });
      }
      if (name === 'decide-many') {
        const b = body(64 * 1024);
        onlyKeys(b, ['ids', 'decision']);
        if (b.decision !== 'stale' && b.decision !== 'rejected') refuse(400, 'bad_request');
        if (!Array.isArray(b.ids) || b.ids.length < 1 || b.ids.length > 200) refuse(400, 'bad_request');
        const ids = b.ids.map(rowId);
        if (new Set(ids).size !== ids.length) refuse(400, 'bad_request');
        const decided = [];
        for (const r of requests()) {
          if (!ids.includes(r.id)) continue;
          if (b.decision === 'stale' && r.status === 'pending') {
            r.status = 'stale';
            decided.push(r.id);
          } else if (b.decision === 'rejected' && OPEN.includes(r.status)) {
            r.status = 'rejected';
            r.decidedAt = now;
            dropMedia(state, (m) => m.requestId === r.id && m.userId === userId);
            decided.push(r.id);
          }
        }
        return reply(200, { decided });
      }
      if (name === 'handouts' && method === 'GET') {
        const handouts = Object.values(state.coproducerHandouts).filter((h) => h.userId === userId)
          .sort((a, b) => b.createdAt - a.createdAt || b.order - a.order)
          .map((h) => {
            const link = state.coproducerLinks[h.linkId];
            const ended = h.linkEndedAt ?? (link && link.expiresAt <= now ? link.expiresAt : null);
            return { id: h.id, linkId: h.linkId, labelCipher: h.labelCipher, refsCipher: h.refsCipher, createdAt: iso(h.createdAt), linkEndedAt: iso(ended) };
          });
        return reply(200, { handouts });
      }
      if (name === 'handouts' && method === 'DELETE') {
        const id = oneId();
        if (state.coproducerHandouts[id]?.userId === userId) delete state.coproducerHandouts[id];
        return reply(200, { ok: true });
      }
      return reply(405, { error: 'method_not_allowed' });
    }

    // ── Co-producer routes ──
    const bucket = Object.hasOwn(holderMethods, method) ? holderMethods[method] : null;
    if (!bucket) return reply(405, { error: 'method_not_allowed' });
    if (origin && origin !== REVIEW_ORIGIN) return reply(403, { error: 'invalid_origin' });

    // api/_lib/coproducerAuth.ts bearerLink.
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(headers.authorization || '');
    const found = match ? linkByToken(state, match[1]) : null;
    const link = found && found.expiresAt > now && Object.hasOwn(state.users, found.userId) ? found : null;
    if (!link) {
      const failures = `coprod:fail:${address}`;
      if (!rateLimitPeek(failures, MAX_FAILURES, FAILURE_WINDOW_SECONDS)) refuse(429, 'too_many_requests');
      rateLimit(failures, MAX_FAILURES, FAILURE_WINDOW_SECONDS);
      refuse(410, 'link_ended');
    }
    if (link.lastUsedAt === null || now - link.lastUsedAt > 60) link.lastUsedAt = now;
    const keys = [link.key, link.legacyKey];
    const limit = BUCKETS[bucket];
    const within = [rateLimit(`coprod:${bucket}:${link.id}:${address}`, limit.max, limit.window)];
    if (limit.all) within.push(rateLimit(`coprod:${bucket}:${link.id}:all`, limit.all, limit.window));
    if (within.includes(false)) refuse(429, 'too_many_requests');
    if (method === 'POST' || method === 'DELETE') retention(state, now);
    const mine = () => Object.values(state.coproducerRequests).filter((r) => r.userId === link.userId && r.linkId === link.id);
    const ownSettings = () => {
      if (state.settings === null) return null;
      try {
        return decrypt(state.settings, keys);
      } catch {
        return refuse(410, 'link_unreadable');
      }
    };
    const plainChunk = (data, total, open) => {
      if (data.length > MAX_STORED_CHUNK_CHARS || total < 1 || total > LIMITS.maxStageChunks) refuse(404, 'not_found');
      let slice;
      try { slice = open(data); } catch { refuse(404, 'not_found'); }
      if (typeof slice !== 'string') refuse(404, 'not_found');
      return reply(200, { data: slice, total });
    };

    if (name === 'session') {
      let label;
      try { label = decrypt(link.labelCipher, keys); } catch { refuse(410, 'link_unreadable'); }
      if (typeof label !== 'string') refuse(410, 'link_unreadable');
      if (link.firstUsedAt === null) link.firstUsedAt = now;
      // api/_lib/plan.ts producerLocked, by the rule the fake's /api/billing
      // answers with (PAID_FEATURES_LOCKED is on in src/utils/billing.ts).
      const paid = ['active', 'trialing', 'past_due'].includes(state.billing[link.userId]?.status);
      const producerLocked = !!state.billingConfigured && !(state.founders || paid);
      return reply(200, { link: { id: link.id, label, expiresAt: iso(link.expiresAt) }, producerLocked });
    }
    if (name === 'shows') {
      const named = url.searchParams.get('ids');
      const all = [...state.shows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      let candidates;
      let more = false;
      if (named !== null) {
        const ids = [...new Set(named.split(','))];
        if (ids.length < 1 || ids.length > LIMITS.showsPageMaxRows || ids.some((id) => id.length < 1 || id.length > 128)) refuse(400, 'bad_request');
        candidates = all.filter((row) => ids.includes(row.id));
      } else {
        const after = url.searchParams.get('after') ?? '';
        const rest = all.filter((row) => row.id > after);
        more = rest.length > LIMITS.showsPageMaxRows;
        candidates = rest.slice(0, LIMITS.showsPageMaxRows);
      }
      const taken = [];
      let total = 0;
      for (const row of candidates) {
        if (taken.length > 0 && total + row.encryptedData.length > LIMITS.showsPageMaxBytes) break;
        taken.push(row);
        total += row.encryptedData.length;
      }
      if (taken.length < candidates.length) more = named === null;
      const shows = [];
      let unreadable = 0;
      for (const row of taken) {
        let view = null;
        try {
          const show = decrypt(row.encryptedData, keys);
          if (isBag(show) && show.id === row.id) view = showView(show);
        } catch {
          view = null;
        }
        if (view) shows.push({ show: view, revision: revisionOf(row.encryptedData) });
        else unreadable += 1;
      }
      return reply(200, { shows, next: more && taken.length ? taken[taken.length - 1].id : null, unreadable });
    }
    if (name === 'revisions') {
      return reply(200, {
        shows: [...state.shows].sort((a, b) => (a.id < b.id ? -1 : 1)).map((row) => ({ id: row.id, revision: revisionOf(row.encryptedData) })),
        settings: state.settings === null ? null : revisionOf(state.settings),
      });
    }
    if (name === 'settings') {
      const settings = ownSettings();
      if (settings === null) return reply(200, { settings: null, revision: null });
      const view = settingsView(settings);
      if (!view) refuse(410, 'link_unreadable');
      return reply(200, { settings: view, revision: revisionOf(state.settings) });
    }
    if (name === 'media') {
      const id = url.searchParams.get('id') ?? '';
      if (!MEDIA_ID.test(id)) refuse(400, 'bad_request');
      const seq = seqParam();
      const owned = state.media[id];
      if (owned?.[seq]) return plainChunk(owned[seq], owned.length, (data) => decrypt(data, keys));
      const staged = state.coproducerMedia[id];
      const chunk = staged && staged.userId === link.userId && staged.linkId === link.id ? staged.chunks[seq] : null;
      if (!chunk) refuse(404, 'not_found');
      return plainChunk(chunk.data, staged.total, (data) => decrypt(data, keys));
    }
    if (name === 'profile-photo') {
      const requestId = url.searchParams.get('request') ?? '';
      if (requestId.length < 1 || requestId.length > 128) refuse(400, 'bad_request');
      const seq = seqParam();
      const settings = ownSettings();
      const rows = Array.isArray(settings?.profileRequests) ? settings.profileRequests : [];
      const request = rows.find((row) => isBag(row) && row.id === requestId);
      const token = request?.token;
      const linkKey = request?.key;
      if (typeof token !== 'string' || token.length < 16 || token.length > 128 || typeof linkKey !== 'string') refuse(404, 'not_found');
      const owner = state.sign[token]?.userId;
      if (owner && owner !== link.userId) refuse(404, 'not_found');
      const chunk = state.profilePhoto[token]?.[seq];
      if (!chunk) refuse(404, 'not_found');
      return plainChunk(chunk.data, chunk.total, (data) => decrypt(data, [linkKey]));
    }
    if (name === 'stage') {
      const b = body(STAGE_BODY_CHARS);
      onlyKeys(b, ['id', 'seq', 'total', 'data']);
      const { id, seq, total, data } = b;
      if (
        typeof id !== 'string' || !MEDIA_ID.test(id) ||
        typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0 ||
        typeof total !== 'number' || !Number.isInteger(total) || total < 1 || total > LIMITS.maxStageChunks || seq >= total ||
        typeof data !== 'string' || data.length === 0
      ) {
        refuse(400, 'bad_request');
      }
      if (data.length > LIMITS.maxStageSliceChars) refuse(413, 'payload_too_large');
      if (seq === 0) {
        const head = DATA_URL_HEAD.exec(data);
        const type = head?.[1].toLowerCase() ?? '';
        if (!head || !modules.schema.ALLOWED_MEDIA_TYPES.includes(type) || modules.schema.sniffMediaType(data.slice(head[0].length, head[0].length + 64)) !== type) {
          refuse(400, 'unsupported_media');
        }
        dropMedia(state, (m) => m.userId === link.userId && m.linkId === link.id && m.requestId === null && m.createdAt <= now - DAY);
      }
      const existing = state.coproducerMedia[id];
      if (state.media[id] || (existing && existing.linkId !== link.id)) refuse(409, 'id_taken');
      if (existing && existing.requestId !== null) refuse(409, 'media_in_use');
      const cipher = encrypt(data, link.key);
      const answer = room(state, link.userId, link.id, { kind: 'stage', mediaId: id, seq, total, bytes: cipher.length });
      if (answer !== 'ok') storageRefusal(answer);
      const media = existing ?? (state.coproducerMedia[id] = { userId: link.userId, linkId: link.id, total, chunks: [], requestId: null, createdAt: now });
      media.total = total;
      media.createdAt = now;
      media.chunks[seq] = { data: cipher };
      return reply(200, { ok: true });
    }
    if (name === 'requests' && method === 'POST') {
      const b = body(LIMITS.maxRequestBodyChars);
      try { modules.untrusted.checkUntrusted(b); } catch { refuse(400, 'bad_request'); }
      onlyKeys(b, ['kind', 'payload', 'mediaIds']);
      if (!['edit', 'share', 'download'].includes(b.kind)) refuse(400, 'bad_request');
      if (!isBag(b.payload) || b.payload.kind !== b.kind) refuse(400, 'bad_request');
      const mediaIds = b.mediaIds;
      if (!Array.isArray(mediaIds) || mediaIds.length > MAX_MEDIA_IDS || mediaIds.some((id) => typeof id !== 'string' || !MEDIA_ID.test(id)) || new Set(mediaIds).size !== mediaIds.length) {
        refuse(400, 'bad_request');
      }
      const checked = modules.schema.validatePayload(b.payload, { appOrigins: [MAIN_ORIGIN, REVIEW_ORIGIN] });
      if (!checked.payload) refuse(400, 'bad_request', { problems: checked.problems.slice(0, 20) });
      const payload = checked.payload;
      // Files both ways, as checkMedia.
      const refs = payload.kind === 'edit' ? modules.schema.changedMediaIds(payload) : [];
      if (mediaIds.some((id) => !refs.includes(id))) refuse(400, 'unknown_media');
      for (const id of refs.filter((ref) => !mediaIds.includes(ref))) {
        if (state.media[id]) continue;
        const staged = state.coproducerMedia[id];
        if (staged && staged.userId === link.userId && staged.requestId !== null) refuse(409, 'media_in_use');
        refuse(400, 'unknown_media');
      }
      for (const id of mediaIds) {
        const staged = state.coproducerMedia[id];
        if (staged?.requestId != null) refuse(409, 'media_in_use');
        if (!staged || staged.userId !== link.userId || staged.linkId !== link.id) refuse(400, 'unknown_media');
      }
      const outline = modules.outline.buildOutline(payload);
      const payloadCipher = encrypt(payload, link.key);
      const outlineCipher = encrypt(outline, link.key);
      const bytes = payloadCipher.length + outlineCipher.length;
      const answer = room(state, link.userId, link.id, { kind: 'request', bytes });
      if (answer !== 'ok') storageRefusal(answer);
      if (mine().filter((r) => OPEN.includes(r.status)).length >= LIMITS.maxOpenRequestsPerLink) refuse(409, 'too_many_open_requests');
      const id = randomUUID();
      state.coproducerRequests[id] = {
        id, userId: link.userId, linkId: link.id, kind: b.kind, status: 'pending', payload: payloadCipher, outline: outlineCipher,
        result: null, mediaIds: [...mediaIds], createdAt: now, decidedAt: null, usedAt: null, bytes, order: order++,
      };
      for (const mediaId of mediaIds) state.coproducerMedia[mediaId].requestId = id;
      return reply(201, { request: { id, kind: b.kind, status: 'pending', createdAt: iso(now), decidedAt: null, usedAt: null, outline, result: null } });
    }
    if (name === 'requests' && method === 'GET') {
      if (url.searchParams.has('id')) {
        const id = oneId();
        const r = mine().find((row) => row.id === id) ?? refuse(404, 'not_found');
        const view = requestView(r, keys);
        let payload;
        try {
          payload = decrypt(r.payload, keys);
          modules.untrusted.checkUntrusted(payload);
        } catch {
          refuse(410, 'link_unreadable');
        }
        if (!view) refuse(410, 'link_unreadable');
        return reply(200, { request: { ...view, payload } });
      }
      const recent = mine()
        .filter((r) => OPEN.includes(r.status) || (['approved', 'rejected'].includes(r.status) && r.decidedAt >= now - RECENT_SECONDS))
        .sort((a, b) => b.createdAt - a.createdAt || b.order - a.order)
        .slice(0, 100)
        .map((r) => requestView(r, keys))
        .filter(Boolean);
      return reply(200, { requests: recent });
    }
    if (name === 'requests' && method === 'DELETE') {
      const id = oneId();
      const r = mine().find((row) => row.id === id) ?? refuse(404, 'not_found');
      if (!OPEN.includes(r.status)) refuse(409, 'already_decided');
      r.status = 'withdrawn';
      r.decidedAt = now;
      dropMedia(state, (m) => m.requestId === id && m.linkId === link.id);
      return reply(200, { ok: true });
    }
    if (name === 'use') {
      const b = body(SMALL_BODY_CHARS);
      onlyKeys(b, ['id']);
      const id = rowId(b.id);
      const r = mine().find((row) => row.id === id) ?? refuse(404, 'not_found');
      if (r.status !== 'approved' || r.kind === 'edit') refuse(409, 'not_approved');
      r.usedAt ??= now;
      return reply(200, { ok: true });
    }
    return reply(405, { error: 'method_not_allowed' });
  } catch (err) {
    if (err instanceof Refusal) return reply(err.status, { error: err.code, ...err.extra });
    // The real route says nothing more about an unexpected failure.
    return reply(500, { error: 'server_error' });
  }
}
