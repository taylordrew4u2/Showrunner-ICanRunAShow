import { api } from './api';
import type { SessionCredentials } from './session-vault';
import { isReviewMode, ReviewModeBlockedError } from '../coproducer/reviewMode';

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

/** One permission a producer can grant an AI assistant, in the words the
 * consent page and Settings use for it. */
export interface AssistantPermission {
  scope: string;
  /** The consent page's checkbox label. */
  label: string;
  /** What a producer should know before leaving it ticked. */
  detail?: string;
  /** Settings' short form, as in "Can see shows and send links". */
  short: string;
  /** Always granted: the consent page shows it ticked and fixed. */
  required?: boolean;
  /** A permission this one cannot work without. It is granted along with
   * this one, and the consent page ticks and locks it while this one is
   * ticked, as normalizeScope on the server adds it. */
  includes?: string;
}

/** The same scopes, in the same order, as ASSISTANT_SCOPES on the server
 * (api/_lib/chatgptAuth.ts); a test keeps the two lists equal. */
export const ASSISTANT_PERMISSIONS: readonly AssistantPermission[] = [
  { scope: 'shows:read', label: 'See your shows, including lineups and running orders', short: 'see shows', required: true },
  { scope: 'shows:write', label: 'Create, duplicate and edit shows, lineups, running orders, recaps, staff and vendors', short: 'edit shows' },
  {
    scope: 'shows:delete', label: 'Move shows to Trash', short: 'move shows to Trash',
    detail: 'They go to Settings → Recently deleted, which keeps the latest 20 for you to put back. Walk-on audio isn’t kept.',
  },
  { scope: 'rolodex:read', label: 'See the people in your Rolodex', short: 'see the Rolodex' },
  { scope: 'rolodex:write', label: 'Add and edit people in your Rolodex', short: 'edit the Rolodex', includes: 'rolodex:read' },
  {
    scope: 'contracts:read', label: 'See your contract templates, who has signed or sent their details, and the contact details they gave', short: 'see contracts',
    detail: 'That means their email, phone, social handle, bio and walk-on song. Their other answers, such as payment or tax details, stay in the app.',
  },
  {
    scope: 'links:send', label: 'Send contract and profile links to performers on your behalf', short: 'send links',
    detail: 'Each link is made in your name, the same as one you send from the app.',
  },
];
const KNOWN_SCOPES = new Set(ASSISTANT_PERMISSIONS.map((permission) => permission.scope));

/** The scopes given, with every permission one of them includes. */
function withIncluded(scopes: Iterable<string>): Set<string> {
  const all = new Set(scopes);
  for (const permission of ASSISTANT_PERMISSIONS) {
    if (permission.includes && all.has(permission.scope)) all.add(permission.includes);
  }
  return all;
}

/** The ticked permission that holds this one ticked, if any. */
export function includedBy(scope: string, ticked: ReadonlySet<string>): AssistantPermission | undefined {
  return ASSISTANT_PERMISSIONS.find((permission) => permission.includes === scope && ticked.has(permission.scope));
}

/** A client that asks for no particular scope is offered every permission,
 * and the producer unticks what they don't want. */
const DEFAULT_SCOPE = ASSISTANT_PERMISSIONS.map((permission) => permission.scope).join(' ');
const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost'];
const OAUTH_FIELDS = ['client_id', 'redirect_uri', 'response_type', 'code_challenge', 'code_challenge_method', 'state', 'scope', 'resource'];

/** A native client such as Claude Code waiting for the callback on this
 * computer, rather than an assistant's website. */
export function isLoopbackRedirect(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && LOOPBACK_HOSTS.includes(url.hostname);
  } catch { return false; }
}

/** The server's rule, checked again before consent is offered: a callback
 * must be one the client registered, exactly, except that a loopback one may
 * name any port, because the OS hands a native client a fresh one each time. */
