import { authorize } from './_lib/auth';
import { ensureSchema, getDb, ServerNotConfiguredError } from './_lib/db';
import { json, TooManyRequestsError } from './_lib/http';
import { clientAddress, rateLimit } from './_lib/ratelimit';
import { allowedOrigin, ASSISTANT_SCOPES, clientInfo, createGrant, exchangeToken, issuer, OAuthError, PURGE_LEGACY_SEALS, registerClient, revokeConnection, revokeConnections } from './_lib/chatgptAuth';

const MAX_BODY = 16 * 1024;

/** OAuth responses never allow credentials or codes into shared caches. */
export function oauthResponse(response: Response, req: Request): Response {
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Pragma', 'no-cache');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  const origin = req.headers.get('origin');
  if (origin && allowedOrigin(req)) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Vary', 'Origin');
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, MCP-Protocol-Version, x-user-id, x-auth');
    response.headers.set('Access-Control-Expose-Headers', 'WWW-Authenticate');
  }
  return response;
}

/**
 * OpenAI's domain check for a plugin: /.well-known/openai-apps-challenge must
 * answer with exactly the token the plugin portal shows, as plain text. The
 * token comes from the portal, so it is read from OPENAI_APPS_CHALLENGE
 * rather than committed; until that is set the address is a plain 404.
 */
