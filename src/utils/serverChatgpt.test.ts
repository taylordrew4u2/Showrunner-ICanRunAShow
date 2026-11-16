import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import oauth from '../../api/chatgpt';
import mcp from '../../api/mcp';
import { applySchema } from '../../api/_lib/db';
import { ASSISTANT_SCOPES, CHATGPT_SCOPE, exchangeToken, normalizeScope, pkceChallenge, redirectMatches } from '../../api/_lib/chatgptAuth';
import { cipherHash } from '../../api/_lib/showWrites';
import { decryptWithKey } from './encryption';
import type { Show } from '../types';

const connection = vi.hoisted(() => ({ db: null as Client | null }));
vi.mock('../../api/_lib/db', async importOriginal => ({
  ...await importOriginal<typeof import('../../api/_lib/db')>(),
  ensureSchema: async () => {}, getDb: () => connection.db!,
}));
vi.mock('../../api/_lib/auth', () => ({ authorize: async (req: Request) => req.headers.get('x-user-id') }));

const origin = 'https://example.test';
const callback = 'https://chatgpt.com/connector_platform_oauth_redirect';
const verifier = 'v'.repeat(64);
const key = 'a'.repeat(64);
let dir: string;

const run = (sql: string, ...args: (string | number | null)[]) => connection.db!.execute({ sql, args });
const call = (route: string, method = 'GET', body?: unknown, user?: string, headers: Record<string, string> = {}) => oauth(new Request(`${origin}/api/chatgpt?route=${route}`, {
  method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(user ? { 'x-user-id': user } : {}), ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
}));
const tokenRequest = (body: Record<string, string>, headers: Record<string, string> = {}) => oauth(new Request(`${origin}/api/chatgpt?route=token`, {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(body),
}));
const rpc = (token: string | undefined, method: string, params?: unknown, id: number | undefined = 1, headers: Record<string, string> = {}) => mcp(new Request(`${origin}/api/mcp`, {
  method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
  body: JSON.stringify({ jsonrpc: '2.0', ...(id === undefined ? {} : { id }), method, params }),
}));

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'showrunner-chatgpt-'));
  connection.db = createClient({ url: `file:${join(dir, 'test.db')}` });
  await applySchema(connection.db);
  await run("INSERT INTO users (id, password_hash) VALUES ('producer', 'hash'), ('neighbour', 'hash')");
  vi.stubEnv('APP_URL', origin);
});
afterEach(() => { connection.db?.close(); rmSync(dir, { recursive: true, force: true }); vi.unstubAllEnvs(); });

async function register(redirectUris = [callback], clientName = 'ChatGPT') {
  const result = await call('register', 'POST', { client_name: clientName, redirect_uris: redirectUris, token_endpoint_auth_method: 'none' });
  expect(result.status).toBe(201);
  return (await result.json()).client_id as string;
}
async function grant(clientId: string, patch: Record<string, unknown> = {}) {
  return call('grant', 'POST', { client_id: clientId, redirect_uri: callback, response_type: 'code', code_challenge_method: 'S256', code_challenge: await pkceChallenge(verifier), scope: 'shows:read shows:write', state: 'opaque-state', resource: `${origin}/api/mcp`, key, ...patch }, 'producer');
}
/** `null` asks for no scope at all, which JSON then leaves out of the body. */
async function connect(scope: string | null = 'shows:read shows:write', redirectUri = callback, clientName = 'ChatGPT') {
  const clientId = await register([redirectUri], clientName);
  const response = await grant(clientId, { scope: scope ?? undefined, redirect_uri: redirectUri });
  expect(response.status).toBe(200);
  const redirect = new URL((await response.json()).redirect_url);
  const code = redirect.searchParams.get('code')!;
  const params = { grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier, redirect_uri: redirectUri, resource: `${origin}/api/mcp` };
  const tokens = await tokenRequest(params);
  expect(tokens.status).toBe(200);
  return { clientId, code, params, redirect, tokens: await tokens.json() as { access_token: string; refresh_token: string; scope: string } };
}

/** Reseal credentials the way the first seals were made: under the token's
 * bare SHA-256, which is also the hash the database keeps for it. */
async function sealTheFirstWay(...tokens: string[]) {
  const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  for (const token of tokens) {
    const sealKey = await crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)), 'AES-GCM', false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, sealKey, new TextEncoder().encode(JSON.stringify({ key }))));
    await run('UPDATE chatgpt_tokens SET sealed_keys = ? WHERE token_hash = ?', `${b64url(iv)}.${b64url(sealed)}`, await cipherHash(token));
  }
}
const credentialRows = async (token: string) => Number((await run('SELECT COUNT(*) FROM chatgpt_tokens WHERE token_hash = ?', await cipherHash(token))).rows[0][0]);
const grantRows = async () => Number((await run('SELECT COUNT(*) FROM chatgpt_grants')).rows[0][0]);