export function redirectMatches(registered: readonly string[], requested: string): boolean {
  if (registered.includes(requested)) return true;
  if (!isLoopbackRedirect(requested) || requested.includes('#')) return false;
  const want = new URL(requested);
  return registered.some((uri) => {
    if (!isLoopbackRedirect(uri) || uri.includes('#')) return false;
    const have = new URL(uri);
    return have.hostname === want.hostname && have.pathname === want.pathname && have.search === want.search;
  });
}

/** Settings' description of a connection's permissions, as a phrase. */
export function describeScope(scope: string): string {
  const granted = new Set(scope.split(/\s+/));
  const words = ASSISTANT_PERMISSIONS.filter((permission) => granted.has(permission.scope)).map((permission) => permission.short);
  return words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

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
  // A bare trailing "#" parses to an empty hash, so look at the text itself.
  if (redirectUri.includes('#')) return null;
  try {
    const redirect = new URL(redirectUri);
    if ((redirect.protocol !== 'https:' && !isLoopbackRedirect(redirectUri)) || redirect.username || redirect.password) return null;
  } catch { return null; }
  const state = query.get('state') ?? undefined;
  const resource = query.get('resource') ?? undefined;
  if ((state?.length ?? 0) > 2048 || (resource?.length ?? 0) > 2048) return null;
  const asked = new Set((query.get('scope')?.trim() || DEFAULT_SCOPE).split(/\s+/));
  if (!asked.has('shows:read') || [...asked].some((scope) => !KNOWN_SCOPES.has(scope))) return null;
  // Asking to edit the Rolodex is asking to see it too, so the page offers both.
  const scopes = withIncluded(asked);
  return {
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...(state !== undefined ? { state } : {}),
    scope: ASSISTANT_PERMISSIONS.filter((permission) => scopes.has(permission.scope)).map((permission) => permission.scope).join(' '),
    ...(resource !== undefined ? { resource } : {}),
  };
}

export function clientAllowsRequest(client: ChatGPTClient, request: ChatGPTAuthorization): boolean {
  return typeof client?.clientName === 'string' && client.clientName.length > 0
    && Array.isArray(client.redirectUris) && redirectMatches(client.redirectUris, request.redirect_uri);
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

/** What the producer ticked, within what the client asked for: consent can
 * withhold a permission but never add one the request didn't name. A ticked
 * permission brings what it includes, which a parsed request always names. */
export function grantedScope(request: ChatGPTAuthorization, ticked: Iterable<string>): string {
  const requested = new Set(request.scope.split(' '));
  const chosen = withIncluded(ticked);
  return ASSISTANT_PERMISSIONS
    .filter((permission) => requested.has(permission.scope) && (permission.required || chosen.has(permission.scope)))
    .map((permission) => permission.scope)
    .join(' ');
}

export async function grantChatGPTAccess(session: SessionCredentials, request: ChatGPTAuthorization, ticked: Iterable<string>): Promise<string> {
  // AI connections are the owner's alone; Settings never offers them here.
  if (isReviewMode()) throw new ReviewModeBlockedError();
  const result = await api.post<{ redirect_url: string }>('/api/chatgpt?route=grant', {
    ...request,
    scope: grantedScope(request, ticked),
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

/** Revoke every assistant connection on the account. */
export async function disconnectChatGPT(session: SessionCredentials): Promise<void> {
  if (isReviewMode()) throw new ReviewModeBlockedError();
  await api.del('/api/chatgpt?route=connections', { authUserId: session.userId, authHash: session.authHash });
}

/** Revoke one connection and its tokens, leaving the account's others. */
export async function revokeChatGPTConnection(session: SessionCredentials, id: string): Promise<void> {
  if (isReviewMode()) throw new ReviewModeBlockedError();
  await api.del(`/api/chatgpt?route=connections&id=${encodeURIComponent(id)}`, { authUserId: session.userId, authHash: session.authHash });
}
