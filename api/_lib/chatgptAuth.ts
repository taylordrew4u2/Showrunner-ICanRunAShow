import type { Client } from '@libsql/client';
import { cipherHash } from './showWrites';

export const CHATGPT_SCOPE = 'shows:read shows:write';
const GRANT_SECONDS = 30 * 24 * 60 * 60;
const ACCESS_SECONDS = 60 * 60;
const encoder = new TextEncoder();

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

export function allowedOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  return !origin || [issuer(req), 'https://chatgpt.com', 'https://chat.openai.com'].includes(origin);
}

export function validRedirect(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const u = new URL(value);
    // Registration is for public ChatGPT web clients, not private network
    // destinations, loopback callbacks, credentials, or URL fragments.
    return u.protocol === 'https:' && !u.username && !u.password && !u.hash &&
      ['chatgpt.com', 'chat.openai.com'].includes(u.hostname) && (!u.port || u.port === '443');
  } catch { return false; }
}

export function normalizeScope(value: unknown): string {
  if (value === undefined || value === null || value === '') return CHATGPT_SCOPE;
  if (typeof value !== 'string') throw new OAuthError('invalid_scope', 'Unknown scope.');
  const parts = [...new Set(value.trim().split(/\s+/))];
  if (!parts.includes('shows:read') || parts.some(p => !['shows:read', 'shows:write'].includes(p))) {
    throw new OAuthError('invalid_scope', 'Only shows:read and shows:write are supported.');
  }
  return parts.includes('shows:write') ? CHATGPT_SCOPE : 'shows:read';
}

function b64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function unb64(value: string): Uint8Array {
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
}
export function randomToken(): string { return b64(crypto.getRandomValues(new Uint8Array(32))); }
export async function pkceChallenge(verifier: string): Promise<string> {
  return b64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier))));
}

export interface DelegatedKeys { key: string; legacyKey?: string }
export interface DelegatedGrant extends DelegatedKeys { userId: string; scope: string; grantId: string }

async function wrappingKey(token: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', encoder.encode(token)), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** A DB-only compromise cannot recover the explicitly delegated keys. */
async function seal(keys: DelegatedKeys, token: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await wrappingKey(token), encoder.encode(JSON.stringify(keys)));
  return `${b64(iv)}.${b64(new Uint8Array(cipher))}`;
}
async function unseal(value: string, token: string): Promise<DelegatedKeys> {
  const [iv, cipher] = value.split('.');
  const text = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) as Uint8Array<ArrayBuffer> }, await wrappingKey(token), unb64(cipher) as Uint8Array<ArrayBuffer>);
  return JSON.parse(new TextDecoder().decode(text)) as DelegatedKeys;
}

export async function clientInfo(db: Client, id: string): Promise<{ clientName: string; redirectUris: string[]; grantTypes: string[] } | null> {
  const rows = (await db.execute({ sql: 'SELECT client_name, redirect_uris, grant_types FROM chatgpt_clients WHERE client_id = ? AND expires_at > ?', args: [id, Math.floor(Date.now() / 1000)] })).rows;
  return rows[0] ? { clientName: String(rows[0][0]), redirectUris: JSON.parse(String(rows[0][1])) as string[], grantTypes: JSON.parse(String(rows[0][2])) as string[] } : null;
}

export async function registerClient(db: Client, body: Record<string, unknown>): Promise<unknown> {
  if (!Array.isArray(body.redirect_uris) || body.redirect_uris.length < 1 || body.redirect_uris.length > 5 || !body.redirect_uris.every(validRedirect)) {
    throw new OAuthError('invalid_redirect_uri', 'Register an HTTPS ChatGPT callback without a fragment.');
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
  const clientName = typeof body.client_name === 'string' && body.client_name.trim() ? body.client_name.trim().slice(0, 100) : 'ChatGPT';
  const clientId = randomToken();
  const now = Math.floor(Date.now() / 1000);
  const grantTypes = body.grant_types === undefined ? ['authorization_code', 'refresh_token'] : [...new Set(body.grant_types as string[])];
  await db.execute({ sql: 'INSERT INTO chatgpt_clients (client_id, client_name, redirect_uris, grant_types, expires_at) VALUES (?, ?, ?, ?, ?)', args: [clientId, clientName, JSON.stringify(body.redirect_uris), JSON.stringify(grantTypes), now + 90 * 86400] });
  return { client_id: clientId, client_id_issued_at: now, client_name: clientName, redirect_uris: body.redirect_uris, token_endpoint_auth_method: 'none', grant_types: grantTypes, response_types: ['code'], scope: CHATGPT_SCOPE };
}

export async function createGrant(db: Client, userId: string, body: Record<string, unknown>, resource: string): Promise<{ redirect_url: string }> {
  const clientId = typeof body.client_id === 'string' ? body.client_id : '';
  const client = await clientInfo(db, clientId);
  if (!client) throw new OAuthError('invalid_client', 'Unknown or expired client.');
  if (!validRedirect(body.redirect_uri) || !client.redirectUris.includes(body.redirect_uri)) throw new OAuthError('invalid_request', 'Callback does not match the registered client.');
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
    if (!row || Number(row.expires_at) <= now || Number(row.grant_expires) <= now || row.client_id !== params.get('client_id') || row.resource !== resource) throw new OAuthError('invalid_grant', 'Invalid or expired credential.');
    if (Number(row.consumed)) {
      // Refresh-token replay revokes its entire connection rather than
      // leaving a stolen, rotated credential family usable.
      if (kind === 'refresh') {
        await tx.execute({ sql: 'DELETE FROM chatgpt_tokens WHERE grant_id = ?', args: [row.grant_id] });
        await tx.execute({ sql: 'DELETE FROM chatgpt_grants WHERE id = ?', args: [row.grant_id] });
        await tx.commit();
      }
      throw new OAuthError('invalid_grant', 'Credential has already been used.');
    }
    if (kind === 'code') {
      const verifier = params.get('code_verifier') || '';
      if (params.get('redirect_uri') !== row.redirect_uri || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || await pkceChallenge(verifier) !== row.challenge) {
        throw new OAuthError('invalid_grant', 'Callback or PKCE verifier does not match.');
      }
    }
    if (kind === 'refresh' && params.has('scope') && normalizeScope(params.get('scope')) !== row.scope) throw new OAuthError('invalid_scope', 'Reconnect to change permissions.');
    const keys = await unseal(String(row.sealed_keys), raw);
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
  try { return { ...await unseal(String(row.sealed_keys), match[1]), userId: String(row.user_id), scope: String(row.scope), grantId: String(row.grant_id) }; }
  catch { return null; }
}

export async function revokeConnections(db: Client, userId: string): Promise<void> {
  await db.batch([
    { sql: 'DELETE FROM chatgpt_tokens WHERE user_id = ?', args: [userId] },
    { sql: 'DELETE FROM chatgpt_grants WHERE user_id = ?', args: [userId] },
  ], 'write');
}
