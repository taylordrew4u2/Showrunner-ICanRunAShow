import { timingSafeEqual } from './_lib/credentials';
import { authorize } from './_lib/auth';
import { ensureSchema, getDb } from './_lib/db';
import { json, TooManyRequestsError } from './_lib/http';
import { readWebsiteLineups, reconcileWebsiteLineups, seedWebsiteLineups, WebsiteLineupError, websiteLineupsConfig } from './_lib/websiteLineups';

function response(data: unknown, status = 200): Response {
  const result = json(data, status);
  result.headers.set('Cache-Control', 'no-store');
  result.headers.set('Vary', 'Authorization, x-user-id, x-auth');
  result.headers.set('X-Content-Type-Options', 'nosniff');
  return result;
}

/** Website reads, single-use setup and owner-authenticated public-only repair. */
export default async function handler(req: Request): Promise<Response> {
  const config = websiteLineupsConfig();
  if (!config) return response({ error: 'not_configured' }, 404);
  if (!['GET', 'POST', 'PUT'].includes(req.method)) return response({ error: 'method_not_allowed' }, 405);
  if (req.method !== 'PUT') {
    const expected = req.method === 'GET' ? config.readToken : config.setupToken;
    const supplied = /^Bearer ([^\s]+)$/.exec(req.headers.get('authorization') ?? '')?.[1];
    if (!expected || !supplied || !timingSafeEqual(expected, supplied)) return response({ error: 'unauthorized' }, 401);
  }
  try {
    await ensureSchema();
    // A feed or setup token is never a producer write credential.
    const owner = req.method === 'PUT' ? await authorize(req) : null;
    if (req.method === 'PUT' && !owner) return response({ error: 'unauthorized' }, 401);
    if (req.method === 'GET') return response(await readWebsiteLineups(getDb()));
    const body = await req.text();
    if (new TextEncoder().encode(body).length > 256 * 1024) return response({ error: 'payload_too_large' }, 413);
    let input: unknown;
    try { input = JSON.parse(body); } catch { return response({ error: 'bad_request' }, 400); }
    if (req.method === 'PUT') return response(await reconcileWebsiteLineups(getDb(), owner!, input));
    await seedWebsiteLineups(getDb(), input);
    return response({ ok: true }, 201);
  } catch (error) {
    if (error instanceof WebsiteLineupError) return response({ error: error.code }, error.status);
    if (error instanceof TooManyRequestsError) return response({ error: 'too_many_requests' }, 429);
    // No publication data, credentials or database errors are logged or echoed.
    return response({ error: 'temporarily_unavailable' }, 503);
  }
}

export const config = { runtime: 'edge' };
