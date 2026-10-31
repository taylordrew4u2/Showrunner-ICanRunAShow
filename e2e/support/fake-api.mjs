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
 * @property {Record<string, {credential: string, clientVersion: number}>} users  Accounts, by user id: the client credential that opens each one, and which kind it is (1 = the old SHA-256 hash, 2 = the per-account key; api/_lib/credentials.ts).
 * @property {{id: string, encryptedData: string}[]} shows
 * @property {string | null} settings
 * @property {{at: string, shows: {id: string, encryptedData: string}[]}[]} showSnapshots  Earlier saves, newest last.
 * @property {{at: string, encryptedData: string, parked?: boolean}[]} settingsSnapshots
 * @property {Record<string, string[]>} media
 * @property {Record<string, number>} mediaWrittenAt  When each media item's newest chunk landed (ms); absent for seeded rows.
 * @property {Record<string, string[]>} doc
 * @property {Record<string, string>} docOwners  The account each document's chunks name (sign_doc.user_id); absent for seeded documents, which name nobody.
 * @property {Record<string, {payload: string, signature: string | null, signedAt: string | null, userId?: string, bytes?: number}>} sign  Signing and profile requests, by token. `bytes` is the signature's size as the server recorded it when it landed (sign_request.bytes); absent for seeded rows, which count for nothing.
 * @property {Record<string, Record<number, {data: string, total: number, userId?: string | null}>>} profilePhoto  Headshot chunks, each naming the producer whose link it came through.
 * @property {Record<string, {userId: string | null, payload: unknown}>} live  Published viewer state, by token.
 * @property {Record<string, Record<string, {data: string, total: number, userId?: string}[]>>} liveMedia  Viewer audio chunks, by token then id, each naming the account that sent it.
 * @property {Record<string, {count: number, windowStart: number}>} rateLimits  The fixed-window counters behind the throttles.
 * @property {boolean} rejectedForeignPublish  Set when a publish from another account was refused.
 * @property {boolean} rejectedSecondSign  Set when a second signature was refused.
 * @property {string[]} mediaDeletes        Every media id the app asked to delete.
 * @property {boolean} billingConfigured  Whether the server has Stripe keys (api/billing.ts isBillingConfigured).
 * @property {Record<string, {status: string, customerId: string}>} billing  What Stripe's webhook last reported, by account.
 * @property {boolean} founders  Every account counts as made before subscriptions (api/billing.ts isFoundingMember).
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
const MAX_CREDENTIAL_CHARS = 128;
const LOGIN_MAX_FAILURES = 10;
const LOGIN_WINDOW_SECONDS = 300;
const SIGNUP_MAX = 20;
const SIGNUP_WINDOW_SECONDS = 3600;
const AUTHZ_MAX_FAILURES = 20;
const AUTHZ_WINDOW_SECONDS = 300;
// api/_lib/linkStorage.ts
const MAX_LINK_TOKENS = 5_000;
const MAX_LINK_BYTES = 10 * 1024 ** 3;
// api/account.ts
const ACCOUNT_MAX_NAMED_TOKENS = 5000;
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
    docOwners: {},
    sign: {},
    profilePhoto: {},
    live: {},
    liveMedia: {},
    rateLimits: {},
    rejectedSecondSign: false,
    rejectedForeignPublish: false,
    mediaDeletes: [],
    billingConfigured: false,
    billing: {},
    founders: false,
    ...overrides,
  };
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

/** api/_lib/http.ts exceedsSize: the JSON size of a value, against a cap. */
const exceedsSize = (value, maxBytes) => JSON.stringify(value ?? null).length > maxBytes;

/** api/auth.ts badCredential: the browser's derived hex digests, nothing longer. */
const badCredential = (value) => typeof value !== 'string' || value.length === 0 || value.length > MAX_CREDENTIAL_CHARS;

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

/**
 * api/_lib/tokenOwnership.ts: whose a token is, by the row that names it, or
 * when no row names anyone, by the account its chunks name. 'legacy' is a row
 * from before owners were recorded.
 */
function ownership(row, userId, chunkOwner = null) {
  const owner = row?.userId ?? chunkOwner;
  if (owner == null) return row ? 'legacy' : 'free';
  return owner === userId ? 'mine' : 'other';
}

