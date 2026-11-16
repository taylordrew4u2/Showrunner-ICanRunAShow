import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import oauth from '../../api/chatgpt';
import mcp from '../../api/mcp';
import { applySchema } from '../../api/_lib/db';
import { ASSISTANT_SCOPES, pkceChallenge } from '../../api/_lib/chatgptAuth';
import { ASSISTANT_TOOLS, TOOL_SCOPES } from '../../api/_lib/assistantTools';
import { DEFAULT_SETTINGS, type Show } from '../types';
import { decryptWithKey, encryptWithKey } from './encryption';

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
const ALL = 'shows:read shows:write shows:delete rolodex:read rolodex:write contracts:read links:send';
let dir: string;

const run = (sql: string, ...args: (string | number | null)[]) => connection.db!.execute({ sql, args });
const oauthCall = (route: string, body: unknown, user?: string) => oauth(new Request(`${origin}/api/chatgpt?route=${route}`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...(user ? { 'x-user-id': user } : {}) }, body: JSON.stringify(body),
}));
const rpc = (token: string | undefined, method: string, params?: unknown) => mcp(new Request(`${origin}/api/mcp`, {
  method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
}));
const tool = async (token: string, name: string, args: unknown) => (await (await rpc(token, 'tools/call', { name, arguments: args })).json()).result as {
  isError?: boolean; content: { type: string; text: string }[]; structuredContent?: Record<string, unknown>;
};
const listed = async (token: string) => ((await (await rpc(token, 'tools/list')).json()).result.tools as { name: string }[]).map(t => t.name);

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'assistant-mcp-'));
  connection.db = createClient({ url: `file:${join(dir, 'test.db')}` });
  await applySchema(connection.db);
  await run("INSERT INTO users (id, password_hash) VALUES ('producer', 'hash')");
  vi.stubEnv('APP_URL', origin);
});
afterEach(() => { connection.db?.close(); rmSync(dir, { recursive: true, force: true }); vi.unstubAllEnvs(); });

/**
 * A connected assistant, given whichever permissions the producer allowed.
 * The grant's scope column is what every call reads, so it is set directly:
 * which scopes consent may grant is the authorization server's business.
 */
