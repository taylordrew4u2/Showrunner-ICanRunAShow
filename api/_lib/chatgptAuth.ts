import type { Client, InStatement } from '@libsql/client';
import { pkceChallenge, randomToken, sealKeys, unsealKeys, type DelegatedKeys } from './seal';
import { cipherHash } from './showWrites';

/**
 * Every permission a producer can grant an AI assistant, in the order the
 * consent page lists them and grants store them. shows:read is the floor:
 * every other permission works on shows the assistant has to be able to find.
 */
export const ASSISTANT_SCOPES: readonly string[] = ['shows:read', 'shows:write', 'shows:delete', 'rolodex:read', 'rolodex:write', 'contracts:read', 'links:send'];
/** What a client gets when it asks for nothing narrower: every permission.
 * Kept under its first name so existing imports still read the default. */
export const CHATGPT_SCOPE = ASSISTANT_SCOPES.join(' ');
// Claude's hosted apps (web, Desktop, mobile) all return to one fixed callback.
const CLAUDE_CALLBACKS = ['https://claude.ai/api/mcp/auth_callback', 'https://claude.com/api/mcp/auth_callback'];
// ChatGPT returns to its stable callback, or to one with a per-connector id.
// Registration is open to anyone, so any other chatgpt.com page would let a
// stranger start a flow with their own PKCE verifier and collect the code
// wherever that page lets a URL leak.
const CHATGPT_HOSTS = ['chatgpt.com', 'chat.openai.com'];
const CHATGPT_CALLBACK_PATH = /^\/(connector_platform_oauth_redirect|connector\/oauth\/[A-Za-z0-9_-]{1,100})$/;
const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost'];
const GRANT_SECONDS = 30 * 24 * 60 * 60;
const ACCESS_SECONDS = 60 * 60;
// How long a registered client is kept after it was last used: registered, or
// a code redeemed or a refresh made through it. ChatGPT registers once per
// connector and reuses that client for everyone who connects through it, so a
// client still in use must never lapse; one nobody uses for this long goes.
const CLIENT_SECONDS = 90 * 24 * 60 * 60;
export class OAuthError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

export function issuer(req: Request): string {
  const url = new URL(process.env.APP_URL || req.url);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new OAuthError('invalid_request', 'HTTPS is required.');
  }
  return url.origin;
}

// Browser pages that may call the public OAuth routes and /api/mcp: the
// assistants' web apps, and OpenAI's plugin portal, which connects to the
// server and scans its tools from the browser.
const ASSISTANT_ORIGINS = ['https://chatgpt.com', 'https://chat.openai.com', 'https://platform.openai.com', 'https://claude.ai', 'https://claude.com'];

export function allowedOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  return !origin || [issuer(req), ...ASSISTANT_ORIGINS].includes(origin);
}

export function validRedirect(value: unknown): value is string {
  // A bare trailing "#" parses to an empty hash, so look at the text itself.
  if (typeof value !== 'string' || value.length > 2048 || value.includes('#')) return false;
  try {
    const u = new URL(value);
    // Registration is for the assistants' own callbacks, not arbitrary or
    // private network destinations, credentials, or URL fragments.
    if (u.username || u.password) return false;
    if (CLAUDE_CALLBACKS.includes(value)) return true;
    // Native clients such as Claude Code listen on a loopback port for the
    // callback (RFC 8252). Plain HTTP is fine there: the code never leaves
    // the machine, and redeeming it still needs the PKCE verifier that only
    // the listening process holds.
    if (u.protocol === 'http:' && LOOPBACK_HOSTS.includes(u.hostname)) return true;
    return u.protocol === 'https:' && CHATGPT_HOSTS.includes(u.hostname) && (!u.port || u.port === '443') &&
      CHATGPT_CALLBACK_PATH.test(u.pathname) && !u.search;
  } catch { return false; }
}

function loopbackRedirect(value: string): URL | null {
  if (!validRedirect(value)) return null;
  const u = new URL(value);
  return u.protocol === 'http:' && LOOPBACK_HOSTS.includes(u.hostname) ? u : null;
}

/** Whether a request's callback is one its client registered. Exact, except
 * that a loopback callback may name any port: a native client is handed a
 * fresh one by the OS each time it listens (RFC 8252 section 7.3). */