describe('ChatGPT OAuth', () => {
  it('publishes resource and PKCE discovery without requiring a database or credentials', async () => {
    const meta = await call('metadata');
    expect((await meta.json()).code_challenge_methods_supported).toEqual(['S256']);
    expect((await (await call('resource')).json()).resource).toBe(`${origin}/api/mcp`);
    expect(meta.headers.get('cache-control')).toBe('no-store');
  });

  it.each(['http://chatgpt.com/callback', 'https://evil.test/callback', 'https://chatgpt.com@evil.test/callback', 'https://127.0.0.1/callback', 'https://chatgpt.com/callback#fragment'])(
    'refuses unsafe or unrelated client callback %s', async callbackUri => {
      const response = await call('register', 'POST', { redirect_uris: [callbackUri] });
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe('invalid_redirect_uri');
    },
  );

  it('requires a signed-in owner for delegation and refuses unregistered callbacks and unknown scopes', async () => {
    expect((await call('grant', 'POST', {})).status).toBe(401);
    const clientId = await register();
    expect((await grant(clientId, { redirect_uri: `${callback}/different` })).status).toBe(400);
    expect((await grant(clientId, { scope: 'shows:read settings:read' })).status).toBe(400);
    expect((await grant(clientId, { code_challenge_method: 'plain' })).status).toBe(400);
    expect((await grant(clientId, { resource: 'https://other.test/api/mcp' })).status).toBe(400);
    expect((await grant(clientId, { key: 'raw-password' })).status).toBe(400);
  });

  it('preserves registered grant types and rejects empty metadata', async () => {
    expect((await call('register', 'POST', { redirect_uris: [callback], grant_types: [] })).status).toBe(400);
    expect((await call('register', 'POST', { redirect_uris: [callback], response_types: [] })).status).toBe(400);
    const registration = await (await call('register', 'POST', { redirect_uris: [callback], grant_types: ['authorization_code'] })).json();
    expect(registration.grant_types).toEqual(['authorization_code']);
    const consent = await grant(registration.client_id);
    const code = new URL((await consent.json()).redirect_url).searchParams.get('code')!;
    const tokens = await (await tokenRequest({ grant_type: 'authorization_code', client_id: registration.client_id, code, code_verifier: verifier, redirect_uri: callback })).json();
    expect(tokens.access_token).toBeDefined();
    expect(tokens.refresh_token).toBeUndefined();
  });

  it('returns state unchanged, stores no raw tokens/data keys, and revokes the connection on code replay', async () => {
    const connected = await connect();
    expect(connected.redirect.searchParams.get('state')).toBe('opaque-state');
    const stored = JSON.stringify((await run('SELECT * FROM chatgpt_tokens')).rows);
    for (const secret of [key, connected.code, connected.tokens.access_token, connected.tokens.refresh_token]) expect(stored).not.toContain(secret);
    expect((await rpc(connected.tokens.access_token, 'ping')).status).toBe(200);
    const replayed = await tokenRequest(connected.params);
    expect(replayed.status).toBe(400);
    expect((await replayed.json()).error).toBe('invalid_grant');
    // RFC 6749 section 4.1.2: a code used twice takes everything issued
    // from it with it.
    expect((await rpc(connected.tokens.access_token, 'ping')).status).toBe(401);
    expect((await tokenRequest({ grant_type: 'refresh_token', client_id: connected.clientId, refresh_token: connected.tokens.refresh_token })).status).toBe(400);
    expect(await grantRows()).toBe(0);
    expect((await run('SELECT COUNT(*) FROM chatgpt_tokens')).rows[0][0]).toBe(0);
  });

  it('revokes only the connection whose code was replayed', async () => {
    const replayed = await connect();
    const other = await connect();
    expect((await tokenRequest(replayed.params)).status).toBe(400);
    expect((await rpc(replayed.tokens.access_token, 'ping')).status).toBe(401);
    expect((await rpc(other.tokens.access_token, 'ping')).status).toBe(200);
    expect(await grantRows()).toBe(1);
  });

  it('seals the delegated keys under nothing a copy of the database holds', async () => {
    await connect();
    const rows = (await run("SELECT token_hash, sealed_keys FROM chatgpt_tokens WHERE sealed_keys != ''")).rows;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      // The lookup hash is the token's SHA-256: as an AES key it must open nothing.
      const hash = String(row.token_hash);
      const stolen = await crypto.subtle.importKey('raw', Uint8Array.from(hash.match(/../g)!, byte => parseInt(byte, 16)), 'AES-GCM', false, ['decrypt']);
      const [version, iv, cipher] = String(row.sealed_keys).split('.');
      expect(version).toBe('v2');
      const bytes = (value: string) => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
      await expect(crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(iv) }, stolen, bytes(cipher))).rejects.toThrow();
    }
  });

  it('refuses an access token sealed the first way and removes it, even where nothing else cleans up', async () => {
    const connected = await connect();
    const access = connected.tokens.access_token;
    await sealTheFirstWay(access);
    // /api/mcp runs no clean-up of its own: the refusal itself removes it.
    const refused = await rpc(access, 'ping');
    expect(refused.status).toBe(401);
    expect(await credentialRows(access)).toBe(0);
    expect((await rpc(access, 'ping')).status).toBe(401);
    // Its refresh token is sealed the current way, so the connection stays
    // and carries on with a new access token.
    expect(await grantRows()).toBe(1);
    const rotated = await tokenRequest({ grant_type: 'refresh_token', client_id: connected.clientId, refresh_token: connected.tokens.refresh_token });
    expect(rotated.status).toBe(200);
    expect((await rpc((await rotated.json()).access_token, 'ping')).status).toBe(200);
  });

  it('retires a connection sealed the first way, two-permission grants included, so it has to connect again', async () => {
    const connected = await connect('shows:read shows:write');
    await sealTheFirstWay(connected.tokens.access_token, connected.tokens.refresh_token);
    expect((await rpc(connected.tokens.access_token, 'ping')).status).toBe(401);
    // Nothing sealed the current way was left under it, so the connection
    // went too, used credentials and all, and Settings no longer lists it.
    expect(await grantRows()).toBe(0);
    expect((await run('SELECT COUNT(*) FROM chatgpt_tokens')).rows[0][0]).toBe(0);
    expect((await (await call('connections', 'GET', undefined, 'producer')).json()).connections).toEqual([]);
  });

  it('never refreshes with a refresh token sealed the first way', async () => {
    const connected = await connect();
    const refresh = { grant_type: 'refresh_token', client_id: connected.clientId, refresh_token: connected.tokens.refresh_token };
    await sealTheFirstWay(connected.tokens.access_token, connected.tokens.refresh_token);
    const refused = await tokenRequest(refresh);
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toBe('invalid_grant');
    expect(await credentialRows(connected.tokens.refresh_token)).toBe(0);
    expect(await grantRows()).toBe(0);

    // The token route cleans up before it looks, so exchangeToken is called
    // directly to show it refuses and removes one of its own accord too.
    const other = await connect();
    await sealTheFirstWay(other.tokens.refresh_token);
    await expect(exchangeToken(connection.db!, new URLSearchParams({ ...refresh, client_id: other.clientId, refresh_token: other.tokens.refresh_token }), `${origin}/api/mcp`))
      .rejects.toMatchObject({ code: 'invalid_grant' });
    expect(await credentialRows(other.tokens.refresh_token)).toBe(0);
    // Its access token was still sealed the current way, so it keeps working
    // until it expires, and then the connection has to connect again.
    expect((await rpc(other.tokens.access_token, 'ping')).status).toBe(200);
  });

  it('leaves connections sealed the current way exactly as they were', async () => {
    const current = await connect();
    const retired = await connect();
    await sealTheFirstWay(retired.tokens.access_token, retired.tokens.refresh_token);
    const before = (await run('SELECT * FROM chatgpt_tokens t JOIN chatgpt_grants g ON g.id = t.grant_id WHERE g.client_id = ? ORDER BY t.token_hash', current.clientId)).rows;
    expect(before.length).toBe(3);
    // Any registration, consent or token request runs the clean-up.
    await register();
    expect((await run('SELECT * FROM chatgpt_tokens t JOIN chatgpt_grants g ON g.id = t.grant_id WHERE g.client_id = ? ORDER BY t.token_hash', current.clientId)).rows).toEqual(before);
    expect(await grantRows()).toBe(1);
    expect((await rpc(current.tokens.access_token, 'ping')).status).toBe(200);
    expect((await tokenRequest({ grant_type: 'refresh_token', client_id: current.clientId, refresh_token: current.tokens.refresh_token })).status).toBe(200);
  });

  it('never removes a connection still waiting on its code', async () => {
    const retired = await connect();
    const clientId = await register();
    const consent = await grant(clientId);
    const code = new URL((await consent.json()).redirect_url).searchParams.get('code')!;
    await sealTheFirstWay(retired.tokens.access_token, retired.tokens.refresh_token);
    // The clean-up runs while the producer is between Allow access and the
    // assistant redeeming the code.
    await register();
    expect(await credentialRows(retired.tokens.refresh_token)).toBe(0);
    expect((await run('SELECT activated FROM chatgpt_grants')).rows.map(row => Number(row[0]))).toEqual([0]);
    expect(await credentialRows(code)).toBe(1);
    const tokens = await tokenRequest({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier, redirect_uri: callback, resource: `${origin}/api/mcp` });
    expect(tokens.status).toBe(200);
    expect((await rpc((await tokens.json()).access_token, 'ping')).status).toBe(200);
  });

  it('refuses a credential whose sealed keys do not open, without a server error', async () => {
    const connected = await connect();
    await run("UPDATE chatgpt_tokens SET sealed_keys = 'v2.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA' WHERE kind = 'refresh'");
    const refused = await tokenRequest({ grant_type: 'refresh_token', client_id: connected.clientId, refresh_token: connected.tokens.refresh_token });
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toBe('invalid_grant');
  });

  it('checks PKCE, client id, redirect and resource without consuming a valid code', async () => {
    const clientId = await register();
    const response = await grant(clientId);
    const code = new URL((await response.json()).redirect_url).searchParams.get('code')!;
    const params = { grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier, redirect_uri: callback, resource: `${origin}/api/mcp` };
    for (const invalid of [{ code_verifier: 'w'.repeat(64) }, { client_id: 'other' }, { redirect_uri: `${callback}/other` }, { resource: 'https://other.test/api/mcp' }]) {
      expect((await tokenRequest({ ...params, ...invalid })).status).toBe(400);
    }
    expect((await tokenRequest(params)).status).toBe(200);
  });

  it('rotates refresh tokens, invalidates old access, and revokes the family on refresh replay', async () => {
    const connected = await connect();
    const refresh = { grant_type: 'refresh_token', client_id: connected.clientId, refresh_token: connected.tokens.refresh_token, resource: `${origin}/api/mcp` };
    const rotated = await tokenRequest(refresh);
    expect(rotated.status).toBe(200);
    const next = await rotated.json();
    expect(next.refresh_token).not.toBe(refresh.refresh_token);
    expect((await rpc(connected.tokens.access_token, 'ping')).status).toBe(401);
    expect((await rpc(next.access_token, 'ping')).status).toBe(200);
    expect((await tokenRequest(refresh)).status).toBe(400);
    expect((await rpc(next.access_token, 'ping')).status).toBe(401);
  });

  it('lists connection metadata only for its owner and owner revocation invalidates both token types', async () => {
    const connected = await connect();
    expect((await call('connections')).status).toBe(401);
    expect((await (await call('connections', 'GET', undefined, 'neighbour')).json()).connections).toEqual([]);
    const owner = await (await call('connections', 'GET', undefined, 'producer')).json();
    expect(owner.connections).toHaveLength(1);
    expect(JSON.stringify(owner)).not.toContain(key);
    expect((await call('connections', 'DELETE', undefined, 'neighbour')).status).toBe(200);
    expect((await rpc(connected.tokens.access_token, 'ping')).status).toBe(200);
    await call('connections', 'DELETE', undefined, 'producer');
    expect((await rpc(connected.tokens.access_token, 'ping')).status).toBe(401);
    expect((await tokenRequest({ grant_type: 'refresh_token', client_id: connected.clientId, refresh_token: connected.tokens.refresh_token })).status).toBe(400);
  });

  it('keeps a client registered for as long as any grant made under it', async () => {
    const clientId = await register();
    await run('UPDATE chatgpt_clients SET expires_at = ? WHERE client_id = ?', Math.floor(Date.now() / 1000) + 60, clientId);
    expect((await grant(clientId)).status).toBe(200);
    const row = (await run('SELECT c.expires_at >= g.expires_at FROM chatgpt_clients c JOIN chatgpt_grants g ON g.client_id = c.client_id WHERE c.client_id = ?', clientId)).rows[0];
    expect(Number(row[0])).toBe(1);
  });

  describe('a registered client still in use', () => {
    const DAY = 86400;
    const start = new Date('2026-11-16T12:00:00Z');
    const at = (days: number) => Math.floor(start.getTime() / 1000) + days * DAY;
    const clientExpiry = async (clientId: string) => Number((await run('SELECT expires_at FROM chatgpt_clients WHERE client_id = ?', clientId)).rows[0]?.[0] ?? 0);
    const clientRows = async (clientId: string) => Number((await run('SELECT COUNT(*) FROM chatgpt_clients WHERE client_id = ?', clientId)).rows[0][0]);
    beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'], now: start }); });
    afterEach(() => { vi.useRealTimers(); });

    it('is kept for 90 days from each refresh, so a shared registration never lapses under its connections', async () => {
      const connected = await connect();
      expect(await clientExpiry(connected.clientId)).toBe(at(90));
      const grantExpiry = Number((await run('SELECT expires_at FROM chatgpt_grants')).rows[0][0]);
      const bystander = await register();

      vi.setSystemTime(new Date(start.getTime() + 20 * DAY * 1000));
      const refreshed = await tokenRequest({ grant_type: 'refresh_token', client_id: connected.clientId, refresh_token: connected.tokens.refresh_token, resource: `${origin}/api/mcp` });
      expect(refreshed.status).toBe(200);
      expect(await clientExpiry(connected.clientId)).toBe(at(110));
      // Nothing else moves: not the connection, its new refresh token, or another client.
      expect(Number((await run('SELECT expires_at FROM chatgpt_grants')).rows[0][0])).toBe(grantExpiry);
      const next = await refreshed.json() as { refresh_token: string };
      expect(Number((await run('SELECT expires_at FROM chatgpt_tokens WHERE token_hash = ?', await cipherHash(next.refresh_token))).rows[0][0])).toBe(grantExpiry);
      expect(await clientExpiry(bystander)).toBe(at(90));

      // Past the first 90 days, the client the refresh kept still connects people.
      vi.setSystemTime(new Date(start.getTime() + 100 * DAY * 1000));
      expect((await grant(connected.clientId)).status).toBe(200);
      expect(await clientRows(bystander)).toBe(0);
    });

    it('is never shortened, and a refused exchange keeps nothing alive', async () => {
      const connected = await connect();
      await run('UPDATE chatgpt_clients SET expires_at = ? WHERE client_id = ?', at(400), connected.clientId);
      const refresh = { grant_type: 'refresh_token', client_id: connected.clientId, refresh_token: connected.tokens.refresh_token, resource: `${origin}/api/mcp` };
      const rotated = await tokenRequest(refresh);
      expect(rotated.status).toBe(200);
      expect(await clientExpiry(connected.clientId)).toBe(at(400));

      await run('UPDATE chatgpt_clients SET expires_at = ? WHERE client_id = ?', at(5), connected.clientId);
      vi.setSystemTime(new Date(start.getTime() + 2 * DAY * 1000));
      const next = await rotated.json() as { refresh_token: string };
      expect((await tokenRequest({ ...refresh, refresh_token: next.refresh_token, client_id: 'someone-else' })).status).toBe(400);
      expect(await clientExpiry(connected.clientId)).toBe(at(5));
    });

    it('still expires once nobody has used it for 90 days', async () => {
      const idle = await register();
      const used = await connect();
      vi.setSystemTime(new Date(start.getTime() + 89 * DAY * 1000));
      expect((await call(`client&client_id=${idle}`)).status).toBe(200);
      vi.setSystemTime(new Date(start.getTime() + 90 * DAY * 1000 + 1000));
      expect((await call(`client&client_id=${idle}`)).status).toBe(404);
      expect((await grant(used.clientId)).status).toBe(400);
      // The clean-up on every registration, consent and token request removes them.
      await register();
      expect(await clientRows(idle)).toBe(0);
      expect(await clientRows(used.clientId)).toBe(0);
    });
  });

  it('enforces expiration and binds tokens to the app resource audience', async () => {
    const connected = await connect();
    await run('UPDATE chatgpt_grants SET resource = ?', 'https://other.test/api/mcp');
    expect((await rpc(connected.tokens.access_token, 'ping')).status).toBe(401);
    await run('UPDATE chatgpt_grants SET resource = ?', `${origin}/api/mcp`);
    await run("UPDATE chatgpt_tokens SET expires_at = 1 WHERE kind = 'access'");
    expect((await rpc(connected.tokens.access_token, 'ping')).status).toBe(401);
  });

  it('rejects foreign browser origins and malformed/duplicate token parameters', async () => {
    expect((await call('register', 'POST', {}, undefined, { origin: 'https://evil.test' })).status).toBe(403);
    expect((await call('grant', 'POST', {}, 'producer', { origin: 'https://chatgpt.com' })).status).toBe(403);
    const duplicate = await oauth(new Request(`${origin}/api/chatgpt?route=token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=authorization_code&grant_type=refresh_token' }));
    expect(duplicate.status).toBe(400);
    expect((await call('token', 'POST', {})).status).toBe(400);
  });
});

describe('AI assistant OAuth for Claude and ChatGPT', () => {
  const claude = 'https://claude.ai/api/mcp/auth_callback';

  it.each([claude, 'https://claude.com/api/mcp/auth_callback', 'http://127.0.0.1:43117/callback', 'http://localhost:3118/callback', 'http://localhost/callback', callback, 'https://chatgpt.com/connector/oauth/6mt_L_yi2KyC'])(
    'registers the assistant callback %s', async callbackUri => {
      expect((await call('register', 'POST', { redirect_uris: [callbackUri] })).status).toBe(201);
    },
  );

  it.each([
    'https://claude.ai.evil.com/api/mcp/auth_callback', 'http://claude.ai/api/mcp/auth_callback', 'https://claude.ai/api/mcp/other',
    'https://claude.ai/api/mcp/auth_callback?next=https://evil.test', 'https://claude.ai/api/mcp/auth_callback#', 'https://claude.ai:8443/api/mcp/auth_callback',
    'https://evil.claude.ai/api/mcp/auth_callback', 'http://127.0.0.1:43117/callback#code', 'http://localhost:3118/callback#', 'http://localhost.evil.test/callback',
    'http://127.0.0.1.evil.test/callback', 'http://user@localhost:3118/callback', 'http://192.168.1.10/callback', 'http://evil.test/callback', 'http://chatgpt.com/callback',
    // Any chatgpt.com page but ChatGPT's own callbacks could leak a code to whoever started the flow.
    'https://chatgpt.com/callback', 'https://chatgpt.com/share/abc', `${callback}?next=https://evil.test`, `${callback}/more`,
    'https://chatgpt.com/connector/oauth/', 'https://chatgpt.com/connector/oauth/id/more', 'https://chatgpt.com/connector%2Foauth%2Fid', 'https://chatgpt.com/connector/oauth/../../g/evil',
  ])('refuses the lookalike callback %s', async callbackUri => {
    const response = await call('register', 'POST', { redirect_uris: [callbackUri] });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('invalid_redirect_uri');
  });

  it('names a client after its callback when it registers no name', async () => {
    const named = async (uri: string) => (await (await call('register', 'POST', { redirect_uris: [uri] })).json()).client_name;
    expect(await named(claude)).toBe('Claude');
    expect(await named(callback)).toBe('ChatGPT');
    expect(await named('http://127.0.0.1:9000/callback')).toBe('An app on this computer');
  });

  it('completes a Claude connection and lists the client by its registered name', async () => {
    const { tokens } = await connect('shows:read shows:write', claude, 'Claude');
    expect((await rpc(tokens.access_token, 'ping')).status).toBe(200);
    const owner = await (await call('connections', 'GET', undefined, 'producer')).json();
    expect(owner.connections).toMatchObject([{ clientName: 'Claude', scope: 'shows:read shows:write' }]);
  });

  it('lets a loopback client come back on any port to the same host and path, still with PKCE S256', async () => {
    const clientId = await register(['http://127.0.0.1/callback'], 'Claude Code');
    const port = 'http://127.0.0.1:51234/callback';
    expect((await grant(clientId, { redirect_uri: port, code_challenge_method: 'plain' })).status).toBe(400);
    expect((await grant(clientId, { redirect_uri: port, code_challenge: undefined })).status).toBe(400);
    expect((await grant(clientId, { redirect_uri: 'http://localhost:51234/callback' })).status).toBe(400);
    expect((await grant(clientId, { redirect_uri: 'http://127.0.0.1:51234/other' })).status).toBe(400);
    const consent = await grant(clientId, { redirect_uri: port });
    expect(consent.status).toBe(200);
    const redirect = new URL((await consent.json()).redirect_url);
    expect(redirect.origin).toBe('http://127.0.0.1:51234');
    const params = { grant_type: 'authorization_code', client_id: clientId, code: redirect.searchParams.get('code')!, code_verifier: verifier, redirect_uri: port, resource: `${origin}/api/mcp` };
    expect((await tokenRequest({ ...params, code_verifier: 'w'.repeat(64) })).status).toBe(400);
    expect((await tokenRequest({ ...params, redirect_uri: 'http://127.0.0.1:51235/callback' })).status).toBe(400);
    expect((await tokenRequest(params)).status).toBe(200);
  });

  it('matches loopback callbacks without the port, and every other callback exactly', () => {
    expect(redirectMatches(['http://localhost:3118/callback'], 'http://localhost:4000/callback')).toBe(true);
    expect(redirectMatches(['http://localhost/callback'], 'http://127.0.0.1:4000/callback')).toBe(false);
    expect(redirectMatches(['http://localhost/callback?a=1'], 'http://localhost:4000/callback?a=2')).toBe(false);
    expect(redirectMatches([claude], 'https://claude.com/api/mcp/auth_callback')).toBe(false);
    expect(redirectMatches([callback], `${callback}/more`)).toBe(false);
  });

  it('accepts any permission set that includes shows:read, in one canonical order', () => {
    expect(ASSISTANT_SCOPES).toEqual(['shows:read', 'shows:write', 'shows:delete', 'rolodex:read', 'rolodex:write', 'contracts:read', 'links:send']);
    expect(CHATGPT_SCOPE).toBe(ASSISTANT_SCOPES.join(' '));
    expect(normalizeScope(undefined)).toBe(CHATGPT_SCOPE);
    expect(normalizeScope('')).toBe(CHATGPT_SCOPE);
    expect(normalizeScope('links:send shows:read shows:read')).toBe('shows:read links:send');
    expect(normalizeScope('shows:write shows:read')).toBe('shows:read shows:write');
    // Editing the Rolodex brings seeing it.
    expect(normalizeScope('shows:read rolodex:write')).toBe('shows:read rolodex:read rolodex:write');
    expect(normalizeScope('rolodex:write shows:read rolodex:read')).toBe('shows:read rolodex:read rolodex:write');
    expect(normalizeScope('shows:read rolodex:read')).toBe('shows:read rolodex:read');
    for (const invalid of ['shows:write', 'shows:read offline_access', 'shows:read shows:admin', 'SHOWS:READ']) {
      expect(() => normalizeScope(invalid)).toThrow();
    }
  });

  it('grants every permission when none is requested, and exactly the ticked subset otherwise', async () => {
    const everything = await connect(null, claude, 'Claude');
    expect(everything.tokens.scope).toBe(ASSISTANT_SCOPES.join(' '));
    const subset = await connect('shows:read rolodex:read links:send', claude, 'Claude');
    expect(subset.tokens.scope).toBe('shows:read rolodex:read links:send');
    const listed = (await (await call('connections', 'GET', undefined, 'producer')).json()).connections.map((c: { scope: string }) => c.scope);
    expect(listed.sort()).toEqual([ASSISTANT_SCOPES.join(' '), 'shows:read rolodex:read links:send'].sort());
    const clientId = await register([claude], 'Claude');
    const refused = await grant(clientId, { redirect_uri: claude, scope: 'shows:read contacts:export' });
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toBe('invalid_scope');
  });

  it('keeps a two-permission grant made before the wider set working as exactly that', async () => {
    const connected = await connect('shows:read shows:write');
    expect(connected.tokens.scope).toBe('shows:read shows:write');
    const refreshed = await tokenRequest({ grant_type: 'refresh_token', client_id: connected.clientId, refresh_token: connected.tokens.refresh_token });
    expect((await refreshed.json()).scope).toBe('shows:read shows:write');
  });

  it('grants seeing the Rolodex with editing it, and refreshes a grant stored before that as exactly what it was', async () => {
    const connected = await connect('shows:read rolodex:write', claude, 'Claude');
    expect(connected.tokens.scope).toBe('shows:read rolodex:read rolodex:write');
    const tools = (await (await rpc(connected.tokens.access_token, 'tools/list')).json()).result.tools.map((t: { name: string }) => t.name);
    expect(tools).toEqual(expect.arrayContaining(['list_rolodex', 'get_comic', 'add_comic', 'update_comic']));
    const refresh = { grant_type: 'refresh_token', client_id: connected.clientId, refresh_token: connected.tokens.refresh_token, scope: 'shows:read rolodex:write' };
    const same = await tokenRequest(refresh);
    expect(same.status).toBe(200);
    const next = await same.json();
    expect(next.scope).toBe('shows:read rolodex:read rolodex:write');

    // A grant stored with editing alone, before editing brought seeing, can
    // still name its own set on a refresh, and gets nothing more.
    await run('UPDATE chatgpt_grants SET scope = ?', 'shows:read rolodex:write');
    const older = await tokenRequest({ ...refresh, refresh_token: next.refresh_token });
    expect(older.status).toBe(200);
    const after = await older.json();
    expect(after.scope).toBe('shows:read rolodex:write');
    const widened = await tokenRequest({ ...refresh, refresh_token: after.refresh_token, scope: 'shows:read shows:write rolodex:read rolodex:write' });
    expect(widened.status).toBe(400);
    expect((await widened.json()).error).toBe('invalid_scope');
  });

  it('never widens a grant on refresh', async () => {
    const connected = await connect('shows:read rolodex:read', claude, 'Claude');
    const refresh = { grant_type: 'refresh_token', client_id: connected.clientId, refresh_token: connected.tokens.refresh_token, resource: `${origin}/api/mcp` };
    for (const scope of ['shows:read rolodex:read shows:delete', CHATGPT_SCOPE, 'shows:read rolodex:read unknown:scope']) {
      const widened = await tokenRequest({ ...refresh, scope });
      expect(widened.status).toBe(400);
      expect((await widened.json()).error).toBe('invalid_scope');
    }
    expect((await (await call('connections', 'GET', undefined, 'producer')).json()).connections[0].scope).toBe('shows:read rolodex:read');
    // The refused attempts used nothing up: the same refresh token still
    // works, naming the same permissions in another order or none at all.
    const same = await tokenRequest({ ...refresh, scope: 'rolodex:read shows:read' });
    expect(same.status).toBe(200);
    const next = await same.json();
    expect(next.scope).toBe('shows:read rolodex:read');
    const omitted = await tokenRequest({ ...refresh, refresh_token: next.refresh_token, scope: '' });
    expect((await omitted.json()).scope).toBe('shows:read rolodex:read');
  });

  it('disconnects one connection with all its tokens and leaves the others working', async () => {
    const chatgpt = await connect('shows:read shows:write');
    const claudeConnection = await connect(null, claude, 'Claude');
    const listed = (await (await call('connections', 'GET', undefined, 'producer')).json()).connections as { id: string; clientName: string }[];
    const claudeId = listed.find(c => c.clientName === 'Claude')!.id;

    // Another account naming the grant revokes nothing.
    expect((await call(`connections&id=${encodeURIComponent(claudeId)}`, 'DELETE', undefined, 'neighbour')).status).toBe(200);
    expect((await rpc(claudeConnection.tokens.access_token, 'ping')).status).toBe(200);
    // An empty or repeated id is refused instead of being read as "all".
    expect((await call('connections&id=', 'DELETE', undefined, 'producer')).status).toBe(400);
    expect((await call(`connections&id=${claudeId}&id=other`, 'DELETE', undefined, 'producer')).status).toBe(400);
    expect((await call(`connections&id=${claudeId}`, 'DELETE')).status).toBe(401);
    expect((await rpc(chatgpt.tokens.access_token, 'ping')).status).toBe(200);
    expect((await rpc(claudeConnection.tokens.access_token, 'ping')).status).toBe(200);

    expect((await call(`connections&id=${encodeURIComponent(claudeId)}`, 'DELETE', undefined, 'producer')).status).toBe(200);
    expect((await rpc(claudeConnection.tokens.access_token, 'ping')).status).toBe(401);
    expect((await tokenRequest({ grant_type: 'refresh_token', client_id: claudeConnection.clientId, refresh_token: claudeConnection.tokens.refresh_token })).status).toBe(400);
    expect((await run('SELECT COUNT(*) FROM chatgpt_tokens WHERE grant_id = ?', claudeId)).rows[0][0]).toBe(0);
    expect((await run('SELECT COUNT(*) FROM chatgpt_grants WHERE id = ?', claudeId)).rows[0][0]).toBe(0);

    expect((await rpc(chatgpt.tokens.access_token, 'ping')).status).toBe(200);
    expect((await (await call('connections', 'GET', undefined, 'producer')).json()).connections).toMatchObject([{ clientName: 'ChatGPT' }]);
  });

  it('advertises every permission in discovery and registration', async () => {
    expect((await (await call('metadata')).json()).scopes_supported).toEqual([...ASSISTANT_SCOPES]);
    expect((await (await call('resource')).json()).scopes_supported).toEqual([...ASSISTANT_SCOPES]);
    expect((await (await call('register', 'POST', { redirect_uris: [claude] })).json()).scope).toBe(ASSISTANT_SCOPES.join(' '));
  });

  it("allows Claude's web origins on the public routes but still not on the owner-only ones", async () => {
    for (const browser of ['https://claude.ai', 'https://claude.com']) {
      const registered = await call('register', 'POST', { redirect_uris: [claude] }, undefined, { origin: browser });
      expect(registered.status).toBe(201);
      expect(registered.headers.get('access-control-allow-origin')).toBe(browser);
      expect((await call('connections', 'GET', undefined, 'producer', { origin: browser })).status).toBe(403);
      expect((await call('grant', 'POST', {}, 'producer', { origin: browser })).status).toBe(403);
    }
    expect((await call('register', 'POST', { redirect_uris: [claude] }, undefined, { origin: 'https://claude.ai.evil.test' })).status).toBe(403);
  });

  it("allows OpenAI's plugin portal to connect and scan from the browser, but not on the owner-only routes", async () => {
    const portal = 'https://platform.openai.com';
    const registered = await call('register', 'POST', { redirect_uris: [callback] }, undefined, { origin: portal });
    expect(registered.status).toBe(201);
    expect(registered.headers.get('access-control-allow-origin')).toBe(portal);
    expect((await call('metadata', 'GET', undefined, undefined, { origin: portal })).headers.get('access-control-allow-origin')).toBe(portal);
    const { tokens } = await connect();
    const listed = await rpc(tokens.access_token, 'tools/list', {}, 1, { origin: portal });
    expect(listed.status).toBe(200);
    expect(listed.headers.get('access-control-allow-origin')).toBe(portal);
    expect((await mcp(new Request(`${origin}/api/mcp`, { method: 'OPTIONS', headers: { origin: portal } }))).status).toBe(204);
    expect((await call('connections', 'GET', undefined, 'producer', { origin: portal })).status).toBe(403);
    expect((await call('grant', 'POST', {}, 'producer', { origin: portal })).status).toBe(403);
    for (const lookalike of ['https://platform.openai.com.evil.test', 'http://platform.openai.com', 'https://openai.com']) {
      expect((await rpc(tokens.access_token, 'ping', {}, 1, { origin: lookalike })).status, lookalike).toBe(403);
    }
  });
});

