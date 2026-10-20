// The browser's side of /api/account: deleting the account for good.
import { api } from './api';
import type { AppSettings, Show } from '../types';
import type { SessionCredentials } from './session-vault';

// What api/account.ts takes in one request, and the longest token it accepts.
const MAX_NAMED_TOKENS = 5000;
const MAX_TOKEN_CHARS = 128;

/**
 * Every link the account's own data says it handed out: contracts and profile
 * links sent, and viewer links on its shows, trashed ones included. Links made
 * before the server recorded who made them name no account there, so this is
 * the only way the server can learn they were this account's — see
 * api/account.ts.
 */
export function accountTokens(shows: Show[], settings: AppSettings): string[] {
  const tokens = [
    ...shows.map((show) => show.viewToken),
    ...(settings.trash ?? []).map((item) => item.data?.viewToken),
    ...(settings.signatureRequests ?? []).map((request) => request.token),
    ...(settings.profileRequests ?? []).map((request) => request.token),
  ].filter((token): token is string => typeof token === 'string' && token.length > 0 && token.length <= MAX_TOKEN_CHARS);
  return [...new Set(tokens)].slice(0, MAX_NAMED_TOKENS);
}

/**
 * Delete the account and everything stored under it. Throws, with nothing
 * deleted, when the server could not cancel a subscription first.
 */
export async function deleteAccount(creds: SessionCredentials, tokens: string[]): Promise<void> {
  await api.del('/api/account', { authUserId: creds.userId, authHash: creds.authHash, body: { tokens } });
}