export function redirectMatches(registered: string[], requested: string): boolean {
  if (registered.includes(requested)) return true;
  const want = loopbackRedirect(requested);
  return !!want && registered.some(uri => {
    const have = loopbackRedirect(uri);
    return !!have && have.hostname === want.hostname && have.pathname === want.pathname && have.search === want.search;
  });
}

export function normalizeScope(value: unknown): string {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) return CHATGPT_SCOPE;
  if (typeof value !== 'string') throw new OAuthError('invalid_scope', 'Unknown scope.');
  const parts = new Set(value.trim().split(/\s+/));
  if (!parts.has('shows:read') || [...parts].some(p => !ASSISTANT_SCOPES.includes(p))) {
    throw new OAuthError('invalid_scope', `Request shows:read, optionally with ${ASSISTANT_SCOPES.slice(1).join(', ')}.`);
  }
  // Editing the Rolodex shows what is in it (an edit hands back the entry,
  // and adding refuses a name already there), so it brings seeing it too,
  // as the consent page shows by ticking and locking that box.
  if (parts.has('rolodex:write')) parts.add('rolodex:read');
  // One canonical order, so the same permissions named in another order on
  // a refresh still match the grant they came from.
  return ASSISTANT_SCOPES.filter(scope => parts.has(scope)).join(' ');
}

// The sealing itself is shared with co-producer links (seal.ts); these stay
// exported from here so existing imports keep working.
export { pkceChallenge, randomToken };
export type { DelegatedKeys };
export interface DelegatedGrant extends DelegatedKeys { userId: string; scope: string; grantId: string }

// The key that seals a credential's delegated keys must not be anything the
// database holds. Its lookup hash is the token's bare SHA-256, so the seal
// key is derived under a label of its own instead.
const SEAL_VERSION = 'v2';
const SEAL_PREFIX = `${SEAL_VERSION}.`;
const SEAL_INFO = 'icanrunashow assistant delegated keys v2';

/** A DB-only compromise cannot recover the explicitly delegated keys. */
function seal(keys: DelegatedKeys, token: string): Promise<string> {
  return sealKeys(keys, token, SEAL_INFO, SEAL_VERSION);
}
function unseal(value: string, token: string): Promise<DelegatedKeys> {
  return unsealKeys(value, token, SEAL_INFO, SEAL_VERSION);
}

/**
 * The first seals used the token's bare SHA-256, which is also its stored
 * hash, so a copy of the database alone could open them. Nothing opens them
 * any more: a credential sealed that way counts as no credential at all.
 * A used credential keeps an empty seal, and is not one of them.
 */
function legacySeal(value: unknown): boolean {
  const sealed = typeof value === 'string' ? value : '';
  return sealed !== '' && !sealed.startsWith(SEAL_PREFIX);
}

const LEGACY_SEALED = `sealed_keys != '' AND substr(sealed_keys, 1, ${SEAL_PREFIX.length}) != ?`;
/**
 * Delete every credential sealed the first way, and its connection once no
 * credential sealed the current way is left under it, so the producer
 * connects again through the consent page. A connection still waiting on its
 * code holds a current one, so it is never caught. Safe to run any number of
 * times; it runs with the expiry clean-up, and wherever such a credential
 * turns up.
 */
export const PURGE_LEGACY_SEALS: InStatement[] = [
  // Connections first, while their credentials still show how they were sealed.
  {
    sql: `DELETE FROM chatgpt_grants WHERE id IN (SELECT grant_id FROM chatgpt_tokens WHERE ${LEGACY_SEALED})
          AND id NOT IN (SELECT grant_id FROM chatgpt_tokens WHERE substr(sealed_keys, 1, ${SEAL_PREFIX.length}) = ?)`,
    args: [SEAL_PREFIX, SEAL_PREFIX],
  },
  // Then those credentials, and the used ones of any connection just removed.
  { sql: `DELETE FROM chatgpt_tokens WHERE (${LEGACY_SEALED}) OR grant_id NOT IN (SELECT id FROM chatgpt_grants)`, args: [SEAL_PREFIX] },
];

export async function clientInfo(db: Client, id: string): Promise<{ clientName: string; redirectUris: string[]; grantTypes: string[] } | null> {
  const rows = (await db.execute({ sql: 'SELECT client_name, redirect_uris, grant_types FROM chatgpt_clients WHERE client_id = ? AND expires_at > ?', args: [id, Math.floor(Date.now() / 1000)] })).rows;
  return rows[0] ? { clientName: String(rows[0][0]), redirectUris: JSON.parse(String(rows[0][1])) as string[], grantTypes: JSON.parse(String(rows[0][2])) as string[] } : null;
}

