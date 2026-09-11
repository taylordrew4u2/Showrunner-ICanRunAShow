import { createHash } from 'node:crypto';
/**
 * An in-memory stand-in for the edge API.
 *
 * The app encrypts everything in the browser, so the interesting code — key
 * derivation, the chunked media store, the per-request keys behind a signing
 * link — only runs client-side. What the server contributes is a handful of
 * rules, and those are what this reproduces: chunk storage keyed the way the
 * real routes key it, and the one rule that actually protects a signature
 * (`WHERE signed_at IS NULL` — sign once, never twice).
 *
 * Faking it rather than pointing at a live Turso instance keeps the suite
 * hermetic and secret-free in CI, and means a test can seed a state that would
 * be tedious to reach for real — an orphaned media blob left by an older
 * build, say.
 */
/**
 * @typedef {object} FakeState
 * @property {{id: string, encryptedData: string}[]} shows
 * @property {string | null} settings
 * @property {{at: string, shows: {id: string, encryptedData: string}[]}[]} showSnapshots  Earlier saves, newest last.
 * @property {{at: string, encryptedData: string}[]} settingsSnapshots
 * @property {Record<string, string[]>} media
 * @property {Record<string, string[]>} doc
 * @property {Record<string, {payload: string, signature: string | null, signedAt: string | null}>} sign
 * @property {Record<string, {userId: string, payload: unknown}>} live  Published viewer state, by token.
 * @property {boolean} rejectedForeignPublish  Set when a publish from another account was refused.
 * @property {boolean} rejectedSecondSign  Set when a second signature was refused.
 * @property {string[]} mediaDeletes        Every media id the app asked to delete.
 */


/** @param {Partial<FakeState>} [overrides] @returns {FakeState} */
export function emptyState(overrides = {}) {
  return {
    shows: [],
    settings: null,
    showSnapshots: [],
    settingsSnapshots: [],
    media: {},
    doc: {},
    sign: {},
    profilePhoto: {},
    live: {},
    rejectedSecondSign: false,
    rejectedForeignPublish: false,
    mediaDeletes: [],
    ...overrides,
  };
}