async function connect(scope: string): Promise<string> {
  const clientId = (await (await oauthCall('register', { client_name: 'Claude', redirect_uris: [callback], token_endpoint_auth_method: 'none' })).json()).client_id as string;
  const granted = await oauthCall('grant', { client_id: clientId, redirect_uri: callback, response_type: 'code', code_challenge_method: 'S256', code_challenge: await pkceChallenge(verifier), scope: 'shows:read', resource: `${origin}/api/mcp`, key }, 'producer');
  const code = new URL((await granted.json()).redirect_url).searchParams.get('code')!;
  const tokens = await oauth(new Request(`${origin}/api/chatgpt?route=token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier, redirect_uri: callback, resource: `${origin}/api/mcp` }),
  }));
  await run('UPDATE chatgpt_grants SET scope = ?', scope);
  return (await tokens.json()).access_token as string;
}

const show: Show = {
  id: 'friday', name: 'Friday Comedy', date: '2026-12-04', time: '20:00', venueName: 'The Cellar', location: 'Chicago', status: 'upcoming',
  performers: [{ id: 'p-sam', name: 'Sam Okafor' }], artists: [], schedule: [], hosts: [], djSongs: [], staff: [], vendors: [], expenses: [],
  createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z',
};
async function seed() {
  await run('INSERT INTO user_shows (id, user_id, encrypted_data) VALUES (?, ?, ?)', show.id, 'producer', encryptWithKey(show, key));
  await run('INSERT INTO user_settings (user_id, encrypted_data) VALUES (?, ?)', 'producer', encryptWithKey({ ...DEFAULT_SETTINGS, onboarded: true, potentialComics: [{ id: 'c-sam', name: 'Sam Okafor' }] }, key));
}

it('labels every tool for the client: title, description and all four hints, with deletes and sends marked', () => {
  const names = ASSISTANT_TOOLS.map(t => t.definition.name);
  expect(new Set(names).size).toBe(names.length);
  for (const { definition, scope } of ASSISTANT_TOOLS) {
    expect(definition.title, definition.name).toBeTruthy();
    expect(definition.description.length, definition.name).toBeGreaterThan(40);
    expect(Object.keys(definition.annotations).sort(), definition.name).toEqual(['destructiveHint', 'idempotentHint', 'openWorldHint', 'readOnlyHint', 'title']);
    // Older clients read the title only from the annotations.
    expect(definition.annotations.title, definition.name).toBe(definition.title);
    expect(definition.annotations.readOnlyHint, definition.name).toBe(scope.endsWith(':read'));
  }
  const hints = (name: string) => ASSISTANT_TOOLS.find(t => t.definition.name === name)!.definition.annotations;
  for (const name of ['delete_show', 'remove_performer', 'remove_cue', 'remove_staff', 'remove_vendor', 'send_profile_link', 'send_contract']) expect(hints(name).destructiveHint, name).toBe(true);
  // A move or a mark overwrites what was there: only a purely additive write is not destructive.
  for (const name of ['move_performer', 'move_cue', 'set_surprise_guest']) expect(hints(name).destructiveHint, name).toBe(true);
  for (const name of ['create_show', 'duplicate_show', 'add_performer', 'add_cue', 'add_staff', 'add_vendor', 'add_comic']) expect(hints(name).destructiveHint, name).toBe(false);
  for (const name of ['send_profile_link', 'send_contract']) expect(hints(name).openWorldHint, name).toBe(true);
  expect(ASSISTANT_TOOLS.filter(t => t.definition.annotations.openWorldHint).map(t => t.definition.name)).toEqual(['send_profile_link', 'send_contract']);
  expect(ASSISTANT_TOOLS.find(t => t.definition.name === 'delete_show')!.scope).toBe('shows:delete');
});

it.each([
  ['shows:read', ['list_shows', 'get_show', 'search', 'fetch']],
  ['shows:read rolodex:read', ['list_shows', 'get_show', 'search', 'fetch', 'list_rolodex', 'get_comic']],
  ['shows:read contracts:read links:send', ['list_shows', 'get_show', 'search', 'fetch', 'list_contracts', 'list_signature_requests', 'send_profile_link', 'send_contract']],
  ['shows:read shows:delete', ['list_shows', 'get_show', 'search', 'fetch', 'delete_show']],
  ['rolodex:read rolodex:write', []],
])('lists only the tools a connection with %s may use', async (scope, expected) => {
  expect(await listed(await connect(scope))).toEqual(expected);
});

it('lists every tool for a connection given everything', async () => {
  expect(await listed(await connect(ALL))).toEqual(ASSISTANT_TOOLS.map(t => t.definition.name));
});

it('sends each tool’s title in its annotations too, for clients that read it only there', async () => {
  const tools = (await (await rpc(await connect(ALL), 'tools/list')).json()).result.tools as { name: string; title: string; annotations: { title?: string } }[];
  expect(tools).toHaveLength(ASSISTANT_TOOLS.length);
  for (const listedTool of tools) {
    expect(listedTool.title, listedTool.name).toBe(ASSISTANT_TOOLS.find(t => t.definition.name === listedTool.name)!.definition.title);
    expect(listedTool.annotations.title, listedTool.name).toBe(listedTool.title);
  }
});

it('checks each call against the grant as it stands, not against the list the client was shown', async () => {
  await seed();
  const token = await connect(ALL);
  const revision = (await tool(token, 'get_show', { id: 'friday' })).structuredContent!.revision as string;
  await run('UPDATE chatgpt_grants SET scope = ?', 'shows:read shows:write');
  const refused = await tool(token, 'delete_show', { id: 'friday', expected_revision: revision, confirm: true });
  expect(refused).toMatchObject({ isError: true, content: [{ type: 'text', text: 'This connection needs shows:delete permission.' }] });
  expect((await tool(token, 'list_rolodex', {})).isError).toBe(true);
  expect((await tool(token, 'send_profile_link', { comic_id: 'c-sam', confirm: true })).isError).toBe(true);
  expect((await run('SELECT COUNT(*) FROM sign_request')).rows[0][0]).toBe(0);
  expect((await run('SELECT COUNT(*) FROM user_shows')).rows[0][0]).toBe(1);

  await run('UPDATE chatgpt_grants SET scope = ?', ALL);
  const deleted = await tool(token, 'delete_show', { id: 'friday', expected_revision: revision, confirm: true });
  expect(deleted.isError).toBeUndefined();
  expect((await run('SELECT COUNT(*) FROM user_shows')).rows[0][0]).toBe(0);
  const settings = decryptWithKey<{ trash: { data: Show }[] }>(String((await run('SELECT encrypted_data FROM user_settings')).rows[0][0]), key);
  expect(settings.trash[0].data).toEqual(show);
});

it('answers search and fetch in the shapes ChatGPT’s connectors expect', async () => {
  await seed();
  const token = await connect('shows:read');
  const found = await tool(token, 'search', { query: 'friday' });
  expect(found.structuredContent).toEqual({ results: [{ id: 'show:friday', title: 'Friday Comedy — 2026-12-04', url: origin }] });
  expect(JSON.parse(found.content[0].text)).toEqual(found.structuredContent);
  const doc = (await tool(token, 'fetch', { id: 'show:friday' })).structuredContent!;
  expect(Object.keys(doc).sort()).toEqual(['id', 'metadata', 'text', 'title', 'url']);
  expect(doc.text).toContain('Sam Okafor');
});

it('asks for every permission a tool can use when a request arrives without a token', async () => {
  const response = await rpc(undefined, 'tools/list');
  expect(response.status).toBe(401);
  expect(response.headers.get('www-authenticate')).toContain(`scope="${ALL}"`);
});

it('keeps internal failures out of tool results', async () => {
  const token = await connect(ALL);
  // A show row that does not decrypt under the delegated key.
  await run('INSERT INTO user_shows (id, user_id, encrypted_data) VALUES (?, ?, ?)', 'broken', 'producer', encryptWithKey(show, 'c'.repeat(64)));
  const result = await tool(token, 'get_show', { id: 'broken' });
  expect(result).toMatchObject({ isError: true });
  expect(result.content[0].text).not.toMatch(/stack|Error:|decrypt|sql/i);
  expect((await tool(token, 'no_such_tool', {})).content[0].text).toBe('Unknown tool.');
});

// The consent page offers ASSISTANT_SCOPES and the tools are gated by their
// own scope names. A tool under a scope nobody can grant would never be
// reachable, and a grantable scope with no tool would be a checkbox that does
// nothing, so the two lists have to be the same set.
it('offers exactly the scopes the tools are gated by', () => {
  expect([...TOOL_SCOPES].sort()).toEqual([...ASSISTANT_SCOPES].sort());
});