/** The consent page names the client, so one that registered no name is
 * named after where its callback goes. */
function defaultClientName(redirectUri: string): string {
  const host = new URL(redirectUri).hostname;
  if (LOOPBACK_HOSTS.includes(host)) return 'An app on this computer';
  return ['claude.ai', 'claude.com'].includes(host) ? 'Claude' : 'ChatGPT';
}

export async function registerClient(db: Client, body: Record<string, unknown>): Promise<unknown> {
  if (!Array.isArray(body.redirect_uris) || body.redirect_uris.length < 1 || body.redirect_uris.length > 5 || !body.redirect_uris.every(validRedirect)) {
    throw new OAuthError('invalid_redirect_uri', 'Register a Claude or ChatGPT callback, or a loopback address, without a fragment.');
  }
  if (body.token_endpoint_auth_method !== undefined && body.token_endpoint_auth_method !== 'none') {
    throw new OAuthError('invalid_client_metadata', 'Public clients use token_endpoint_auth_method none.');
  }
  if (body.grant_types !== undefined && (!Array.isArray(body.grant_types) || !body.grant_types.includes('authorization_code') || body.grant_types.some(g => !['authorization_code', 'refresh_token'].includes(String(g))))) {
    throw new OAuthError('invalid_client_metadata', 'Only authorization_code and refresh_token grants are supported.');
  }
  if (body.response_types !== undefined && (!Array.isArray(body.response_types) || body.response_types.length !== 1 || body.response_types[0] !== 'code')) {
    throw new OAuthError('invalid_client_metadata', 'Only the code response type is supported.');
  }
  const clientName = typeof body.client_name === 'string' && body.client_name.trim() ? body.client_name.trim().slice(0, 100) : defaultClientName(body.redirect_uris[0]);
  const clientId = randomToken();
  const now = Math.floor(Date.now() / 1000);
  const grantTypes = body.grant_types === undefined ? ['authorization_code', 'refresh_token'] : [...new Set(body.grant_types as string[])];
  await db.execute({ sql: 'INSERT INTO chatgpt_clients (client_id, client_name, redirect_uris, grant_types, expires_at) VALUES (?, ?, ?, ?, ?)', args: [clientId, clientName, JSON.stringify(body.redirect_uris), JSON.stringify(grantTypes), now + CLIENT_SECONDS] });
  return { client_id: clientId, client_id_issued_at: now, client_name: clientName, redirect_uris: body.redirect_uris, token_endpoint_auth_method: 'none', grant_types: grantTypes, response_types: ['code'], scope: CHATGPT_SCOPE };
}

export async function createGrant(db: Client, userId: string, body: Record<string, unknown>, resource: string): Promise<{ redirect_url: string }> {
  const clientId = typeof body.client_id === 'string' ? body.client_id : '';
  const client = await clientInfo(db, clientId);
  if (!client) throw new OAuthError('invalid_client', 'Unknown or expired client.');
  if (!validRedirect(body.redirect_uri) || !redirectMatches(client.redirectUris, body.redirect_uri)) throw new OAuthError('invalid_request', 'Callback does not match the registered client.');
  if (body.response_type !== 'code' || body.code_challenge_method !== 'S256' || typeof body.code_challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.code_challenge)) {
    throw new OAuthError('invalid_request', 'A code response with PKCE S256 is required.');
  }
  if (body.resource !== undefined && body.resource !== resource) throw new OAuthError('invalid_target', 'The resource must be this app’s MCP endpoint.');
  if (body.state !== undefined && (typeof body.state !== 'string' || body.state.length > 2048)) throw new OAuthError('invalid_request', 'Invalid state.');
  if (typeof body.key !== 'string' || !/^[a-f0-9]{64}$/i.test(body.key) || (body.legacyKey !== undefined && (typeof body.legacyKey !== 'string' || !/^[a-f0-9]{64}$/i.test(body.legacyKey)))) {
    throw new OAuthError('invalid_request', 'Valid derived data keys are required.');
  }
  const scope = normalizeScope(body.scope);
  const now = Math.floor(Date.now() / 1000);
  const code = randomToken();
  const grantId = crypto.randomUUID();
  const keys = { key: body.key, ...(body.legacyKey ? { legacyKey: String(body.legacyKey) } : {}) };
  await db.batch([
    // A registration outlives every grant made under it. Settings lists a
    // connection by its client, so one whose client lapsed first could be
    // neither refreshed nor seen, and so not disconnected either.
    { sql: 'UPDATE chatgpt_clients SET expires_at = MAX(expires_at, ?) WHERE client_id = ?', args: [now + GRANT_SECONDS, clientId] },
    { sql: 'INSERT INTO chatgpt_grants (id, user_id, client_id, scope, resource, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)', args: [grantId, userId, clientId, scope, resource, now, now + GRANT_SECONDS] },
    { sql: 'INSERT INTO chatgpt_tokens (token_hash, kind, grant_id, user_id, sealed_keys, challenge, redirect_uri, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', args: [await cipherHash(code), 'code', grantId, userId, await seal(keys, code), body.code_challenge, body.redirect_uri, now + 300] },
  ], 'write');
  const redirect = new URL(body.redirect_uri);
  redirect.searchParams.set('code', code);
  if (body.state !== undefined) redirect.searchParams.set('state', body.state);
  return { redirect_url: redirect.href };
}

