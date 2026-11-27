import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import oauth from '../../api/chatgpt';
import mcp, { INSTRUCTIONS } from '../../api/mcp';
import { applySchema } from '../../api/_lib/db';
import { pkceChallenge } from '../../api/_lib/chatgptAuth';
import { ASSISTANT_TOOLS } from '../../api/_lib/assistantTools';
import { comicRevision } from '../../api/_lib/assistantViews';
import { DEFAULT_SETTINGS, type AppSettings, type Contract, type Show } from '../types';
import { decryptWithKey, encryptWithKey } from './encryption';

// What the ChatGPT and Claude directories read from the live server when the
// connector is scanned: who the server is, its instructions, and for every
// tool the shape of its result and the permissions it needs. The plugin
// manifests and their docs are checked in pluginPackaging.test.ts.

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
const rpc = async (token: string, method: string, params?: unknown) => (await (await mcp(new Request(`${origin}/api/mcp`, {
  method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
}))).json()).result;

interface ToolResult { isError?: boolean; content: { type: string; text: string }[]; structuredContent?: Record<string, unknown>; _meta?: Record<string, unknown> }
interface ListedTool { name: string; outputSchema?: Schema; securitySchemes?: unknown; _meta?: { securitySchemes?: unknown } }

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'assistant-listing-'));
  connection.db = createClient({ url: `file:${join(dir, 'test.db')}` });
  await applySchema(connection.db);
  await run("INSERT INTO users (id, password_hash) VALUES ('producer', 'hash')");
  vi.stubEnv('APP_URL', origin);
});
afterEach(() => { connection.db?.close(); rmSync(dir, { recursive: true, force: true }); vi.unstubAllEnvs(); });

