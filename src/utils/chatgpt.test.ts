import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  chatGPTDenialRedirect, clientAllowsRequest, disconnectChatGPT,
  grantChatGPTAccess, isChatGPTRedirect, listChatGPTConnections, loadChatGPTClient, parseChatGPTAuthorization,
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
    ['redirect_uri', 'javascript:alert(1)'], ['redirect_uri', 'https://chatgpt.com/cb#secret'],
    ['redirect_uri', 'https://user:pass@chatgpt.com/cb'], ['client_id', ''], ['state', 'x'.repeat(2049)],
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
    expect(await grantChatGPTAccess(session, request, false)).toBe(target.href);
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
    await grantChatGPTAccess(session, readRequest, true);
    expect(JSON.parse(fetch.mock.calls[0][1].body).scope).toBe('shows:read');
  });

  it('grants edit access when it was requested and explicitly allowed', async () => {
    const target = new URL(request.redirect_uri);
    target.searchParams.set('code', 'code'); target.searchParams.set('state', request.state!);
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ redirect_url: target.href })));
    vi.stubGlobal('fetch', fetch);
    await grantChatGPTAccess(session, request, true);
    expect(JSON.parse(fetch.mock.calls[0][1].body).scope).toBe('shows:read shows:write');
  });

  it('does not follow an unexpected redirect returned by the API', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ redirect_url: 'https://attacker.example' }))));
    await expect(grantChatGPTAccess(session, request, true)).rejects.toThrow('invalid_authorization_redirect');
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
});
