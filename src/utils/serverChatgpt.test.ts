import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import oauth from '../../api/chatgpt';
import mcp from '../../api/mcp';
import { applySchema } from '../../api/_lib/db';
import { pkceChallenge } from '../../api/_lib/chatgptAuth';
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

async function register() {
  const result = await call('register', 'POST', { client_name: 'ChatGPT', redirect_uris: [callback], token_endpoint_auth_method: 'none' });
  expect(result.status).toBe(201);
  return (await result.json()).client_id as string;
}
async function grant(clientId: string, patch: Record<string, unknown> = {}) {
  return call('grant', 'POST', { client_id: clientId, redirect_uri: callback, response_type: 'code', code_challenge_method: 'S256', code_challenge: await pkceChallenge(verifier), scope: 'shows:read shows:write', state: 'opaque-state', resource: `${origin}/api/mcp`, key, ...patch }, 'producer');
}
async function connect(scope = 'shows:read shows:write') {
  const clientId = await register();
  const response = await grant(clientId, { scope });
  expect(response.status).toBe(200);
  const redirect = new URL((await response.json()).redirect_url);
  const code = redirect.searchParams.get('code')!;
  const params = { grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier, redirect_uri: callback, resource: `${origin}/api/mcp` };
  const tokens = await tokenRequest(params);
  expect(tokens.status).toBe(200);
  return { clientId, code, params, redirect, tokens: await tokens.json() as { access_token: string; refresh_token: string; scope: string } };
}

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

  it('returns state unchanged, stores no raw tokens/data keys and disallows code replay', async () => {
    const connected = await connect();
    expect(connected.redirect.searchParams.get('state')).toBe('opaque-state');
    const stored = JSON.stringify((await run('SELECT * FROM chatgpt_tokens')).rows);
    for (const secret of [key, connected.code, connected.tokens.access_token, connected.tokens.refresh_token]) expect(stored).not.toContain(secret);
    expect((await tokenRequest(connected.params)).status).toBe(400);
    expect((await rpc(connected.tokens.access_token, 'ping')).status).toBe(200);
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
    expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual(['list_shows', 'get_show']);
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
