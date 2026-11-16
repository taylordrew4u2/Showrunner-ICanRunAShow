import { afterEach, describe, expect, it, vi } from 'vitest';
import { ASSISTANT_SCOPES, normalizeScope } from '../../api/_lib/chatgptAuth';
import {
  ASSISTANT_PERMISSIONS, chatGPTDenialRedirect, clientAllowsRequest, describeScope, disconnectChatGPT,
  grantChatGPTAccess, grantedScope, includedBy, isChatGPTRedirect, isLoopbackRedirect, listChatGPTConnections, loadChatGPTClient,
  parseChatGPTAuthorization, redirectMatches, revokeChatGPTConnection,
} from './chatgpt';

const query = new URLSearchParams({
  client_id: 'registered-client', redirect_uri: 'https://chatgpt.com/aip/callback?client=showrunner',
  response_type: 'code', code_challenge: 'a'.repeat(43), code_challenge_method: 'S256',
  state: 'state/with special+characters', scope: 'shows:read shows:write', resource: 'https://example.com/api/mcp',
});
const request = parseChatGPTAuthorization(query.toString())!;
const session = { username: 'producer', userId: 'user-1', authHash: 'auth', key: 'current', legacyKey: 'old' };

afterEach(() => vi.unstubAllGlobals());

describe('ChatGPT OAuth consent requests', () => {
  it('preserves PKCE, OAuth state and audience without accepting extra grant data', () => {
    expect(request).toEqual({
      client_id: 'registered-client', redirect_uri: 'https://chatgpt.com/aip/callback?client=showrunner',
      response_type: 'code', code_challenge: 'a'.repeat(43), code_challenge_method: 'S256',
      state: 'state/with special+characters', scope: 'shows:read shows:write', resource: 'https://example.com/api/mcp',
    });
  });

  it.each([
    ['response_type', 'token'], ['code_challenge_method', 'plain'], ['code_challenge', 'short'],
    ['scope', 'shows:read account:delete'], ['scope', 'shows:write'], ['redirect_uri', 'http://example.com/callback'],
    ['redirect_uri', 'javascript:alert(1)'], ['redirect_uri', 'https://chatgpt.com/cb#secret'], ['redirect_uri', 'https://chatgpt.com/cb#'],
    ['redirect_uri', 'https://user:pass@chatgpt.com/cb'], ['redirect_uri', 'http://localhost:3118/callback#'], ['redirect_uri', 'http://user@127.0.0.1:3118/cb'],
    ['redirect_uri', 'http://localhost.evil.test/callback'], ['scope', 'shows:read offline_access'],
    ['client_id', ''], ['state', 'x'.repeat(2049)],
  ])('rejects invalid %s before granting or redirecting', (field, value) => {
    const invalid = new URLSearchParams(query);
    invalid.set(field, value);
    expect(parseChatGPTAuthorization(invalid.toString())).toBeNull();
  });

  it('rejects duplicate OAuth parameters and accepts a narrower read-only scope', () => {
    const duplicate = new URLSearchParams(query);
    duplicate.append('redirect_uri', 'https://attacker.example/callback');
    expect(parseChatGPTAuthorization(duplicate.toString())).toBeNull();
    const readOnly = new URLSearchParams(query);
    readOnly.set('scope', 'shows:read');
    expect(parseChatGPTAuthorization(readOnly.toString())?.scope).toBe('shows:read');
  });

  it('only permits the exact callback registered to the verified client', () => {
    expect(clientAllowsRequest({ clientName: 'ChatGPT', redirectUris: [request.redirect_uri] }, request)).toBe(true);
    expect(clientAllowsRequest({ clientName: 'ChatGPT', redirectUris: ['https://attacker.example/callback'] }, request)).toBe(false);
  });

  it('offers every permission when the client asks for none, in the server\'s order', () => {
    expect(ASSISTANT_PERMISSIONS.map((permission) => permission.scope)).toEqual([...ASSISTANT_SCOPES]);
    for (const scope of [null, '', '   ']) {
      const asked = new URLSearchParams(query);
      if (scope === null) asked.delete('scope'); else asked.set('scope', scope);
      expect(parseChatGPTAuthorization(asked.toString())?.scope).toBe(ASSISTANT_SCOPES.join(' '));
    }
    const reordered = new URLSearchParams(query);
    reordered.set('scope', 'links:send shows:delete shows:read');
    expect(parseChatGPTAuthorization(reordered.toString())?.scope).toBe('shows:read shows:delete links:send');
  });

  it("accepts Claude's callback and a native client's loopback callback on any port", () => {
    for (const callback of ['https://claude.ai/api/mcp/auth_callback', 'http://127.0.0.1:51234/callback', 'http://localhost:3118/callback']) {
      const asked = new URLSearchParams(query);
      asked.set('redirect_uri', callback);
      expect(parseChatGPTAuthorization(asked.toString())?.redirect_uri).toBe(callback);
    }
    expect(isLoopbackRedirect('http://localhost:3118/callback')).toBe(true);
    expect(isLoopbackRedirect('https://localhost:3118/callback')).toBe(false);
    expect(isLoopbackRedirect('https://claude.ai/api/mcp/auth_callback')).toBe(false);
    const loopback = parseChatGPTAuthorization(new URLSearchParams({ ...Object.fromEntries(query), redirect_uri: 'http://127.0.0.1:51234/callback' }).toString())!;
    expect(clientAllowsRequest({ clientName: 'Claude Code', redirectUris: ['http://127.0.0.1/callback'] }, loopback)).toBe(true);
    expect(clientAllowsRequest({ clientName: 'Claude Code', redirectUris: ['http://localhost/callback'] }, loopback)).toBe(false);
    expect(clientAllowsRequest({ clientName: 'Claude Code', redirectUris: ['http://127.0.0.1/other'] }, loopback)).toBe(false);
    expect(redirectMatches(['https://claude.ai/api/mcp/auth_callback'], 'https://claude.com/api/mcp/auth_callback')).toBe(false);
    expect(redirectMatches(['http://localhost:3118/callback#x'], 'http://localhost:4000/callback')).toBe(false);
  });

  it('grants what is ticked within what was requested, always with seeing shows', () => {
    const asked = { ...request, scope: 'shows:read shows:write shows:delete links:send' };
    expect(grantedScope(asked, [])).toBe('shows:read');
    expect(grantedScope(asked, ['links:send', 'shows:write'])).toBe('shows:read shows:write links:send');
    // Ticking something the client never asked for adds nothing.
    expect(grantedScope(asked, ['rolodex:write', 'contracts:read'])).toBe('shows:read');
    expect(grantedScope(asked, ASSISTANT_SCOPES)).toBe(asked.scope);
  });

  it('offers and grants seeing the Rolodex along with editing it', () => {
    const asked = new URLSearchParams(query);
    asked.set('scope', 'shows:read rolodex:write');
    const editing = parseChatGPTAuthorization(asked.toString())!;
    expect(editing.scope).toBe('shows:read rolodex:read rolodex:write');
    expect(grantedScope(editing, ['rolodex:write'])).toBe('shows:read rolodex:read rolodex:write');
    expect(grantedScope(editing, ['rolodex:read'])).toBe('shows:read rolodex:read');
    expect(grantedScope(editing, [])).toBe('shows:read');
    expect(includedBy('rolodex:read', new Set(['rolodex:write']))?.scope).toBe('rolodex:write');
    expect(includedBy('rolodex:read', new Set(['rolodex:read', 'shows:write']))).toBeUndefined();
    expect(includedBy('rolodex:write', new Set(ASSISTANT_SCOPES))).toBeUndefined();
  });

  it('grants exactly what the server then stores, whatever is ticked', () => {
    const everything = { ...request, scope: ASSISTANT_SCOPES.join(' ') };
    const optional = ASSISTANT_SCOPES.filter((scope) => scope !== 'shows:read');
    for (let mask = 0; mask < 2 ** optional.length; mask++) {
      const ticked = optional.filter((_, i) => mask & (1 << i));
      const granted = grantedScope(everything, ticked);
      expect(normalizeScope(granted), ticked.join(' ')).toBe(granted);
    }
  });

  it('says plainly which of performers’ answers seeing contracts includes', () => {
    const contracts = ASSISTANT_PERMISSIONS.find((permission) => permission.scope === 'contracts:read')!;
    expect(contracts.label).toContain('the contact details they gave');
    expect(contracts.detail).toContain('email, phone, social handle, bio and walk-on song');
    expect(contracts.detail).toContain('such as payment or tax details, stay in the app');
    expect(contracts.detail).not.toContain('last four');
  });

  it('describes a connection\'s permissions in words', () => {
    expect(describeScope('shows:read')).toBe('see shows');
    expect(describeScope('shows:read shows:write')).toBe('see shows and edit shows');
    expect(describeScope(ASSISTANT_SCOPES.join(' '))).toBe('see shows, edit shows, move shows to Trash, see the Rolodex, edit the Rolodex, see contracts and send links');
    expect(describeScope('shows:read future:scope')).toBe('see shows');
  });

  it('returns denial to the registered callback while preserving state and existing query', () => {
    const url = new URL(chatGPTDenialRedirect(request));
    expect(url.origin).toBe('https://chatgpt.com');
    expect(url.searchParams.get('client')).toBe('showrunner');
    expect(url.searchParams.get('state')).toBe(request.state);
    expect(url.searchParams.get('error')).toBe('access_denied');
  });

  it('refuses success responses that change the destination, original query or state', () => {
    const target = new URL(request.redirect_uri);
    target.searchParams.set('code', 'one-use-code');
    target.searchParams.set('state', request.state!);
    expect(isChatGPTRedirect(target.href, request)).toBe(true);
    target.searchParams.set('state', 'different');
    expect(isChatGPTRedirect(target.href, request)).toBe(false);
    target.searchParams.set('state', request.state!);
    target.searchParams.set('client', 'another');
    expect(isChatGPTRedirect(target.href, request)).toBe(false);
    expect(isChatGPTRedirect('https://attacker.example/callback?code=code', request)).toBe(false);
  });
});