describe('ChatGPT MCP transport', () => {
  it('advertises OAuth on unauthorized requests, validates origins and initializes stateless JSON transport', async () => {
    const unauthorized = await rpc(undefined, 'initialize');
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get('www-authenticate')).toContain('/.well-known/oauth-protected-resource');
    const { tokens } = await connect();
    expect((await rpc(tokens.access_token, 'ping', {}, 1, { origin: 'https://evil.test' })).status).toBe(403);
    const initialized = await (await rpc(tokens.access_token, 'initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 'test', version: '1' } })).json();
    expect(initialized.result.capabilities.tools).toBeDefined();
    expect(initialized.result.protocolVersion).toBe('2025-06-18');
    expect((await mcp(new Request(`${origin}/api/mcp`, { method: 'GET', headers: { authorization: `Bearer ${tokens.access_token}` } }))).status).toBe(405);
    const notification = new Request(`${origin}/api/mcp`, { method: 'POST', headers: { authorization: `Bearer ${tokens.access_token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
    expect((await mcp(notification)).status).toBe(202);
  });

  it('lists only permitted tools and rejects a write through a read-only token', async () => {
    const { tokens } = await connect('shows:read');
    const list = await (await rpc(tokens.access_token, 'tools/list')).json();
    expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual(['list_shows', 'get_show', 'search', 'fetch']);
    const write = await (await rpc(tokens.access_token, 'tools/call', { name: 'create_show', arguments: { name: 'Forbidden' } })).json();
    expect(write.result.isError).toBe(true);
    expect((await run('SELECT * FROM user_shows')).rows).toHaveLength(0);
  });

  it('creates and updates real encrypted shows using revisions and isolates the other account', async () => {
    const { tokens } = await connect();
    const created = await (await rpc(tokens.access_token, 'tools/call', { name: 'create_show', arguments: { name: 'ChatGPT Night', date: '2026-12-10', time: '19:30' } })).json();
    expect(created.result.isError).toBeUndefined();
    const result = created.result.structuredContent;
    expect(result.show.name).toBe('ChatGPT Night');
    const cipher = String((await run('SELECT encrypted_data FROM user_shows')).rows[0][0]);
    expect(cipher).not.toContain('ChatGPT Night');
    expect(decryptWithKey<Show>(cipher, key).name).toBe('ChatGPT Night');
    const changed = await (await rpc(tokens.access_token, 'tools/call', { name: 'update_show', arguments: { id: result.show.id, expected_revision: result.revision, patch: { venueName: 'The Room' } } })).json();
    expect(changed.result.structuredContent.show.venueName).toBe('The Room');
    const stale = await (await rpc(tokens.access_token, 'tools/call', { name: 'update_show', arguments: { id: result.show.id, expected_revision: result.revision, patch: { name: 'Stale overwrite' } } })).json();
    expect(stale.result.isError).toBe(true);
    await run('UPDATE user_shows SET user_id = ?', 'neighbour');
    const read = await (await rpc(tokens.access_token, 'tools/call', { name: 'get_show', arguments: { id: result.show.id } })).json();
    expect(read.result.isError).toBe(true);
    expect(JSON.stringify(read)).not.toContain('ChatGPT Night');
  });

  it('refuses incompatible transport and unsupported protocol versions', async () => {
    const { tokens } = await connect();
    expect((await rpc(tokens.access_token, 'ping', {}, 1, { accept: 'application/json' })).status).toBe(406);
    expect((await rpc(tokens.access_token, 'ping', {}, 1, { 'mcp-protocol-version': '1900-01-01' })).status).toBe(400);
    expect((await (await rpc(tokens.access_token, 'does/not/exist')).json()).error.code).toBe(-32601);
  });
});