export async function exchangeToken(db: Client, params: URLSearchParams, resource: string): Promise<unknown> {
  const kind = params.get('grant_type') === 'authorization_code' ? 'code' : params.get('grant_type') === 'refresh_token' ? 'refresh' : null;
  if (!kind) throw new OAuthError('unsupported_grant_type', 'Use authorization_code or refresh_token.');
  if (params.has('resource') && params.get('resource') !== resource) throw new OAuthError('invalid_target', 'The resource must be this app’s MCP endpoint.');
  const raw = params.get(kind === 'code' ? 'code' : 'refresh_token') || '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(raw)) throw new OAuthError('invalid_grant', 'Invalid or expired credential.');
  const hash = await cipherHash(raw);
  const now = Math.floor(Date.now() / 1000);
  const tx = await db.transaction('write');
  try {
    const rows = (await tx.execute({ sql: `SELECT t.*, g.client_id, g.scope, g.resource, g.expires_at AS grant_expires FROM chatgpt_tokens t JOIN chatgpt_grants g ON g.id = t.grant_id WHERE t.token_hash = ? AND t.kind = ?`, args: [hash, kind] })).rows;
    const row = rows[0];
    if (row && legacySeal(row.sealed_keys)) {
      // Refused as if it were not there, and removed with its connection.
      await tx.batch(PURGE_LEGACY_SEALS);
      await tx.commit();
      throw new OAuthError('invalid_grant', 'Invalid or expired credential.');
    }
    if (!row || Number(row.expires_at) <= now || Number(row.grant_expires) <= now || row.client_id !== params.get('client_id') || row.resource !== resource) throw new OAuthError('invalid_grant', 'Invalid or expired credential.');
    if (Number(row.consumed)) {
      // A replayed code or refresh token revokes its entire connection, so
      // whatever was issued from it stops working (RFC 6749 section 4.1.2)
      // rather than leaving a stolen, rotated credential family usable.
      await tx.execute({ sql: 'DELETE FROM chatgpt_tokens WHERE grant_id = ?', args: [row.grant_id] });
      await tx.execute({ sql: 'DELETE FROM chatgpt_grants WHERE id = ?', args: [row.grant_id] });
      await tx.commit();
      throw new OAuthError('invalid_grant', 'Credential has already been used.');
    }
    if (kind === 'code') {
      const verifier = params.get('code_verifier') || '';
      if (params.get('redirect_uri') !== row.redirect_uri || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || await pkceChallenge(verifier) !== row.challenge) {
        throw new OAuthError('invalid_grant', 'Callback or PKCE verifier does not match.');
      }
    }
    // A refresh keeps exactly what the producer ticked. An omitted or empty
    // scope means that set (RFC 6749 section 6); anything else, wider above
    // all, needs the consent page again. Both sides are read the one way, so
    // a grant stored before rolodex:write brought rolodex:read can still name
    // its own set, and keeps exactly that.
    if (kind === 'refresh' && params.get('scope')?.trim() && normalizeScope(params.get('scope')) !== normalizeScope(row.scope)) throw new OAuthError('invalid_scope', 'Reconnect to change permissions.');
    let keys: DelegatedKeys;
    try { keys = await unseal(String(row.sealed_keys), raw); }
    catch { throw new OAuthError('invalid_grant', 'Invalid or expired credential.'); }
    const client = await clientInfo(db, String(row.client_id));
    if (!client || !client.grantTypes.includes(kind === 'code' ? 'authorization_code' : 'refresh_token')) throw new OAuthError('unauthorized_client', 'This client is not registered for this grant type.');
    const access = randomToken();
    const refresh = randomToken();
    await tx.execute({ sql: 'UPDATE chatgpt_tokens SET consumed = 1, sealed_keys = ? WHERE token_hash = ?', args: ['', hash] });
    await tx.execute({ sql: 'DELETE FROM chatgpt_tokens WHERE grant_id = ? AND kind = ?', args: [row.grant_id, 'access'] });
    const credentials: [string, string, number][] = [[access, 'access', Math.min(now + ACCESS_SECONDS, Number(row.grant_expires))]];
    if (client.grantTypes.includes('refresh_token')) credentials.push([refresh, 'refresh', Number(row.grant_expires)]);
    for (const [token, tokenKind, expiry] of credentials) {
      await tx.execute({ sql: 'INSERT INTO chatgpt_tokens (token_hash, kind, grant_id, user_id, sealed_keys, expires_at) VALUES (?, ?, ?, ?, ?, ?)', args: [await cipherHash(token), tokenKind, row.grant_id, row.user_id, await seal(keys, token), expiry] });
    }
    await tx.execute({ sql: 'UPDATE chatgpt_grants SET activated = 1 WHERE id = ?', args: [row.grant_id] });
    // The client is in use, so keep it: at least as long as the connection
    // these credentials belong to, and CLIENT_SECONDS from now. Never shorter
    // than it already was.
    await tx.execute({ sql: 'UPDATE chatgpt_clients SET expires_at = MAX(expires_at, ?) WHERE client_id = ?', args: [Math.max(now + CLIENT_SECONDS, Number(row.grant_expires)), row.client_id] });
    await tx.commit();
    return { access_token: access, token_type: 'Bearer', expires_in: Math.min(ACCESS_SECONDS, Number(row.grant_expires) - now), ...(client.grantTypes.includes('refresh_token') ? { refresh_token: refresh } : {}), scope: String(row.scope) };
  } finally { tx.close(); }
}

