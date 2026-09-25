import { createHash } from 'node:crypto';
/**
 * An in-memory stand-in for the edge API.
 *
 * The app encrypts everything in the browser, so the interesting code — key
 * derivation, the chunked media store, the per-request keys behind a signing
 * link — only runs client-side. What the server contributes is a handful of
 * rules, and those are what this reproduces: chunk storage keyed the way the
 * real routes key it, the size and shape limits each route refuses past, who
 * may write under a token that is in other people's hands, and the one rule
 * that actually protects a signature (`WHERE signed_at IS NULL` — sign once,
 * never twice).
 *
 * Every rule here is a mirror of one in api/*.ts, with the constant it uses
 * copied over. A route or method the real server does not have answers 404 or
 * 405 the way the real one does, so a call the app makes to something that
 * has been renamed or never existed fails the test instead of passing quietly.
 *
 * Faking it rather than pointing at a live Turso instance keeps the suite
 * hermetic and secret-free in CI, and means a test can seed a state that would
 * be tedious to reach for real — an orphaned media blob left by an older
 * build, say.
 */
/**
 * @typedef {object} FakeState
 * @property {Record<string, string>} users  Accounts, by user id: the client hash each one signed up with.
 * @property {{id: string, encryptedData: string}[]} shows
 * @property {string | null} settings
 * @property {{at: string, shows: {id: string, encryptedData: string}[]}[]} showSnapshots  Earlier saves, newest last.
 * @property {{at: string, encryptedData: string, parked?: boolean}[]} settingsSnapshots
 * @property {Record<string, string[]>} media
 * @property {Record<string, number>} mediaWrittenAt  When each media item's newest chunk landed (ms); absent for seeded rows.
 * @property {Record<string, string[]>} doc
 * @property {Record<string, {payload: string, signature: string | null, signedAt: string | null, userId?: string}>} sign
 * @property {Record<string, Record<number, {data: string, total: number}>>} profilePhoto
 * @property {Record<string, {userId: string | null, payload: unknown}>} live  Published viewer state, by token.
 * @property {Record<string, Record<string, {data: string, total: number}[]>>} liveMedia  Viewer audio chunks, by token then id.
 * @property {Record<string, {count: number, windowStart: number}>} rateLimits  The fixed-window counters behind the throttles.
 * @property {boolean} rejectedForeignPublish  Set when a publish from another account was refused.
 * @property {boolean} rejectedSecondSign  Set when a second signature was refused.
 * @property {string[]} mediaDeletes        Every media id the app asked to delete.
 */

// ── Constants copied from the routes they mirror ────────────────────────────
// api/sign.ts
const SIGN_MAX_PAYLOAD_BYTES = 32 * 1024;
const SIGN_MAX_SIGNATURE_BYTES = 3 * 1024 * 1024;
// api/live.ts
const LIVE_MAX_PAYLOAD_BYTES = 64 * 1024;
const STALE_PUBLISH_WINDOW_MS = 60_000;
// api/media.ts, api/sign-doc.ts, api/live-media.ts, api/profile-photo.ts
const MAX_CHUNK_CHARS = 3_500_000;
const MAX_CHUNKS = 64;
const PROFILE_PHOTO_MAX_CHUNKS = 4;
const MAX_TRACKS_PER_TOKEN = 60;
// api/auth.ts and api/_lib/auth.ts
const LOGIN_MAX_FAILURES = 10;
const LOGIN_WINDOW_SECONDS = 300;
const SIGNUP_MAX = 20;
const SIGNUP_WINDOW_SECONDS = 3600;
const AUTHZ_MAX_FAILURES = 20;
const AUTHZ_WINDOW_SECONDS = 300;
// api/_lib/snapshots.ts
const KEEP_RECENT = 12;
const KEEP_DAYS = 30;

