import { api } from './api';
import type { SessionCredentials } from './session-vault';

export interface ChatGPTAuthorization {
  client_id: string;
  redirect_uri: string;
  response_type: 'code';
  code_challenge: string;
  code_challenge_method: 'S256';
  state?: string;
  scope: string;
  resource?: string;
}

export interface ChatGPTClient {
  clientName: string;
  redirectUris: string[];
}

export interface ChatGPTConnection {
  id: string;
  clientName: string;
  scope: string;
  createdAt: string;
  expiresAt: string;
}

const KNOWN_SCOPES = new Set(['shows:read', 'shows:write']);
const OAUTH_FIELDS = ['client_id', 'redirect_uri', 'response_type', 'code_challenge', 'code_challenge_method', 'state', 'scope', 'resource'];

/** Reject ambiguous or malformed requests before offering consent. The server
 * independently checks the registered client, redirect and resource audience. */
export function parseChatGPTAuthorization(search: string): ChatGPTAuthorization | null {
  const query = new URLSearchParams(search);
  if (OAUTH_FIELDS.some((name) => query.getAll(name).length > 1)) return null;
  const clientId = query.get('client_id');
  const redirectUri = query.get('redirect_uri');
  const challenge = query.get('code_challenge');
  if (!clientId || clientId.length > 256 || !redirectUri || redirectUri.length > 2048) return null;
  if (query.get('response_type') !== 'code' || query.get('code_challenge_method') !== 'S256') return null;
  if (!challenge || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return null;
  try {
    const redirect = new URL(redirectUri);
    if (redirect.protocol !== 'https:' || redirect.username || redirect.password || redirect.hash) return null;
  } catch { return null; }
  const state = query.get('state') ?? undefined;
  const resource = query.get('resource') ?? undefined;
  if ((state?.length ?? 0) > 2048 || (resource?.length ?? 0) > 2048) return null;
  const scopes = [...new Set((query.get('scope') ?? 'shows:read shows:write').split(/\s+/).filter(Boolean))];
  if (!scopes.includes('shows:read') || scopes.some((scope) => !KNOWN_SCOPES.has(scope))) return null;
  return {
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...(state !== undefined ? { state } : {}),
    scope: scopes.join(' '),
    ...(resource !== undefined ? { resource } : {}),
  };
}

export function clientAllowsRequest(client: ChatGPTClient, request: ChatGPTAuthorization): boolean {
  return typeof client?.clientName === 'string' && client.clientName.length > 0
    && Array.isArray(client.redirectUris) && client.redirectUris.includes(request.redirect_uri);
}

export async function loadChatGPTClient(clientId: string): Promise<ChatGPTClient> {
  const client = await api.get<ChatGPTClient>(`/api/chatgpt?route=client&client_id=${encodeURIComponent(clientId)}`);
  if (typeof client?.clientName !== 'string' || !client.clientName
    || !Array.isArray(client.redirectUris) || !client.redirectUris.every((uri) => typeof uri === 'string')) {
    throw new Error('invalid_client_metadata');
  }
  return client;
}

/** Only follow a response for the same registered callback and OAuth state. */
export function isChatGPTRedirect(value: string, request: ChatGPTAuthorization): boolean {
  try {
    const target = new URL(value);
    const registered = new URL(request.redirect_uri);
    return target.origin === registered.origin && target.pathname === registered.pathname
      && !target.username && !target.password && !target.hash
      && [...registered.searchParams].every(([name, val]) => target.searchParams.get(name) === val)
      && target.searchParams.getAll('code').length === 1 && !!target.searchParams.get('code')
      && target.searchParams.getAll('state').length === (request.state === undefined ? 0 : 1)
      && target.searchParams.get('state') === (request.state ?? null);
  } catch { return false; }
}

export function chatGPTDenialRedirect(request: ChatGPTAuthorization): string {
  const url = new URL(request.redirect_uri);
  url.searchParams.set('error', 'access_denied');
  if (request.state !== undefined) url.searchParams.set('state', request.state);
  return url.href;
}

export async function grantChatGPTAccess(session: SessionCredentials, request: ChatGPTAuthorization, allowWrites: boolean): Promise<string> {
  const result = await api.post<{ redirect_url: string }>('/api/chatgpt?route=grant', {
    ...request,
    scope: allowWrites && request.scope.split(' ').includes('shows:write') ? 'shows:read shows:write' : 'shows:read',
    key: session.key,
    legacyKey: session.legacyKey,
  }, { authUserId: session.userId, authHash: session.authHash });
  if (!isChatGPTRedirect(result.redirect_url, request)) throw new Error('invalid_authorization_redirect');
  return result.redirect_url;
}

export async function listChatGPTConnections(session: SessionCredentials): Promise<ChatGPTConnection[]> {
  const result = await api.get<{ connections: ChatGPTConnection[] }>('/api/chatgpt?route=connections', {
    authUserId: session.userId, authHash: session.authHash,
  });
  if (!Array.isArray(result.connections)) throw new Error('invalid_connections');
  return result.connections;
}

export async function disconnectChatGPT(session: SessionCredentials): Promise<void> {
  await api.del('/api/chatgpt?route=connections', { authUserId: session.userId, authHash: session.authHash });
}