export async function bearerGrant(db: Client, req: Request): Promise<DelegatedGrant | null> {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(req.headers.get('authorization') || '');
  if (!match) return null;
  const now = Math.floor(Date.now() / 1000);
  const rows = (await db.execute({ sql: `SELECT t.sealed_keys, t.user_id, t.grant_id, g.scope FROM chatgpt_tokens t JOIN chatgpt_grants g ON g.id = t.grant_id JOIN users u ON u.id = g.user_id WHERE t.token_hash = ? AND t.kind = 'access' AND t.consumed = 0 AND t.expires_at > ? AND g.expires_at > ? AND g.resource = ? AND g.activated = 1`, args: [await cipherHash(match[1]), now, now, `${issuer(req)}/api/mcp`] })).rows;
  if (!rows[0]) return null;
  const row = rows[0];
  if (legacySeal(row.sealed_keys)) {
    // The MCP route runs no clean-up of its own, so a connection that never
    // refreshes would otherwise keep using one until it expired.
    await db.batch(PURGE_LEGACY_SEALS, 'write');
    return null;
  }
  try { return { ...await unseal(String(row.sealed_keys), match[1]), userId: String(row.user_id), scope: String(row.scope), grantId: String(row.grant_id) }; }
  catch { return null; }
}

/** Revoke one connection and every credential under it, leaving the
 * producer's other connections alone. Both deletes are scoped to the owner,
 * so another account's grant id revokes nothing. */
export async function revokeConnection(db: Client, userId: string, grantId: string): Promise<void> {
  await db.batch([
    { sql: 'DELETE FROM chatgpt_tokens WHERE grant_id = ? AND user_id = ?', args: [grantId, userId] },
    { sql: 'DELETE FROM chatgpt_grants WHERE id = ? AND user_id = ?', args: [grantId, userId] },
  ], 'write');
}

export async function revokeConnections(db: Client, userId: string): Promise<void> {
  await db.batch([
    { sql: 'DELETE FROM chatgpt_tokens WHERE user_id = ?', args: [userId] },
    { sql: 'DELETE FROM chatgpt_grants WHERE user_id = ?', args: [userId] },
  ], 'write');
}
