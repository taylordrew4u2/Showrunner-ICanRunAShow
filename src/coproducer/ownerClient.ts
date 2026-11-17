/**
 * The owner's side of /api/coproducer: making and withdrawing co-producer
 * links, reading what co-producers asked for, and deciding it.
 *
 * Every call carries the owner's own credential (x-user-id and x-auth), as
 * every other route the owner's app calls does, and never a bearer token:
 * the server keeps the two kinds of caller on separate routes, and nothing
 * the owner sends here could be mistaken for a co-producer's.
 *
 * What comes back is mostly ciphertext under the account key (labels,
 * outlines, payloads, results, the records of links handed out), because
 * the server keeps nothing about the account in the clear. It is decrypted
 * here, on the owner's device, through decryptUntrusted: a co-producer
 * wrote most of it, so it is read as untrusted JSON, never with JSON.parse
 * alone.
 */
import CryptoJS from 'crypto-js';
import { api } from '../utils/api';
import type { SessionCredentials } from '../utils/session-vault';
import { COPRODUCE_PATH } from './types';
import type {
  CoproducerLinkInfo,
  CreateLinkBody,
  CreateLinkResponse,
  DecideBody,
  DecideManyBody,
  HandoutRow,
  MediaChunk,
  OwnerRequestDetail,
  OwnerRequestRow,
} from './types';
import { parseUntrusted } from './untrusted';

const ROUTE = '/api/coproducer?route=';

function auth(session: SessionCredentials) {
  return { authUserId: session.userId, authHash: session.authHash };
}

/** The link a co-producer opens: the token rides in the fragment, so it never reaches a server in a request line. */
export function coproduceUrl(origin: string, token: string): string {
  return `${origin}${COPRODUCE_PATH}#t=${token}`;
}

/**
 * Make a link for a co-producer. Sends the account's data keys, which the
 * server seals under the link's own token, and `consent: true`, which the
 * owner gave by ticking the box. The link is returned once.
 */
export async function createCoproducerLink(
  session: SessionCredentials,
  label: string,
): Promise<{ link: CoproducerLinkInfo; url: string }> {
  const body: CreateLinkBody = { label: label.trim(), key: session.key, legacyKey: session.legacyKey, consent: true };
  const res = await api.post<CreateLinkResponse>(`${ROUTE}links`, body, auth(session));
  return { link: res.link, url: coproduceUrl(location.origin, res.token) };
}

/** The account's links that still work, newest first. */
export async function listCoproducerLinks(session: SessionCredentials): Promise<CoproducerLinkInfo[]> {
  return (await api.get<{ links: CoproducerLinkInfo[] }>(`${ROUTE}links`, auth(session))).links;
}

/** Withdraw one link. What it was handed stays on record, marked ended. */
export async function withdrawCoproducerLink(session: SessionCredentials, id: string): Promise<void> {
  await api.del(`${ROUTE}links&id=${encodeURIComponent(id)}`, auth(session));
}

/** Withdraw every link at once. */
export async function withdrawAllCoproducerLinks(session: SessionCredentials): Promise<void> {
  await api.del(`${ROUTE}links`, auth(session));
}

/** How many requests are waiting, and how many links are active. */
export async function inboxCount(session: SessionCredentials): Promise<{ open: number; links: number }> {
  const res = await api.get<{ open: number; links: number }>(`${ROUTE}inbox&count=1`, auth(session));
  return { open: Number(res.open) || 0, links: Number(res.links) || 0 };
}

/** One page of requests: outlines only, never payloads. */
export async function listInbox(
  session: SessionCredentials,
  status: 'open' | 'recent',
  after?: string,
): Promise<{ requests: OwnerRequestRow[]; next: string | null }> {
  const cursor = after ? `&after=${encodeURIComponent(after)}` : '';
  return api.get<{ requests: OwnerRequestRow[]; next: string | null }>(`${ROUTE}inbox&status=${status}${cursor}`, auth(session));
}

/** One request, with its payload and result ciphertext. */
export async function getInboxRequest(session: SessionCredentials, id: string): Promise<OwnerRequestDetail> {
  return (await api.get<{ request: OwnerRequestDetail }>(`${ROUTE}inbox&id=${encodeURIComponent(id)}`, auth(session))).request;
}

/** One chunk of a file a co-producer staged, as ciphertext under the account key. */
export async function stagedChunk(session: SessionCredentials, id: string, seq: number): Promise<MediaChunk> {
  return api.get<MediaChunk>(`${ROUTE}staged&id=${encodeURIComponent(id)}&seq=${seq}`, auth(session));
}

/** Move a request's staged files into the account's own media. Safe to repeat. */
export async function adoptMedia(session: SessionCredentials, requestId: string): Promise<void> {
  await api.post(`${ROUTE}adopt`, { id: requestId }, auth(session));
}

export async function decide(session: SessionCredentials, body: DecideBody): Promise<OwnerRequestRow> {
  return (await api.post<{ request: OwnerRequestRow }>(`${ROUTE}decide`, body, auth(session))).request;
}

/** Mark many stale, or reject many; returns the ids that changed. */
export async function decideMany(session: SessionCredentials, body: DecideManyBody): Promise<string[]> {
  return (await api.post<{ decided: string[] }>(`${ROUTE}decide-many`, body, auth(session))).decided;
}

/** What approved shares handed out, newest first. */
export async function listHandouts(session: SessionCredentials): Promise<HandoutRow[]> {
  return (await api.get<{ handouts: HandoutRow[] }>(`${ROUTE}handouts`, auth(session))).handouts;
}

/** Forget one record of a handed-out link (withdrawing the link itself is separate). */
export async function dismissHandout(session: SessionCredentials, id: string): Promise<void> {
  await api.del(`${ROUTE}handouts&id=${encodeURIComponent(id)}`, auth(session));
}

/**
 * Decrypt with the account's keys (current first, then legacy) and read the
 * result as untrusted JSON. Throws when nothing decrypts or the JSON holds a
 * shape that could reach a prototype.
 */
export function decryptUntrusted(ciphertext: string, session: SessionCredentials): unknown {
  for (const key of [session.key, session.legacyKey]) {
    if (!key) continue;
    let text = '';
    try {
      text = CryptoJS.AES.decrypt(ciphertext, key).toString(CryptoJS.enc.Utf8);
    } catch {
      text = '';
    }
    if (!text) continue;
    try {
      JSON.parse(text);
    } catch {
      // The wrong key can now and then give text that happens to be valid
      // UTF-8; it is never JSON. Try the other key.
      continue;
    }
    return parseUntrusted(text);
  }
  throw new Error('That could not be decrypted.');
}
