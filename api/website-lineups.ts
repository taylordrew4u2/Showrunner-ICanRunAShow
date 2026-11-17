import { timingSafeEqual } from './_lib/credentials';
import { ensureSchema, getDb } from './_lib/db';
import { json } from './_lib/http';
import { readWebsiteLineups, seedWebsiteLineups, WebsiteLineupError, websiteLineupsConfig } from './_lib/websiteLineups';

function response(data: unknown, status = 200): Response {
  const result = json(data, status);
  result.headers.set('Cache-Control', 'no-store');
  result.headers.set('Vary', 'Authorization');
  result.headers.set('X-Content-Type-Options', 'nosniff');
  return result;
}

/** Read-only website access and single-use setup never unwrap producer keys. */
export default async function handler(req: Request): Promise<Response> {
  const config = websiteLineupsConfig();
  if (!config) return response({ error: 'not_configured' }, 404);
  if (req.method !== 'GET' && req.method !== 'POST') return response({ error: 'method_not_allowed' }, 405);
  const expected = req.method === 'GET' ? config.readToken : config.setupToken;
  const supplied = /^Bearer ([^\s]+)$/.exec(req.headers.get('authorization') ?? '')?.[1];
  if (!expected || !supplied || !timingSafeEqual(expected, supplied)) return response({ error: 'unauthorized' }, 401);
  try {
    await ensureSchema();
    if (req.method === 'GET') return response(await readWebsiteLineups(getDb()));
    const body = await req.text();
    if (new TextEncoder().encode(body).length > 256 * 1024) return response({ error: 'payload_too_large' }, 413);
    let input: unknown;
    try { input = JSON.parse(body); } catch { return response({ error: 'bad_request' }, 400); }
    await seedWebsiteLineups(getDb(), input);
    return response({ ok: true }, 201);
  } catch (error) {
    if (error instanceof WebsiteLineupError) return response({ error: error.code }, error.status);
    // No publication data, credentials or database errors are logged or echoed.
    return response({ error: 'temporarily_unavailable' }, 503);
  }
}

export const config = { runtime: 'edge' };