/** The account a token's viewer audio names, if any chunk names one. */
function audioOwner(state, token) {
  for (const chunks of Object.values(state.liveMedia[token] ?? {})) {
    for (const chunk of chunks) if (chunk?.userId) return chunk.userId;
  }
  return null;
}

const signOwnership = (state, token, userId) => ownership(state.sign[token], userId, state.docOwners[token] ?? null);
const liveOwnership = (state, token, userId) => ownership(state.live[token], userId, audioOwner(state, token));

/**
 * api/_lib/linkStorage.ts hasLinkRoom: whether the account's links have room
 * for this write — a chunk, or a link's own row. A link it holds nothing under
 * yet needs room under the count of links; bytes are counted as they would
 * stand after the write, and the first chunk of a file is checked for the
 * whole file. A link row counts in bytes only for its signature, and a write
 * to one replaces nothing.
 */
function hasLinkRoom(state, userId, write) {
  const chunk = write.seq === undefined ? null : write;
  const tokens = new Set();
  let bytes = 0;
  let replaced = 0;
  const count = (table, token, id, seq, size) => {
    tokens.add(token);
    bytes += size;
    const sameFile = chunk && table === chunk.table && token === chunk.token && (table !== 'live_media' || id === chunk.id);
    if (sameFile && (seq === chunk.seq || chunk.seq === 0)) replaced += size;
  };
  for (const [token, chunks] of Object.entries(state.doc)) {
    if (state.docOwners[token] !== userId) continue;
    chunks.forEach((data, seq) => { if (data) count('sign_doc', token, '', seq, data.length); });
  }
  for (const [token, tracks] of Object.entries(state.liveMedia)) {
    for (const [id, chunks] of Object.entries(tracks)) {
      chunks.forEach((c, seq) => { if (c?.userId === userId) count('live_media', token, id, seq, c.data.length); });
    }
  }
  for (const [token, chunks] of Object.entries(state.profilePhoto)) {
    for (const [seq, c] of Object.entries(chunks)) {
      if (c?.userId === userId) count('profile_photo', token, '', Number(seq), c.data.length);
    }
  }
  for (const [token, row] of Object.entries(state.sign)) {
    if (row.userId === userId) count('sign_request', token, '', 0, row.bytes ?? 0);
  }
  for (const [token, row] of Object.entries(state.live)) {
    if (row.userId === userId) count('live_view', token, '', 0, 0);
  }
  if (!tokens.has(write.token) && tokens.size >= MAX_LINK_TOKENS) return false;
  const adding = chunk?.seq === 0 ? chunk.bytes * chunk.total : write.bytes;
  return bytes - replaced + adding <= MAX_LINK_BYTES;
}

/** Remove the audio chunks `drop` picks out of a token, and whatever that leaves empty. */
function dropAudio(state, token, drop) {
  const tracks = state.liveMedia[token];
  if (!tracks) return;
  for (const [id, chunks] of Object.entries(tracks)) {
    chunks.forEach((c, seq) => { if (c && drop(c)) delete chunks[seq]; });
    if (!chunks.some(Boolean)) delete tracks[id];
  }
  if (Object.keys(tracks).length === 0) delete state.liveMedia[token];
}