describe('ChatGPT connection API calls', () => {
  it('rejects malformed client metadata instead of presenting an unchecked client', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ clientName: 'ChatGPT', redirectUris: request.redirect_uri }))));
    await expect(loadChatGPTClient('client')).rejects.toThrow('invalid_client_metadata');
  });

  it('sends derived keys only in the authenticated consent POST and honors read-only consent', async () => {
    const target = new URL(request.redirect_uri);
    target.searchParams.set('code', 'one-use-code');
    target.searchParams.set('state', request.state!);
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ redirect_url: target.href })));
    vi.stubGlobal('fetch', fetch);
    expect(await grantChatGPTAccess(session, request, [])).toBe(target.href);
    const [path, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe('/api/chatgpt?route=grant');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'x-user-id': 'user-1', 'x-auth': 'auth' });
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ key: 'current', legacyKey: 'old', scope: 'shows:read' });
    expect(body).not.toHaveProperty('password');
    expect(body).not.toHaveProperty('authHash');
    expect(body).not.toHaveProperty('username');
  });

  it('never broadens an originally read-only request', async () => {
    const readRequest = { ...request, scope: 'shows:read' };
    const target = new URL(request.redirect_uri);
    target.searchParams.set('code', 'code'); target.searchParams.set('state', request.state!);
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ redirect_url: target.href })));
    vi.stubGlobal('fetch', fetch);
    await grantChatGPTAccess(session, readRequest, ASSISTANT_SCOPES);
    expect(JSON.parse(fetch.mock.calls[0][1].body).scope).toBe('shows:read');
  });

  it('grants edit access when it was requested and explicitly allowed', async () => {
    const target = new URL(request.redirect_uri);
    target.searchParams.set('code', 'code'); target.searchParams.set('state', request.state!);
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ redirect_url: target.href })));
    vi.stubGlobal('fetch', fetch);
    await grantChatGPTAccess(session, request, ['shows:write']);
    expect(JSON.parse(fetch.mock.calls[0][1].body).scope).toBe('shows:read shows:write');
  });

  it('does not follow an unexpected redirect returned by the API', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ redirect_url: 'https://attacker.example' }))));
    await expect(grantChatGPTAccess(session, request, ['shows:write'])).rejects.toThrow('invalid_authorization_redirect');
  });

  it('lists and revokes connections as the signed-in account without resending keys', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ connections: [{ id: 'grant-1', clientName: 'ChatGPT' }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal('fetch', fetch);
    expect(await listChatGPTConnections(session)).toMatchObject([{ id: 'grant-1' }]);
    await disconnectChatGPT(session);
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'GET', headers: { 'x-user-id': 'user-1', 'x-auth': 'auth' } });
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'DELETE', headers: { 'x-user-id': 'user-1', 'x-auth': 'auth' } });
    expect(fetch.mock.calls.every((call) => call[1].body === undefined)).toBe(true);
  });

  it('revokes one connection by id as the signed-in account', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal('fetch', fetch);
    await revokeChatGPTConnection(session, 'grant 1&id=other');
    const [path, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(path, 'https://example.test').searchParams.getAll('id')).toEqual(['grant 1&id=other']);
    expect(init).toMatchObject({ method: 'DELETE', headers: { 'x-user-id': 'user-1', 'x-auth': 'auth' } });
    expect(init.body).toBeUndefined();
  });
});