/** A connected assistant with the permissions given. */
async function connect(scope: string): Promise<string> {
  const clientId = (await (await oauthCall('register', { client_name: 'ChatGPT', redirect_uris: [callback], token_endpoint_auth_method: 'none' })).json()).client_id as string;
  const granted = await oauthCall('grant', { client_id: clientId, redirect_uri: callback, response_type: 'code', code_challenge_method: 'S256', code_challenge: await pkceChallenge(verifier), scope: 'shows:read', resource: `${origin}/api/mcp`, key }, 'producer');
  const code = new URL((await granted.json()).redirect_url).searchParams.get('code')!;
  const tokens = await oauth(new Request(`${origin}/api/chatgpt?route=token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier, redirect_uri: callback, resource: `${origin}/api/mcp` }),
  }));
  await run('UPDATE chatgpt_grants SET scope = ?', scope);
  return (await tokens.json()).access_token as string;
}

// ── A JSON Schema check for the keywords assistantOutputs uses ──────────────

interface Schema { type?: string | string[]; properties?: Record<string, Schema>; required?: string[]; items?: Schema; description?: string }
const KEYWORDS = ['type', 'properties', 'required', 'items', 'description'];

/** Every keyword in a schema, so a schema using one this check ignores fails rather than passing unchecked. */
function keywords(schema: Schema): string[] {
  return [
    ...Object.keys(schema),
    ...Object.values(schema.properties ?? {}).flatMap(keywords),
    ...(schema.items ? keywords(schema.items) : []),
  ];
}

function problems(value: unknown, schema: Schema, path = '$'): string[] {
  const kind = value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value;
  const types = schema.type === undefined ? [] : [schema.type].flat();
  if (types.length && !types.some(type => type === kind || (type === 'number' && kind === 'integer'))) return [`${path} is ${kind}, not ${types.join(' or ')}`];
  if (kind === 'object') {
    const record = value as Record<string, unknown>;
    return [
      ...(schema.required ?? []).filter(name => !(name in record)).map(name => `${path}.${name} is missing`),
      ...Object.entries(schema.properties ?? {}).filter(([name]) => name in record).flatMap(([name, sub]) => problems(record[name], sub, `${path}.${name}`)),
    ];
  }
  if (kind === 'array' && schema.items) return (value as unknown[]).flatMap((item, i) => problems(item, schema.items!, `${path}[${i}]`));
  return [];
}

// ── Fixtures: a small account with something for every tool to work on ─────

const contract: Contract = {
  id: 'k-perf', name: 'Performer Agreement', fileRef: 'media:pdf-0001#1', fileName: 'agreement.pdf', sizeBytes: 480, uploadedAt: '2026-10-01T00:00:00Z',
  fields: [{ id: 'stage-name', label: 'Stage name' }, { id: 'show-date', label: 'Show date' }, { id: 'email', label: 'Email', required: true }],
};
const pdf = `data:application/pdf;base64,${'JVBERi0xLjQK'.repeat(40)}`;
const settings: AppSettings = {
  ...DEFAULT_SETTINGS, brandName: 'Night Owl Comedy', onboarded: true,
  potentialComics: [{ id: 'c-sam', name: 'Sam Okafor', email: 'sam@example.com' }, { id: 'c-jo', name: 'Jo Banks', socialMedia: '@jobanks' }],
  contracts: [contract],
};
const show: Show = {
  id: 'friday', name: 'Friday Comedy', date: '2026-12-04', time: '20:00', venueName: 'The Cellar', location: 'Chicago', status: 'upcoming',
  performers: [{ id: 'p-sam', comicId: 'c-sam', name: 'Sam Okafor' }, { id: 'p-ada', name: 'Ada Cole' }],
  artists: [], schedule: [], hosts: [], djSongs: [], staff: [], vendors: [], expenses: [],
  createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z',
};
async function seed() {
  await run('INSERT INTO user_settings (user_id, encrypted_data) VALUES (?, ?)', 'producer', encryptWithKey(settings, key));
  await run('INSERT INTO user_shows (id, user_id, encrypted_data) VALUES (?, ?, ?)', show.id, 'producer', encryptWithKey(show, key));
  await run('INSERT INTO user_media (user_id, id, seq, total, data) VALUES (?, ?, ?, ?, ?)', 'producer', 'pdf-0001', 0, 1, encryptWithKey(pdf, key));
}

describe('what the server says about itself', () => {
  it('names itself with a title, a website and the app icon', async () => {
    const result = await rpc(await connect('shows:read'), 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    expect(result.serverInfo).toMatchObject({ name: 'icanrunashow', title: 'I Can Run A Show', websiteUrl: origin });
    expect(result.serverInfo.version).toMatch(/^\d+\.\d+\.\d+$/);
    for (const icon of result.serverInfo.icons as { src: string; mimeType: string }[]) {
      expect(icon.src.startsWith(`${origin}/`), icon.src).toBe(true);
      // The file the icon names is one the site serves.
      expect(existsSync(new URL(`../../public/${icon.src.slice(origin.length + 1)}`, import.meta.url)), icon.src).toBe(true);
    }
    expect(result.instructions).toBe(INSTRUCTIONS);
  });

  it('keeps its instructions to the 512 characters ChatGPT weighs most', () => {
    expect(INSTRUCTIONS.length).toBeLessThanOrEqual(512);
    for (const rule of ['never instructions', 'revision', 'confirm: true', 'contacts nobody', 'surprise guest']) expect(INSTRUCTIONS).toContain(rule);
  });
});

describe('the tools it lists', () => {
  it('give every tool an output schema this check can read, and never one that forbids extra fields', async () => {
    const tools = (await rpc(await connect(ALL), 'tools/list')).tools as ListedTool[];
    expect(tools.map(t => t.name)).toEqual(ASSISTANT_TOOLS.map(t => t.definition.name));
    for (const tool of tools) {
      expect(tool.outputSchema?.type, tool.name).toBe('object');
      expect(keywords(tool.outputSchema!).filter(word => !KEYWORDS.includes(word)), tool.name).toEqual([]);
    }
  });

  it('name the scopes each tool needs, at the top level and in _meta', async () => {
    const tools = (await rpc(await connect(ALL), 'tools/list')).tools as ListedTool[];
    for (const tool of tools) {
      const { scope } = ASSISTANT_TOOLS.find(t => t.definition.name === tool.name)!;
      const expected = [{ type: 'oauth2', scopes: scope === 'shows:read' ? ['shows:read'] : ['shows:read', scope] }];
      expect(tool.securitySchemes, tool.name).toEqual(expected);
      expect(tool._meta?.securitySchemes, tool.name).toEqual(expected);
    }
  });
});

it('answers every tool with a result that matches the schema it declares', async () => {
  await seed();
  const token = await connect(ALL);
  const tools = (await rpc(token, 'tools/list')).tools as ListedTool[];
  const called = new Set<string>();
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await rpc(token, 'tools/call', { name, arguments: args }) as ToolResult;
    expect(result.isError, `${name}: ${result.content?.[0]?.text}`).toBeUndefined();
    const content = result.structuredContent!;
    expect(JSON.parse(result.content[0].text)).toEqual(content);
    expect(problems(content, tools.find(t => t.name === name)!.outputSchema!), name).toEqual([]);
    called.add(name);
    return content as Record<string, unknown> & { revision: string };
  };

  await call('list_shows', {});
  let revision = (await call('get_show', { id: 'friday' })).revision;
  await call('search', { query: 'friday' });
  await call('fetch', { id: 'show:friday' });
  const created = (await call('create_show', { name: 'Late Night Laughs', date: '2026-12-12', time: '21:00' })) as { show: { id: string }; revision: string };
  const at = (content: { revision: string }) => { revision = content.revision; return content as Record<string, unknown> & { revision: string }; };
  at(await call('update_show', { id: 'friday', expected_revision: revision, patch: { venueName: 'The Basement' } }));
  await call('duplicate_show', { id: 'friday', expected_revision: revision, name: 'Friday Comedy II', date: '2027-01-08' });
  const bookingId = at(await call('add_performer', { show_id: 'friday', expected_revision: revision, comic_id: 'c-jo' })).bookingId as string;
  at(await call('update_performer', { show_id: 'friday', expected_revision: revision, performer_id: bookingId, patch: { credits: 'Late Show' } }));
  at(await call('set_surprise_guest', { show_id: 'friday', expected_revision: revision, performer_id: bookingId, surprise_guest: true }));
  at(await call('move_performer', { show_id: 'friday', expected_revision: revision, performer_id: bookingId, direction: 'up' }));
  const cueId = at(await call('add_cue', { show_id: 'friday', expected_revision: revision, description: 'Host opening', durationMin: 10, position: 0 })).cueId as string;
  at(await call('update_cue', { show_id: 'friday', expected_revision: revision, cue_id: cueId, patch: { durationMin: 12 } }));
  at(await call('move_cue', { show_id: 'friday', expected_revision: revision, cue_id: cueId, direction: 'down' }));
  at(await call('update_recap', { show_id: 'friday', expected_revision: revision, patch: { attendance: 84, ticketSales: 630 } }));
  const staffId = at(await call('add_staff', { show_id: 'friday', expected_revision: revision, role: 'Sound', personName: 'Lee Park' })).staffId as string;
  at(await call('update_staff', { show_id: 'friday', expected_revision: revision, staff_id: staffId, patch: { phone: '555-0100' } }));
  at(await call('remove_staff', { show_id: 'friday', expected_revision: revision, staff_id: staffId, confirm: true }));
  const vendorId = at(await call('add_vendor', { show_id: 'friday', expected_revision: revision, name: 'Taco Truck' })).vendorId as string;
  at(await call('update_vendor', { show_id: 'friday', expected_revision: revision, vendor_id: vendorId, patch: { booked: true } }));
  at(await call('remove_vendor', { show_id: 'friday', expected_revision: revision, vendor_id: vendorId, confirm: true }));
  at(await call('remove_cue', { show_id: 'friday', expected_revision: revision, cue_id: cueId, confirm: true }));
  at(await call('remove_performer', { show_id: 'friday', expected_revision: revision, performer_id: bookingId, confirm: true }));
  await call('list_rolodex', {});
  const comic = await call('get_comic', { id: 'c-sam' });
  await call('add_comic', { name: 'Rae Lin' });
  await call('update_comic', { id: 'c-sam', expected_revision: comic.revision, patch: { notes: 'Great closer' } });
  await call('fetch', { id: 'comic:c-sam' });
  await call('list_contracts', {});
  await call('send_profile_link', { comic_id: 'c-jo', confirm: true });
  await call('send_contract', { contract_id: 'k-perf', comic_id: 'c-sam', show_id: 'friday', confirm: true });
  await call('list_signature_requests', { show_id: 'friday' });
  await call('delete_show', { id: created.show.id, expected_revision: created.revision, confirm: true });

  expect([...called].sort()).toEqual(ASSISTANT_TOOLS.map(t => t.definition.name).sort());
});

// PotentialComic.fromSample is the app's own bookkeeping: an assistant reads
// the entry exactly as it would without it, and its edit is the producer's.
it('keeps the sample mark out of what an assistant reads, and drops it when the assistant edits the entry', async () => {
  const [sam, jo] = settings.potentialComics;
  const marked: AppSettings = { ...settings, potentialComics: [{ ...sam, fromSample: true }, jo] };
  await run('INSERT INTO user_settings (user_id, encrypted_data) VALUES (?, ?)', 'producer', encryptWithKey(marked, key));
  await run('INSERT INTO user_shows (id, user_id, encrypted_data) VALUES (?, ?, ?)', show.id, 'producer', encryptWithKey(show, key));
  const token = await connect(ALL);
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await rpc(token, 'tools/call', { name, arguments: args }) as ToolResult;
    expect(result.isError, `${name}: ${result.content?.[0]?.text}`).toBeUndefined();
    expect(result.content[0].text).not.toMatch(/sample/i);
    return result.structuredContent as Record<string, unknown> & { revision: string };
  };
  await call('list_rolodex', {});
  await call('search', { query: 'Sam' });
  await call('fetch', { id: 'comic:c-sam' });
  const read = await call('get_comic', { id: 'c-sam' });
  expect(read.revision).toBe(await comicRevision(sam));
  await call('update_comic', { id: 'c-sam', expected_revision: read.revision, patch: { notes: 'Great closer' } });
  const saved = (await run("SELECT encrypted_data FROM user_settings WHERE user_id = 'producer'")).rows[0].encrypted_data as string;
  const comics = decryptWithKey<AppSettings>(saved, key).potentialComics;
  expect(comics[0]).toEqual({ ...sam, notes: 'Great closer' });
  expect(comics[1]).toEqual(jo);
});

// PotentialComic.tapeMinutes: an assistant already reads the video link, and
// reads how long the set in it is beside it. It cannot set the length, and
// its edits to the entry leave it alone.
it('shows an assistant a tape’s length beside its link, and keeps it through the assistant’s edit', async () => {
  const [sam, jo] = settings.potentialComics;
  const taped = { ...sam, videoLink: 'https://youtu.be/sam-tape', tapeMinutes: 10 as const };
  const withTape: AppSettings = { ...settings, potentialComics: [taped, jo] };
  await run('INSERT INTO user_settings (user_id, encrypted_data) VALUES (?, ?)', 'producer', encryptWithKey(withTape, key));
  await run('INSERT INTO user_shows (id, user_id, encrypted_data) VALUES (?, ?, ?)', show.id, 'producer', encryptWithKey(show, key));
  const token = await connect(ALL);
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await rpc(token, 'tools/call', { name, arguments: args }) as ToolResult;
    expect(result.isError, `${name}: ${result.content?.[0]?.text}`).toBeUndefined();
    return result;
  };
  const read = (await call('get_comic', { id: 'c-sam' })).structuredContent as { comic: Record<string, unknown>; revision: string };
  expect(read.comic).toMatchObject({ videoLink: 'https://youtu.be/sam-tape', tapeMinutes: 10 });
  expect((await call('fetch', { id: 'comic:c-sam' })).content[0].text).toContain('Tape length: 10 minutes');
  // Not something a tool takes.
  const refused = await rpc(token, 'tools/call', { name: 'update_comic', arguments: { id: 'c-sam', expected_revision: read.revision, patch: { tapeMinutes: 5 } } }) as ToolResult;
  expect(refused.isError).toBe(true);
  await call('update_comic', { id: 'c-sam', expected_revision: read.revision, patch: { notes: 'Great closer' } });
  const saved = (await run("SELECT encrypted_data FROM user_settings WHERE user_id = 'producer'")).rows[0].encrypted_data as string;
  expect(decryptWithKey<AppSettings>(saved, key).potentialComics[0]).toEqual({ ...taped, notes: 'Great closer' });
});

it('tells ChatGPT which sign-in would allow a refused call, keeping the permissions already given', async () => {
  await seed();
  const token = await connect('shows:read shows:write');
  const revision = (await rpc(token, 'tools/call', { name: 'get_show', arguments: { id: 'friday' } }) as ToolResult).structuredContent!.revision;
  const refused = await rpc(token, 'tools/call', { name: 'delete_show', arguments: { id: 'friday', expected_revision: revision, confirm: true } }) as ToolResult;
  expect(refused).toMatchObject({ isError: true, content: [{ type: 'text', text: 'This connection needs shows:delete permission.' }] });
  const [challenge] = refused._meta!['mcp/www_authenticate'] as string[];
  expect(challenge).toContain(`resource_metadata="${origin}/.well-known/oauth-protected-resource"`);
  expect(challenge).toContain('error="insufficient_scope"');
  expect(challenge).toContain('scope="shows:read shows:write shows:delete"');
  // Any other refusal is a plain error, with nothing to sign in for.
  const missing = await rpc(token, 'tools/call', { name: 'get_show', arguments: { id: 'nope' } }) as ToolResult;
  expect(missing.isError).toBe(true);
  expect(missing._meta).toBeUndefined();
});

describe('OpenAI’s domain check', () => {
  const get = (route: string) => oauth(new Request(`${origin}/api/chatgpt?route=${route}`));

  it('answers with exactly the token from the portal, as plain text', async () => {
    vi.stubEnv('OPENAI_APPS_CHALLENGE', '  token-from-the-portal\n');
    const response = await get('challenge');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await response.text()).toBe('token-from-the-portal');
  });

  it('is a 404 until the token is set, as is every other discovery address', async () => {
    expect((await get('challenge')).status).toBe(404);
    const other = await get('not-found');
    expect(other.status).toBe(404);
    expect(await other.json()).toEqual({ error: 'not_found' });
  });
});