export function appsChallenge(): Response {
  const token = (process.env.OPENAI_APPS_CHALLENGE || '').trim();
  if (!token) return json({ error: 'not_found' }, 404);
  return new Response(token, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

export default async function handler(req: Request): Promise<Response> {
  try {
    if (!allowedOrigin(req)) return oauthResponse(json({ error: 'invalid_origin' }, 403), req);
    if (req.method === 'OPTIONS') return oauthResponse(new Response(null, { status: 204 }), req);
    const origin = issuer(req);
    const resource = `${origin}/api/mcp`;
    const route = new URL(req.url).searchParams.get('route');
    if (req.method === 'GET' && route === 'metadata') {
      return oauthResponse(json({
        issuer: origin,
        authorization_endpoint: `${origin}/chatgpt/authorize`,
        token_endpoint: `${origin}/api/chatgpt?route=token`,
        registration_endpoint: `${origin}/api/chatgpt?route=register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: ['none'],
        code_challenge_methods_supported: ['S256'],
        scopes_supported: [...ASSISTANT_SCOPES],
      }), req);
    }
    if (req.method === 'GET' && route === 'resource') {
      return oauthResponse(json({ resource, authorization_servers: [origin], scopes_supported: [...ASSISTANT_SCOPES], bearer_methods_supported: ['header'], resource_name: 'I Can Run A Show' }), req);
    }
    if (req.method === 'GET' && route === 'challenge') return oauthResponse(appsChallenge(), req);
    if (route === 'not-found') return oauthResponse(json({ error: 'not_found' }, 404), req);
    await ensureSchema();
    const db = getDb();
    if (req.method === 'POST' && ['register', 'grant', 'token'].includes(route || '')) {
      const now = Math.floor(Date.now() / 1000);
      // Remove expired delegated material, abandoned consent codes, and
      // anything sealed the first way along with the connections it leaves
      // unusable. Used refresh credentials stay until grant expiry to detect
      // replay.
      await db.batch([
        { sql: 'DELETE FROM chatgpt_tokens WHERE expires_at <= ? OR grant_id IN (SELECT id FROM chatgpt_grants WHERE expires_at <= ? OR (activated = 0 AND created_at <= ?))', args: [now, now, now - 300] },
        { sql: 'DELETE FROM chatgpt_grants WHERE expires_at <= ? OR (activated = 0 AND created_at <= ?)', args: [now, now - 300] },
        ...PURGE_LEGACY_SEALS,
        { sql: 'DELETE FROM chatgpt_clients WHERE expires_at <= ?', args: [now] },
      ], 'write');
    }
    if (req.method === 'GET' && route === 'client') {
      const id = new URL(req.url).searchParams.get('client_id') || '';
      const info = id.length <= 100 ? await clientInfo(db, id) : null;
      return oauthResponse(json(info ? { clientName: info.clientName, redirectUris: info.redirectUris } : { error: 'invalid_client' }, info ? 200 : 404), req);
    }
    if (route === 'connections' || route === 'grant') {
      // A browser connects only from this app. An assistant never receives
      // the account's existing credential or calls these owner-only routes.
      const browserOrigin = req.headers.get('origin');
      if (browserOrigin && browserOrigin !== origin) return oauthResponse(json({ error: 'invalid_origin' }, 403), req);
      const userId = await authorize(req);
      if (!userId) return oauthResponse(json({ error: 'unauthorized' }, 401), req);
      if (route === 'connections' && req.method === 'GET') {
        const rows = (await db.execute({ sql: `SELECT g.id, c.client_name, g.scope, g.created_at, g.expires_at FROM chatgpt_grants g JOIN chatgpt_clients c ON c.client_id = g.client_id WHERE g.user_id = ? AND g.activated = 1 AND g.expires_at > ? ORDER BY g.created_at DESC`, args: [userId, Math.floor(Date.now() / 1000)] })).rows;
        return oauthResponse(json({ connections: rows.map(r => ({ id: String(r[0]), clientName: String(r[1]), scope: String(r[2]), createdAt: new Date(Number(r[3]) * 1000).toISOString(), expiresAt: new Date(Number(r[4]) * 1000).toISOString() })) }), req);
      }
      if (route === 'connections' && req.method === 'DELETE') {
        // With an id, only that connection goes. Without one, all of them.
        // An empty or repeated id is refused rather than read as "all".
        const params = new URL(req.url).searchParams;
        if (params.has('id')) {
          const id = params.get('id') || '';
          if (!id || id.length > 100 || params.getAll('id').length !== 1) throw new OAuthError('invalid_request', 'Name one connection to disconnect.');
          await revokeConnection(db, userId, id);
        } else {
          await revokeConnections(db, userId);
        }
        return oauthResponse(json({ ok: true }), req);
      }
      if (route === 'grant' && req.method === 'POST') {
        if (!(await rateLimit(db, `chatgpt:grant:${userId}`, 20, 3600)).allowed) return oauthResponse(json({ error: 'too_many_requests' }, 429), req);
        const text = await req.text();
        if (text.length > MAX_BODY) return oauthResponse(json({ error: 'payload_too_large' }, 413), req);
        let body: unknown;
        try { body = JSON.parse(text); } catch { throw new OAuthError('invalid_request', 'Invalid JSON.'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new OAuthError('invalid_request', 'Expected a JSON object.');
        return oauthResponse(json(await createGrant(db, userId, body as Record<string, unknown>, resource)), req);
      }
    }
    if (req.method === 'POST' && (route === 'register' || route === 'token')) {
      if (!(await rateLimit(db, `chatgpt:${route}:${clientAddress(req)}`, route === 'register' ? 30 : 300, 3600)).allowed) return oauthResponse(json({ error: 'too_many_requests' }, 429), req);
      const text = await req.text();
      if (text.length > MAX_BODY) return oauthResponse(json({ error: 'payload_too_large' }, 413), req);
      if (route === 'register') {
        let body: unknown;
        try { body = JSON.parse(text); } catch { throw new OAuthError('invalid_request', 'Invalid JSON.'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new OAuthError('invalid_request', 'Expected a JSON object.');
        return oauthResponse(json(await registerClient(db, body as Record<string, unknown>), 201), req);
      }
      if (!req.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) throw new OAuthError('invalid_request', 'Use application/x-www-form-urlencoded.');
      const params = new URLSearchParams(text);
      if ([...params.keys()].some(key => params.getAll(key).length !== 1)) throw new OAuthError('invalid_request', 'Duplicate token parameters are not supported.');
      return oauthResponse(json(await exchangeToken(db, params, resource)), req);
    }
    return oauthResponse(json({ error: 'method_not_allowed' }, 405), req);
  } catch (err) {
    if (err instanceof OAuthError) return oauthResponse(json({ error: err.code, error_description: err.message }, err.status), req);
    if (err instanceof TooManyRequestsError) return oauthResponse(json({ error: 'too_many_requests' }, 429), req);
    if (err instanceof ServerNotConfiguredError) return oauthResponse(json({ error: 'server_not_configured' }, 503), req);
    // OAuth handles delegated encryption material: do not emit request or
    // database details to logs or development-mode error responses.
    return oauthResponse(json({ error: 'server_error' }, 500), req);
  }
}

export const config = { runtime: 'edge' };