/** @param {Partial<FakeState>} [overrides] @returns {FakeState} */
export function emptyState(overrides = {}) {
  return {
    users: {},
    shows: [],
    settings: null,
    showSnapshots: [],
    settingsSnapshots: [],
    media: {},
    mediaWrittenAt: {},
    doc: {},
    sign: {},
    profilePhoto: {},
    live: {},
    liveMedia: {},
    rateLimits: {},
    rejectedSecondSign: false,
    rejectedForeignPublish: false,
    mediaDeletes: [],
    ...overrides,
  };
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

/** api/_lib/http.ts exceedsSize: the JSON size of a value, against a cap. */
const exceedsSize = (value, maxBytes) => JSON.stringify(value ?? null).length > maxBytes;

/** api/sign.ts and api/profile-photo.ts badToken. */
const badToken = (token) => typeof token !== 'string' || token.length < 16 || token.length > 128;

const isSeq = (seq) => typeof seq === 'number' && Number.isInteger(seq) && seq >= 0;

/** A chunk upload's shape, as the chunked routes check it before anything else. */
function badChunk(seq, total, data, maxChunks) {
  return !isSeq(seq) ||
    typeof total !== 'number' || !Number.isInteger(total) || total < 1 || total > maxChunks ||
    seq >= total ||
    typeof data !== 'string' || data.length === 0;
}

/** api/_lib/tokenOwnership.ts: whose a token is, by the row that names it. */
function ownership(row, userId) {
  if (!row || row.userId == null) return 'free';
  return row.userId === userId ? 'mine' : 'other';
}

/**
 * api/_lib/snapshots.ts nextSnapshotAt: a millisecond stamp, at least one
 * past the newest one held, so a burst of saves stays separately restorable.
 * The same `YYYY-MM-DD HH:MM:SS.sss` the server writes, so the list the
 * Settings page renders in a test is shaped like the real one.
 */
function nextSnapshotAt(snapshots) {
  const last = snapshots.reduce((max, s) => Math.max(max, Date.parse(s.at.replace(' ', 'T') + 'Z') || 0), 0);
  return new Date(Math.max(Date.now(), last + 1)).toISOString().replace('T', ' ').replace('Z', '');
}

/**
 * api/_lib/snapshots.ts pruneSnapshots: the latest KEEP_RECENT saves whatever
 * their age, the first save of each day back KEEP_DAYS, and parked copies
 * always. Applied to a list of snapshots that share one `at` per save.
 */
function pruneSnapshots(snapshots) {
  const ordinary = snapshots.filter((s) => !s.parked);
  const recent = new Set([...new Set(ordinary.map((s) => s.at))].sort().reverse().slice(0, KEEP_RECENT));
  const firstOfDay = {};
  for (const s of ordinary) {
    const day = s.at.slice(0, 10);
    if (!firstOfDay[day] || s.at < firstOfDay[day]) firstOfDay[day] = s.at;
  }
  const daily = new Set(Object.values(firstOfDay));
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString().replace('T', ' ').replace('Z', '');
  return snapshots.filter((s) => s.parked || recent.has(s.at) || (s.at >= cutoff && daily.has(s.at)));
}

/** @param {import("playwright").BrowserContext} ctx @param {FakeState} state */
export async function installFakeApi(ctx, state) {
  await ctx.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();
    const headers = req.headers();
    const body = ['POST', 'PUT'].includes(method) ? JSON.parse(req.postData() || '{}') : {};
    const ok = (data) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    const err = (status, error) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error }) });
    const tooLarge = () => err(413, 'payload_too_large');

    // api/_lib/ratelimit.ts. Fixed windows on a shared counter: record a hit
    // and say whether the bucket is still within its allowance, or look
    // without spending one.
    const address = headers['x-forwarded-for']?.split(',')[0].trim() || headers['x-real-ip'] || 'unknown';
    function rateLimit(bucket, max, windowSeconds) {
      const now = Date.now();
      const row = state.rateLimits[bucket];
      if (!row || row.windowStart < now - windowSeconds * 1000) state.rateLimits[bucket] = { count: 1, windowStart: now };
      else row.count += 1;
      return state.rateLimits[bucket].count <= max;
    }
    function rateLimitPeek(bucket, max, windowSeconds) {
      const row = state.rateLimits[bucket];
      const count = row && row.windowStart >= Date.now() - windowSeconds * 1000 ? row.count : 0;
      return count < max;
    }

    // api/_lib/auth.ts authorize: the account named by x-user-id, when x-auth
    // is the credential it signed up with. Null for a missing header, an
    // unknown account, a wrong credential, or too many wrong ones. Every
    // producer route goes through this, so an account that was never created
    // cannot read or write anything.
    function authorize() {
      const userId = headers['x-user-id'];
      const auth = headers['x-auth'];
      if (!userId || !auth) return null;
      const failures = `authz:${userId}:${address}`;
      if (!rateLimitPeek(failures, AUTHZ_MAX_FAILURES, AUTHZ_WINDOW_SECONDS)) return null;
      if (!Object.hasOwn(state.users, userId)) return null;
      if (state.users[userId] !== auth) {
        rateLimit(failures, AUTHZ_MAX_FAILURES, AUTHZ_WINDOW_SECONDS);
        return null;
      }
      return userId;
    }

    if (path === '/api/health') return ok({ ok: true, configured: true, db: 'reachable' });

    if (path === '/api/auth') {
      if (method !== 'POST') return err(405, 'method_not_allowed');
      const { action, userId, passwordHash } = body;
      if (!userId || !passwordHash) return err(400, 'bad_request');
      const failures = `auth:${userId}:${address}`;
      if (!rateLimitPeek(failures, LOGIN_MAX_FAILURES, LOGIN_WINDOW_SECONDS)) return err(429, 'too_many_requests');
      if (action === 'signup') {
        if (!rateLimit(`signup:${address}`, SIGNUP_MAX, SIGNUP_WINDOW_SECONDS)) return err(429, 'too_many_requests');
        if (Object.hasOwn(state.users, userId)) return err(409, 'account_exists');
        state.users[userId] = String(passwordHash);
        return ok({ ok: true });
      }
      if (action === 'login') {
        const known = Object.hasOwn(state.users, userId) && state.users[userId] === passwordHash;
        if (!known) rateLimit(failures, LOGIN_MAX_FAILURES, LOGIN_WINDOW_SECONDS);
        return ok({ ok: known });
      }
      return err(400, 'bad_request');
    }

    if (path === '/api/shows') {
      const userId = authorize();
      if (!userId) return err(401, 'unauthorized');
      if (method === 'GET' && url.searchParams.get('history')) {
        return ok({
          snapshots: [...state.showSnapshots].reverse().map((s) => ({ at: s.at, count: s.shows.length })),
        });
      }
      if (method === 'GET' && url.searchParams.get('at')) {
        const snap = state.showSnapshots.find((s) => s.at === url.searchParams.get('at'));
        if (!snap) return err(404, 'not_found');
        return ok({ shows: snap.shows });
      }
      if (method === 'GET') return ok({ shows: state.shows });
      if (method !== 'PUT') return err(405, 'method_not_allowed');
      // api/_lib/showWrites.ts applyShowChanges.
      if (!Array.isArray(body.changes)) return err(428, 'client_update_required');
      const changes = body.changes;
      if (changes.some((c) =>
        !c || typeof c !== 'object' || typeof c.id !== 'string' || !c.id ||
        !(c.expectedHash === null || (typeof c.expectedHash === 'string' && /^[a-f0-9]{64}$/.test(c.expectedHash))) ||
        !(c.encryptedData === null || (typeof c.encryptedData === 'string' && c.encryptedData.length > 0)))) {
        return err(400, 'bad_request');
      }
      if (new Set(changes.map((c) => c.id)).size !== changes.length) return err(400, 'duplicate_id');
      const effective = [];
      for (const c of changes) {
        const current = state.shows.find((s) => s.id === c.id)?.encryptedData ?? null;
        // A replay of what is already there is success, never a conflict.
        if (current === c.encryptedData) continue;
        const hash = current === null ? null : sha256(current);
        if (hash !== c.expectedHash) return err(409, 'save_conflict');
        effective.push(c);
      }
      // Only a save that changes something is copied aside first — and the
      // copy is of the rows that exist, so an empty list leaves no snapshot.
      if (effective.length) {
        if (state.shows.length) {
          state.showSnapshots.push({ at: nextSnapshotAt(state.showSnapshots), shows: [...state.shows] });
          state.showSnapshots = pruneSnapshots(state.showSnapshots);
        }
        for (const c of effective) {
          state.shows = state.shows.filter((s) => s.id !== c.id);
          if (c.encryptedData !== null) state.shows.push({ id: c.id, encryptedData: c.encryptedData });
        }
      }
      return ok({ ok: true });
    }

    if (path === '/api/settings') {
      const userId = authorize();
      if (!userId) return err(401, 'unauthorized');
      if (method === 'GET' && url.searchParams.get('history')) {
        return ok({
          snapshots: [...state.settingsSnapshots].reverse().map((s) => ({ at: s.at, parked: !!s.parked })),
        });
      }
      if (method === 'GET' && url.searchParams.get('at')) {
        const snap = state.settingsSnapshots.find((s) => s.at === url.searchParams.get('at'));
        if (!snap) return err(404, 'not_found');
        return ok({ encryptedData: snap.encryptedData });
      }
      if (method === 'GET') return ok({ encryptedData: state.settings });
      if (method !== 'PUT') return err(405, 'method_not_allowed');
      if (typeof body.encryptedData !== 'string' || body.encryptedData.length === 0) return err(400, 'bad_request');
      if (body.park) {
        // api/_lib/snapshots.ts parkSettingsSnapshot: stamped to the second,
        // so it tries the next few seconds when that one is taken, and says
        // so rather than reporting a copy it did not keep.
        for (let offset = 0; offset < 5; offset++) {
          const at = new Date(Math.floor(Date.now() / 1000) * 1000 + offset * 1000)
            .toISOString().slice(0, 19).replace('T', ' ');
          if (state.settingsSnapshots.some((s) => s.at === at)) continue;
          state.settingsSnapshots.push({ at, encryptedData: body.encryptedData, parked: true });
          state.settingsSnapshots = pruneSnapshots(state.settingsSnapshots);
          return ok({ ok: true });
        }
        return err(503, 'not_stored');
      }
      // api/_lib/settingsWrites.ts applySettingsWrite.
      const expectedHash = body.expectedHash;
      if (expectedHash !== null && (typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedHash))) {
        return err(428, 'client_update_required');
      }
      // Re-saving the blob already held changes nothing: no conflict check,
      // no snapshot, no write.
      if (state.settings !== body.encryptedData) {
        const hash = state.settings === null ? null : sha256(state.settings);
        if (hash !== expectedHash) return err(409, 'save_conflict');
        if (state.settings) {
          state.settingsSnapshots.push({ at: nextSnapshotAt(state.settingsSnapshots), encryptedData: state.settings });
          state.settingsSnapshots = pruneSnapshots(state.settingsSnapshots);
        }
        state.settings = body.encryptedData;
      }
      return ok({ ok: true });
    }

    if (path === '/api/media') {
      const userId = authorize();
      if (!userId) return err(401, 'unauthorized');
      if (method === 'PUT') {
        const { id, seq, total, data } = body;
        if (typeof id !== 'string' || id.length < 8 || id.length > 64 || badChunk(seq, total, data, MAX_CHUNKS)) {
          return err(400, 'bad_request');
        }
        if (data.length > MAX_CHUNK_CHARS) return tooLarge();
        (state.media[id] ||= [])[seq] = data;
        state.mediaWrittenAt[id] = Date.now();
        return ok({ ok: true });
      }
      if (method === 'GET' && url.searchParams.get('list')) {
        // `ageSeconds` on the server's clock. A row seeded by a test has no
        // upload time, so it reads as old — the orphan it is standing in for.
        return ok({
          items: Object.entries(state.media).map(([id, chunks]) => ({
            id,
            chunks: chunks.filter((c) => c !== undefined).length,
            bytes: chunks.join('').length,
            ageSeconds: Math.floor((Date.now() - (state.mediaWrittenAt[id] ?? 0)) / 1000),
          })),
        });
      }
      if (method === 'GET') {
        const id = url.searchParams.get('id');
        const seq = Number(url.searchParams.get('seq'));
        if (!id || !isSeq(seq)) return err(400, 'bad_request');
        const chunks = state.media[id];
        if (!chunks?.[seq]) return err(404, 'not_found');
        return ok({ data: chunks[seq], total: chunks.length });
      }
      if (method === 'DELETE') {
        const id = url.searchParams.get('id');
        if (!id) return err(400, 'bad_request');
        state.mediaDeletes.push(id);
        delete state.media[id];
        delete state.mediaWrittenAt[id];
        return ok({ ok: true });
      }
      return err(405, 'method_not_allowed');
    }

    if (path === '/api/sign-doc') {
      if (method === 'GET') {
        const token = url.searchParams.get('token');
        const seq = Number(url.searchParams.get('seq'));
        if (!token || !isSeq(seq)) return err(400, 'bad_request');
        const chunks = state.doc[token];
        if (!chunks?.[seq]) return err(404, 'not_found');
        return ok({ data: chunks[seq], total: chunks.length });
      }
      const userId = authorize();
      if (!userId) return err(401, 'unauthorized');
      if (method === 'PUT') {
        const { token, seq, total, data } = body;
        if (badToken(token) || badChunk(seq, total, data, MAX_CHUNKS)) return err(400, 'bad_request');
        if (data.length > MAX_CHUNK_CHARS) return tooLarge();
        // The document lands before the request that names it, so a token
        // nobody has written under is free; once the request row is there,
        // only its account may touch the document.
        if (ownership(state.sign[token], userId) === 'other') return err(403, 'forbidden');
        (state.doc[token] ||= [])[seq] = data;
        return ok({ ok: true });
      }
      if (method === 'DELETE') {
        const token = url.searchParams.get('token');
        if (!token) return err(400, 'bad_request');
        if (ownership(state.sign[token], userId) === 'other') return err(403, 'forbidden');
        delete state.doc[token];
        return ok({ ok: true });
      }
      return err(405, 'method_not_allowed');
    }

    if (path === '/api/live') {
      if (method === 'GET') {
        // Public: this is the link handed to the room.
        const token = url.searchParams.get('token');
        if (!token) return err(400, 'bad_request');
        const row = state.live[token];
        return ok({ payload: row ? row.payload : null });
      }
      if (method !== 'POST') return err(405, 'method_not_allowed');
      // The viewer token is public by design, so it names the page but does
      // not grant the right to write to it: only a signed-in account may
      // publish, and only the account that owns the row.
      const userId = authorize();
      if (!userId) return err(401, 'unauthorized');
      const { token, payload } = body;
      if (!token) return err(400, 'bad_request');
      if (exceedsSize(payload, LIVE_MAX_PAYLOAD_BYTES)) return tooLarge();
      const row = state.live[token];
      if (ownership(row, userId) === 'other') {
        state.rejectedForeignPublish = true;
        return err(403, 'forbidden');
      }
      // The late-arrival rule (STALE_PUBLISH_WINDOW_MS in api/live.ts): a
      // publish whose clock is behind the stored one by up to a minute is a
      // request that landed late, and what the room shows is newer than it.
      // Either side missing a clock means write it.
      const held = row?.payload?.lastUpdateMs;
      const incoming = payload?.lastUpdateMs;
      if (typeof held === 'number' && typeof incoming === 'number') {
        const behind = held - incoming;
        if (behind >= 1 && behind <= STALE_PUBLISH_WINDOW_MS) return ok({ ok: true, stale: true });
      }
      state.live[token] = { userId, payload };
      return ok({ ok: true });
    }

    if (path === '/api/live-media') {
      if (method === 'GET') {
        // Public, like the page it plays on.
        const token = url.searchParams.get('token');
        const id = url.searchParams.get('id');
        const seq = Number(url.searchParams.get('seq'));
        if (!token || !id || !isSeq(seq)) return err(400, 'bad_request');
        const chunk = state.liveMedia[token]?.[id]?.[seq];
        if (!chunk) return err(404, 'not_found');
        return ok({ data: chunk.data, total: chunk.total });
      }
      // Writes are the account that published the token's live state — the
      // token is in every audience member's hands, so "has both" is not the
      // producer.
      const userId = authorize();
      if (!userId) return err(401, 'unauthorized');
      if (method === 'PUT') {
        const { token, id, seq, total, data } = body;
        if (
          typeof token !== 'string' || token.length < 8 || token.length > 128 ||
          typeof id !== 'string' || id.length < 8 || id.length > 64 ||
          badChunk(seq, total, data, MAX_CHUNKS)
        ) {
          return err(400, 'bad_request');
        }
        if (data.length > MAX_CHUNK_CHARS) return tooLarge();
        if (ownership(state.live[token], userId) === 'other') return err(403, 'forbidden');
        const tracks = (state.liveMedia[token] ||= {});
        // Only distinct tracks count, and only on the first chunk, so a track
        // already under way never trips the cap half-uploaded.
        if (seq === 0 && Object.keys(tracks).filter((other) => other !== id).length >= MAX_TRACKS_PER_TOKEN) {
          return tooLarge();
        }
        (tracks[id] ||= [])[seq] = { data, total };
        return ok({ ok: true });
      }
      if (method === 'DELETE') {
        const token = url.searchParams.get('token');
        if (!token) return err(400, 'bad_request');
        if (ownership(state.live[token], userId) === 'other') return err(403, 'forbidden');
        delete state.liveMedia[token];
        return ok({ ok: true });
      }
      return err(405, 'method_not_allowed');
    }

    if (path === '/api/profile-photo') {
      if (method === 'PUT') {
        // Anonymous, and hemmed in: a link the producer made, still
        // unanswered, at most a few small chunks. The reply seals the photo.
        const { token, seq, total, data } = body;
        if (badToken(token) || badChunk(seq, total, data, PROFILE_PHOTO_MAX_CHUNKS)) return err(400, 'bad_request');
        if (data.length > MAX_CHUNK_CHARS) return tooLarge();
        const link = state.sign[token];
        if (!link) return err(404, 'not_found');
        if (link.signedAt) return err(409, 'not_open');
        state.profilePhoto[token] ??= {};
        state.profilePhoto[token][seq] = { data, total };
        return ok({ ok: true });
      }
      // Reading is the producer's — the one who made the link, not any
      // account that has seen it.
      const userId = authorize();
      if (!userId) return err(401, 'unauthorized');
      if (method === 'GET') {
        const token = url.searchParams.get('token');
        const seq = Number(url.searchParams.get('seq'));
        if (badToken(token) || !isSeq(seq)) return err(400, 'bad_request');
        if (ownership(state.sign[token], userId) === 'other') return err(403, 'forbidden');
        const chunk = state.profilePhoto[token]?.[seq];
        return chunk ? ok(chunk) : err(404, 'not_found');
      }
      if (method === 'DELETE') {
        const token = url.searchParams.get('token');
        if (badToken(token)) return err(400, 'bad_request');
        if (ownership(state.sign[token], userId) === 'other') return err(403, 'forbidden');
        delete state.profilePhoto[token];
        return ok({ ok: true });
      }
      return err(405, 'method_not_allowed');
    }

    if (path === '/api/sign') {
      if (method === 'GET') {
        const token = url.searchParams.get('token');
        if (badToken(token)) return err(400, 'bad_request');
        const row = state.sign[token];
        if (!row) return err(404, 'not_found');
        return ok({ payload: row.payload, signature: row.signature, signedAt: row.signedAt });
      }
      if (method === 'POST') {
        // Anonymous on purpose — the signer needs no account. The rule the
        // real route enforces in SQL: a replayed or racing POST must never
        // overwrite an agreement that is already on file.
        const { token, signature } = body;
        if (badToken(token) || typeof signature !== 'string' || signature.length === 0) return err(400, 'bad_request');
        if (exceedsSize(signature, SIGN_MAX_SIGNATURE_BYTES)) return tooLarge();
        const row = state.sign[token];
        if (!row) return err(404, 'not_found');
        if (row.signedAt && row.signature === signature) return ok({ ok: true });
        if (row.signedAt) {
          state.rejectedSecondSign = true;
          return err(409, 'not_signable');
        }
        row.signature = signature;
        row.signedAt = new Date().toISOString();
        return ok({ ok: true });
      }
      // Producer writes: authenticated, and scoped to the account that made
      // the request. The signer holds the token by construction, so "has the
      // token and an account" must not be enough to revoke or replace it.
      const userId = authorize();
      if (!userId) return err(401, 'unauthorized');
      if (method === 'PUT') {
        const { token, payload } = body;
        if (badToken(token) || typeof payload !== 'string' || payload.length === 0) return err(400, 'bad_request');
        if (exceedsSize(payload, SIGN_MAX_PAYLOAD_BYTES)) return tooLarge();
        const prev = state.sign[token];
        // upsertSignRequest: a row nobody owns is claimed; another account's
        // is left alone. Re-sending never clears a signature already made.
        if (ownership(prev, userId) === 'other') return err(403, 'forbidden');
        state.sign[token] = {
          payload,
          signature: prev?.signature ?? null,
          signedAt: prev?.signedAt ?? null,
          userId,
        };
        return ok({ ok: true });
      }
      if (method === 'DELETE') {
        const token = url.searchParams.get('token');
        if (badToken(token)) return err(400, 'bad_request');
        if (ownership(state.sign[token], userId) === 'other') return err(403, 'forbidden');
        delete state.sign[token];
        delete state.doc[token];
        return ok({ ok: true });
      }
      return err(405, 'method_not_allowed');
    }

    // No such route. The real server has nothing at this address either, and
    // answering it kindly is how a renamed route stays green for months.
    return err(404, 'not_found');
  });
}