/** @param {import("playwright").BrowserContext} ctx @param {FakeState} state */
export async function installFakeApi(ctx, state) {
  await ctx.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();
    const body = ['POST', 'PUT'].includes(method) ? JSON.parse(req.postData() || '{}') : {};
    const ok = (data) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    const err = (status, error) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error }) });

    if (path === '/api/auth') return ok({ ok: true, userId: body.userId });

    // The real routes stamp snapshots to the second, so a burst of saves in
    // one second is one snapshot. Distinct stamps here, so a test's quick
    // edits stay separately restorable.
    const stamp = () => {
      const at = new Date(Date.now() + state.showSnapshots.length * 1000 + state.settingsSnapshots.length * 1000)
        .toISOString().slice(0, 19).replace('T', ' ');
      return at;
    };

    if (path === '/api/shows') {
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
      if (!Array.isArray(body.changes)) return err(428, 'client_update_required');
      for (const c of body.changes) {
        const current = state.shows.find(s => s.id === c.id)?.encryptedData ?? null;
        if (current === c.encryptedData) continue;
        const hash = current === null ? null : createHash('sha256').update(current).digest('hex');
        if (hash !== c.expectedHash) return err(409, 'save_conflict');
      }
      if (state.shows.length) state.showSnapshots.push({ at: stamp(), shows: [...state.shows] });
      for (const c of body.changes) {
        state.shows = state.shows.filter(s => s.id !== c.id);
        if (c.encryptedData !== null) state.shows.push({ id: c.id, encryptedData: c.encryptedData });
      }
      return ok({ ok: true });
    }

    if (path === '/api/settings') {
      if (method === 'GET' && url.searchParams.get('history')) {
        return ok({ snapshots: [...state.settingsSnapshots].reverse().map((s) => ({ at: s.at })) });
      }
      if (method === 'GET' && url.searchParams.get('at')) {
        const snap = state.settingsSnapshots.find((s) => s.at === url.searchParams.get('at'));
        if (!snap) return err(404, 'not_found');
        return ok({ encryptedData: snap.encryptedData });
      }
      if (method === 'GET') return ok({ encryptedData: state.settings });
      if (body.park) {
        state.settingsSnapshots.push({ at: stamp(), encryptedData: body.encryptedData });
        return ok({ ok: true });
      }
      if (state.settings) state.settingsSnapshots.push({ at: stamp(), encryptedData: state.settings });
      state.settings = body.encryptedData;
      return ok({ ok: true });
    }

    if (path === '/api/media') {
      if (method === 'PUT') {
        (state.media[body.id] ||= [])[body.seq] = body.data;
        return ok({ ok: true });
      }
      if (method === 'GET' && url.searchParams.get('list')) {
        return ok({
          items: Object.entries(state.media).map(([id, chunks]) => ({
            id,
            chunks: chunks.length,
            bytes: chunks.join('').length,
          })),
        });
      }
      if (method === 'GET') {
        const chunks = state.media[url.searchParams.get('id') ?? ''];
        const seq = Number(url.searchParams.get('seq'));
        if (!chunks?.[seq]) return err(404, 'not_found');
        return ok({ data: chunks[seq], total: chunks.length });
      }
      if (method === 'DELETE') {
        const id = url.searchParams.get('id') ?? '';
        state.mediaDeletes.push(id);
        delete state.media[id];
        return ok({ ok: true });
      }
    }

    if (path === '/api/sign-doc') {
      if (method === 'PUT') {
        (state.doc[body.token] ||= [])[body.seq] = body.data;
        return ok({ ok: true });
      }
      if (method === 'GET') {
        const chunks = state.doc[url.searchParams.get('token') ?? ''];
        const seq = Number(url.searchParams.get('seq'));
        if (!chunks?.[seq]) return err(404, 'not_found');
        return ok({ data: chunks[seq], total: chunks.length });
      }
      delete state.doc[url.searchParams.get('token') ?? ''];
      return ok({ ok: true });
    }

    if (path === '/api/live') {
      if (method === 'GET') {
        // Public: this is the link handed to the room.
        const row = state.live[url.searchParams.get('token') ?? ''];
        return ok({ payload: row ? row.payload : null });
      }
      if (method === 'POST') {
        // The rule the real route enforces in SQL. The viewer token is public
        // by design, so it names the page but does not grant the right to
        // write to it: only the account that owns the row may publish.
        const userId = req.headers()['x-user-id'] ?? '';
        if (!userId) return err(401, 'unauthorized');
        const row = state.live[body.token];
        if (row && row.userId !== userId) {
          state.rejectedForeignPublish = true;
          return err(403, 'forbidden');
        }
        state.live[body.token] = { userId, payload: body.payload };
        return ok({ ok: true });
      }
    }

    if (path === '/api/profile-photo') {
      if (method === 'PUT') {
        // The rules the real route enforces: a link the producer made, and
        // still unanswered. The reply seals the photo with it.
        const link = state.sign[body.token];
        if (!link) return err(404, 'not_found');
        if (link.signedAt) return err(409, 'not_open');
        state.profilePhoto[body.token] ??= {};
        state.profilePhoto[body.token][body.seq] = { data: body.data, total: body.total };
        return ok({ ok: true });
      }
      if (method === 'GET') {
        const chunk = state.profilePhoto[url.searchParams.get('token') ?? '']?.[Number(url.searchParams.get('seq'))];
        return chunk ? ok(chunk) : err(404, 'not_found');
      }
      delete state.profilePhoto[url.searchParams.get('token') ?? ''];
      return ok({ ok: true });
    }

    if (path === '/api/sign') {
      if (method === 'PUT') {
        const prev = state.sign[body.token];
        state.sign[body.token] = {
          payload: String(body.payload),
          signature: prev?.signature ?? null,
          signedAt: prev?.signedAt ?? null,
        };
        return ok({ ok: true });
      }
      if (method === 'GET') {
        const row = state.sign[url.searchParams.get('token') ?? ''];
        if (!row) return err(404, 'not_found');
        return ok(row);
      }
      if (method === 'POST') {
        const row = state.sign[body.token];
        // The rule the real route enforces in SQL. A replayed or racing POST
        // must never overwrite an agreement that is already on file.
        if (!row || row.signedAt) {
          state.rejectedSecondSign = true;
          return err(409, 'not_signable');
        }
        row.signature = String(body.signature);
        row.signedAt = new Date().toISOString();
        return ok({ ok: true });
      }
      delete state.sign[url.searchParams.get('token') ?? ''];
      return ok({ ok: true });
    }

    return ok({ ok: true });
  });
}