/** Remove the headshot chunks `drop` picks out of a token, and the token once it is empty. */
function dropPhoto(state, token, drop) {
  const chunks = state.profilePhoto[token];
  if (!chunks) return;
  for (const [seq, c] of Object.entries(chunks)) if (drop(c)) delete chunks[seq];
  if (Object.keys(chunks).length === 0) delete state.profilePhoto[token];
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
    const body = ['POST', 'PUT', 'DELETE'].includes(method) ? JSON.parse(req.postData() || '{}') : {};
    const ok = (data) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    const err = (status, error) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error }) });
    const tooLarge = () => err(413, 'payload_too_large');
    // api/_lib/linkStorage.ts linkStorageFull.
    const linkStorageFull = () => err(413, 'link_storage_full');

    // api/_lib/ratelimit.ts. Fixed windows on a shared counter: record a hit
    // and say whether the bucket is still within its allowance, give one
    // back, or look without spending one.
    const address = headers['x-forwarded-for']?.split(',')[0].trim() || headers['x-real-ip'] || 'unknown';
    function rateLimit(bucket, max, windowSeconds) {
      const now = Date.now();
      const row = state.rateLimits[bucket];
      if (!row || row.windowStart < now - windowSeconds * 1000) state.rateLimits[bucket] = { count: 1, windowStart: now };
      else row.count += 1;
      return state.rateLimits[bucket].count <= max;
    }
    function rateLimitRefund(bucket) {
      const row = state.rateLimits[bucket];
      if (row) row.count = Math.max(row.count - 1, 0);
    }
    function rateLimitPeek(bucket, max, windowSeconds) {
      const row = state.rateLimits[bucket];
      const count = row && row.windowStart >= Date.now() - windowSeconds * 1000 ? row.count : 0;
      return count < max;
    }

    // api/_lib/auth.ts authorize: the account named by x-user-id, when x-auth
    // is the credential that opens it (whichever kind it holds). Null for a
    // missing header, an unknown account, a wrong credential, or too many
    // wrong ones. Every producer route goes through this, so an account that
    // was never created cannot read or write anything.
    let throttled = false;
    function authorize() {
      const userId = headers['x-user-id'];
      const auth = headers['x-auth'];
      if (!userId || !auth) return null;
      const failures = `authz:${userId}:${address}`;
      if (!rateLimitPeek(failures, AUTHZ_MAX_FAILURES, AUTHZ_WINDOW_SECONDS)) {
        throttled = true;
        return null;
      }
      if (!Object.hasOwn(state.users, userId)) return null;
      if (state.users[userId].credential !== auth) {
        rateLimit(failures, AUTHZ_MAX_FAILURES, AUTHZ_WINDOW_SECONDS);
        return null;
      }
      return userId;
    }
    // What a route answers when authorize refuses: 401 for a credential that
    // is missing or wrong, 429 (api/_lib/http.ts TooManyRequestsError) when the
    // failures were used up and the credential was never looked at.
    const refused = () => (throttled ? err(429, 'too_many_requests') : err(401, 'unauthorized'));

    if (path === '/api/health') return ok({ ok: true, configured: true, db: 'reachable' });

    // api/billing.ts. Stripe itself is out of reach here, so checkout stands
    // in for the whole round trip: it records the subscription the webhook
    // would have, and sends the browser straight back as Stripe does.
    if (path === '/api/billing') {
      const userId = authorize();
      if (!userId) return refused();
      const row = state.billing[userId];
      const paid = ['active', 'trialing', 'past_due'].includes(row?.status);
      const founder = state.founders;
      if (method === 'GET') {
        return ok({ configured: state.billingConfigured, plan: founder || paid ? 'producer' : 'free', founder, status: row?.status ?? null, renewsAt: null, endsAt: null, canManage: !!row });
      }
      if (!state.billingConfigured) return err(501, 'billing_not_configured');
      if (body.action === 'checkout') {
        if (founder) return err(409, 'founding_member');
        if (paid) return err(409, 'already_subscribed');
        state.billing[userId] = { status: 'active', customerId: 'cus_fake' };
        return ok({ url: '/?billing=success' });
      }
      if (body.action === 'portal') return row ? ok({ url: '/' }) : err(404, 'no_customer');
      return err(400, 'bad_request');
    }

    // api/account.ts. Any subscription that could still charge is cancelled
    // first, and one that cannot be (no Stripe keys) stops the deletion with
    // nothing deleted. Then every row the account owns goes, with the links it
    // names that no account owns. The fake keeps one account's shows,
    // settings and media, so those go whole.
    if (path === '/api/account') {
      if (method !== 'DELETE') return err(405, 'method_not_allowed');
      const userId = authorize();
      if (!userId) return err(401, 'unauthorized');
      const tokens = body.tokens ?? [];
      if (
        !Array.isArray(tokens) || tokens.length > ACCOUNT_MAX_NAMED_TOKENS ||
        tokens.some((t) => typeof t !== 'string' || t.length === 0 || t.length > 128)
      ) {
        return err(400, 'bad_request');
      }
      const billing = state.billing[userId];
      if (billing && !['canceled', 'incomplete_expired'].includes(billing.status) && !state.billingConfigured) {
        return err(501, 'billing_not_configured');
      }
      delete state.billing[userId];
      const named = new Set(tokens);
      for (const [token, row] of Object.entries(state.sign)) {
        if (row.userId === userId) {
          delete state.sign[token];
          delete state.doc[token];
          delete state.docOwners[token];
          delete state.profilePhoto[token];
        }
      }
      for (const [token, row] of Object.entries(state.live)) {
        if (row.userId === userId) {
          delete state.live[token];
          delete state.liveMedia[token];
        }
      }
      // Chunks that name the account, whatever link they are under.
      for (const [token, owner] of Object.entries(state.docOwners)) {
        if (owner === userId) {
          delete state.doc[token];
          delete state.docOwners[token];
        }
      }
      for (const token of Object.keys(state.liveMedia)) dropAudio(state, token, (c) => c.userId === userId);
      for (const token of Object.keys(state.profilePhoto)) dropPhoto(state, token, (c) => c.userId === userId);
      // The links it names that no account owns: their legacy rows, and the
      // chunks under them that name nobody.
      for (const token of named) {
        const request = state.sign[token];
        if (request?.userId == null) {
          if (state.docOwners[token] == null) delete state.doc[token];
          dropPhoto(state, token, (c) => c.userId == null);
          delete state.sign[token];
        }
        const view = state.live[token];
        if (view?.userId == null) {
          dropAudio(state, token, (c) => c.userId == null);
          delete state.live[token];
        }
      }
      state.shows = [];
      state.settings = null;
      state.showSnapshots = [];
      state.settingsSnapshots = [];
      state.media = {};
      state.mediaWrittenAt = {};
      for (const bucket of Object.keys(state.rateLimits)) {
        if (bucket.startsWith(`auth:${userId}:`) || bucket.startsWith(`authz:${userId}:`)) delete state.rateLimits[bucket];
      }
      delete state.users[userId];
      return ok({ ok: true });
    }

    if (path === '/api/auth') {
      if (method !== 'POST') return err(405, 'method_not_allowed');
      const { action, userId } = body;
      // api/auth.ts credential(): either may be left out, but one that is sent
      // must look like a credential, and at least one must come.
      const credential = (value) => (value === undefined ? undefined : badCredential(value) ? null : value);
      const authKey = credential(body.authKey);
      const passwordHash = credential(body.passwordHash);
      if (badCredential(userId) || authKey === null || passwordHash === null) return err(400, 'bad_request');
      if (!(authKey ?? passwordHash)) return err(400, 'bad_request');
      // A sign-in spends a try before the check and gets it back if the
      // check passes, so guesses sent together are held to the limit too.
      const failures = `auth:${userId}:${address}`;
      const room = action === 'login'
        ? rateLimit(failures, LOGIN_MAX_FAILURES, LOGIN_WINDOW_SECONDS)
        : rateLimitPeek(failures, LOGIN_MAX_FAILURES, LOGIN_WINDOW_SECONDS);
      if (!room) return err(429, 'too_many_requests');
      if (action === 'signup') {
        if (!rateLimit(`signup:${address}`, SIGNUP_MAX, SIGNUP_WINDOW_SECONDS)) return err(429, 'too_many_requests');
        if (Object.hasOwn(state.users, userId)) return err(409, 'account_exists');
        // A build from before the per-account key signs up with the old hash,
        // and the account is filed as v1 so it can move over later.
        state.users[userId] = authKey ? { credential: authKey, clientVersion: 2 } : { credential: passwordHash, clientVersion: 1 };
        return ok({ ok: true });
      }
      if (action === 'login') {
        // api/_lib/credentials.ts verifySignIn: a v2 account opens with authKey
        // alone; a v1 account with the old hash, and moves to the authKey sent
        // beside it. Without the old hash a v1 account asks for it; without an
        // authKey a v2 account answers 426 update_required, which a build from
        // before reads as a failed sign-in rather than a wrong password.
        // Neither is a failed guess.
        const user = Object.hasOwn(state.users, userId) ? state.users[userId] : null;
        const missing = user && (user.clientVersion < 2 ? !passwordHash : !authKey);
        const known = !!user && !missing && user.credential === (user.clientVersion >= 2 ? authKey : passwordHash);
        if (missing || known) rateLimitRefund(failures);
        if (user && user.clientVersion < 2 && !passwordHash) return ok({ ok: false, legacy: true });
        if (user && user.clientVersion >= 2 && !authKey) return err(426, 'update_required');
        if (known && user.clientVersion < 2 && authKey) state.users[userId] = { credential: authKey, clientVersion: 2 };
        return ok({ ok: known });
      }
      return err(400, 'bad_request');
    }

    if (path === '/api/shows') {
      const userId = authorize();
      if (!userId) return refused();
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
      if (!userId) return refused();
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
      if (!userId) return refused();
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
      if (!userId) return refused();
      if (method === 'PUT') {
        const { token, seq, total, data } = body;
        if (badToken(token) || badChunk(seq, total, data, MAX_CHUNKS)) return err(400, 'bad_request');
        if (data.length > MAX_CHUNK_CHARS) return tooLarge();
        // The document lands before the request that names it, so a token
        // nobody has written under is free, and the first chunk claims it;
        // from then on only that account may touch the document, and a legacy
        // request's document is nobody's to replace.
        if (['other', 'legacy'].includes(signOwnership(state, token, userId))) return err(403, 'forbidden');
        if (!hasLinkRoom(state, userId, { table: 'sign_doc', token, seq, total, bytes: data.length })) return linkStorageFull();
        (state.doc[token] ||= [])[seq] = data;
        state.docOwners[token] = userId;
        return ok({ ok: true });
      }
      if (method === 'DELETE') {
        const token = url.searchParams.get('token');
        if (!token) return err(400, 'bad_request');
        if (signOwnership(state, token, userId) === 'other') return err(403, 'forbidden');
        delete state.doc[token];
        delete state.docOwners[token];
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
      if (method === 'DELETE') {
        // Withdrawing the link, and the audio under it, gives its place among
        // the account's links back. Scoped like publishing.
        const userId = authorize();
        if (!userId) return refused();
        const token = url.searchParams.get('token');
        if (!token) return err(400, 'bad_request');
        if (liveOwnership(state, token, userId) === 'other') return err(403, 'forbidden');
        delete state.liveMedia[token];
        delete state.live[token];
        return ok({ ok: true });
      }
      if (method !== 'POST') return err(405, 'method_not_allowed');
      // The viewer token is public by design, so it names the page but does
      // not grant the right to write to it: only a signed-in account may
      // publish, and only the account that owns the row — or, before there is
      // one that names anyone, the account whose audio is already under it.
      const userId = authorize();
      if (!userId) return refused();
      const { token, payload } = body;
      if (!token) return err(400, 'bad_request');
      if (exceedsSize(payload, LIVE_MAX_PAYLOAD_BYTES)) return tooLarge();
      const row = state.live[token];
      // A link the account already publishes to asks nothing more; one it
      // does not hold yet takes a place among its links.
      if (row?.userId !== userId && !hasLinkRoom(state, userId, { table: 'live_view', token, bytes: 0 })) {
        return linkStorageFull();
      }
      if (liveOwnership(state, token, userId) === 'other') {
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
      // producer. Before there is any, the first account to send audio.
      const userId = authorize();
      if (!userId) return refused();
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
        if (liveOwnership(state, token, userId) === 'other') return err(403, 'forbidden');
        const tracks = state.liveMedia[token] ?? {};
        // Only distinct tracks count, and only on the first chunk, so a track
        // already under way never trips the cap half-uploaded.
        if (seq === 0 && Object.keys(tracks).filter((other) => other !== id).length >= MAX_TRACKS_PER_TOKEN) {
          return tooLarge();
        }
        if (!hasLinkRoom(state, userId, { table: 'live_media', token, id, seq, total, bytes: data.length })) return linkStorageFull();
        state.liveMedia[token] = tracks;
        (tracks[id] ||= [])[seq] = { data, total, userId };
        return ok({ ok: true });
      }
      if (method === 'DELETE') {
        const token = url.searchParams.get('token');
        if (!token) return err(400, 'bad_request');
        if (liveOwnership(state, token, userId) === 'other') return err(403, 'forbidden');
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
        // It counts against the producer who made the link; a legacy link
        // names nobody to count it against.
        const owner = link.userId ?? null;
        if (owner && !hasLinkRoom(state, owner, { table: 'profile_photo', token, seq, total, bytes: data.length })) {
          return linkStorageFull();
        }
        state.profilePhoto[token] ??= {};
        state.profilePhoto[token][seq] = { data, total, userId: owner };
        return ok({ ok: true });
      }
      // Reading is the producer's — the one who made the link, not any
      // account that has seen it.
      const userId = authorize();
      if (!userId) return refused();
      if (method === 'GET') {
        const token = url.searchParams.get('token');
        const seq = Number(url.searchParams.get('seq'));
        if (badToken(token) || !isSeq(seq)) return err(400, 'bad_request');
        if (signOwnership(state, token, userId) === 'other') return err(403, 'forbidden');
        const chunk = state.profilePhoto[token]?.[seq];
        return chunk ? ok({ data: chunk.data, total: chunk.total }) : err(404, 'not_found');
      }
      if (method === 'DELETE') {
        const token = url.searchParams.get('token');
        if (badToken(token)) return err(400, 'bad_request');
        if (signOwnership(state, token, userId) === 'other') return err(403, 'forbidden');
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
        // The signature counts against the producer who made the link, and
        // only an open link is checked: an exact retry is acknowledged below
        // whatever room is left. A legacy link counts against nobody.
        if (!row.signedAt && row.userId &&
            !hasLinkRoom(state, row.userId, { table: 'sign_request', token, bytes: signature.length })) {
          return linkStorageFull();
        }
        if (row.signedAt && row.signature === signature) return ok({ ok: true });
        if (row.signedAt) {
          state.rejectedSecondSign = true;
          return err(409, 'not_signable');
        }
        row.signature = signature;
        row.signedAt = new Date().toISOString();
        row.bytes = signature.length;
        return ok({ ok: true });
      }
      // Producer writes: authenticated, and scoped to the account that made
      // the request. The signer holds the token by construction, so "has the
      // token and an account" must not be enough to revoke or replace it.
      const userId = authorize();
      if (!userId) return refused();
      if (method === 'PUT') {
        const { token, payload } = body;
        if (badToken(token) || typeof payload !== 'string' || payload.length === 0) return err(400, 'bad_request');
        if (exceedsSize(payload, SIGN_MAX_PAYLOAD_BYTES)) return tooLarge();
        // A request takes a place among the account's links — already held,
        // for a contract, by the document uploaded before it.
        if (!hasLinkRoom(state, userId, { table: 'sign_request', token, bytes: 0 })) return linkStorageFull();
        const prev = state.sign[token];
        // upsertSignRequest: another account's row is left alone, and so is
        // a legacy one — nobody may claim it — and a token whose document
        // another account uploaded is theirs. Re-sending never clears a
        // signature already made.
        if (['other', 'legacy'].includes(signOwnership(state, token, userId))) return err(403, 'forbidden');
        state.sign[token] = {
          payload,
          signature: prev?.signature ?? null,
          signedAt: prev?.signedAt ?? null,
          userId,
          ...(prev?.bytes === undefined ? {} : { bytes: prev.bytes }),
        };
        return ok({ ok: true });
      }
      if (method === 'DELETE') {
        const token = url.searchParams.get('token');
        if (badToken(token)) return err(400, 'bad_request');
        if (signOwnership(state, token, userId) === 'other') return err(403, 'forbidden');
        delete state.sign[token];
        delete state.doc[token];
        delete state.docOwners[token];
        delete state.profilePhoto[token];
        return ok({ ok: true });
      }
      return err(405, 'method_not_allowed');
    }

    // No such route. The real server has nothing at this address either, and
    // answering it kindly is how a renamed route stays green for months.
    return err(404, 'not_found');
  });
}
