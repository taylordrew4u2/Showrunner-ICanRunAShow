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
 * @property {Record<string, string[]>} media
 * @property {Record<string, string[]>} doc
 * @property {Record<string, {payload: string, signature: string | null, signedAt: string | null}>} sign
 * @property {boolean} rejectedSecondSign  Set when a second signature was refused.
 * @property {string[]} mediaDeletes        Every media id the app asked to delete.
 */


/** @param {Partial<FakeState>} [overrides] @returns {FakeState} */
export function emptyState(overrides = {}) {
  return {
    shows: [],
    settings: null,
    media: {},
    doc: {},
    sign: {},
    rejectedSecondSign: false,
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

    if (path === '/api/shows') {
      if (method === 'GET') return ok({ shows: state.shows });
      if (Array.isArray(body.shows)) state.shows = body.shows;
      return ok({ ok: true });
    }

    if (path === '/api/settings') {
      if (method === 'GET') return ok({ encryptedData: state.settings });
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
