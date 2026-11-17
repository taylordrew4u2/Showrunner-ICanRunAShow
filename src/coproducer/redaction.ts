/**
 * The owner's side of the co-producer's redacted view.
 *
 * The server shows a co-producer the account with every link secret taken
 * out: a viewer link's token, a signing or details link's token, becomes a
 * pseudonym (api/_lib/coproducerViews.ts), and keys are dropped. A request
 * therefore names a link by its pseudonym, and its `base` values are the
 * redacted, schema-sanitised copy the co-producer saw.
 *
 * This module does the same redaction on the owner's own data, so a request
 * can be compared like with like (viewOfShow, viewOfSettings), and maps a
 * pseudonym back to the row it stands for (the index). A secret only ever
 * goes back onto the object it came from: applyRequest takes a show's viewer
 * link from the owner's current show, never from a request, and removes a
 * signing or details row only when its pseudonym resolves to a current row
 * with the same id.
 *
 * The same rule and the same test vectors as the server's: a change to one
 * is a change to both.
 */
import CryptoJS from 'crypto-js';
import type { AppSettings, Show } from '../types';
import { sanitizeSettings, sanitizeShow } from './schema';
import { PSEUDONYM_LABEL, REDACTED_TOKEN_PREFIX } from './types';

export interface OwnerState { shows: Show[]; settings: AppSettings }

export interface PseudonymIndex {
  /** pseudonym → where the real secret lives in the owner's current state. */
  viewer: Map<string, { showId: string; inTrash: boolean; token: string }>;
  signature: Map<string, { id: string; token: string }>;
  profile: Map<string, { id: string; token: string }>;
  /** real token → pseudonym, for redacting the owner's own copy to compare. */
  reverse: Map<string, string>;
}

const encoder = new TextEncoder();

function fromHex(hex: string): string {
  return REDACTED_TOKEN_PREFIX + hex.slice(0, 32);
}

/** 'redacted-' + the first 32 hex characters of SHA-256(PSEUDONYM_LABEL + token). */
export async function pseudonym(token: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return pseudonymNow(token);
  const digest = new Uint8Array(await subtle.digest('SHA-256', encoder.encode(PSEUDONYM_LABEL + token)));
  return fromHex(Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join(''));
}

/**
 * The same pseudonym, worked out synchronously. Used when a token turns up
 * that the index was not built with (the owner's state moved on between the
 * two), so a view is always the server's view and never a guess.
 */
function pseudonymNow(token: string): string {
  return fromHex(CryptoJS.SHA256(PSEUDONYM_LABEL + token).toString(CryptoJS.enc.Hex));
}

function isBag(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/** Every link token in the owner's state, by pseudonym, and the reverse. */
export async function buildPseudonymIndex(state: OwnerState): Promise<PseudonymIndex> {
  const index: PseudonymIndex = { viewer: new Map(), signature: new Map(), profile: new Map(), reverse: new Map() };
  const name = async (token: string) => {
    const known = index.reverse.get(token);
    if (known) return known;
    const made = await pseudonym(token);
    index.reverse.set(token, made);
    return made;
  };
  for (const show of state.shows ?? []) {
    if (nonEmptyString(show?.viewToken)) {
      const key = await name(show.viewToken);
      if (!index.viewer.has(key)) index.viewer.set(key, { showId: show.id, inTrash: false, token: show.viewToken });
    }
  }
  for (const item of state.settings?.trash ?? []) {
    const data = item?.data;
    if (data && nonEmptyString(data.viewToken)) {
      const key = await name(data.viewToken);
      if (!index.viewer.has(key)) index.viewer.set(key, { showId: data.id, inTrash: true, token: data.viewToken });
    }
  }
  for (const request of state.settings?.signatureRequests ?? []) {
    if (request && nonEmptyString(request.token)) {
      const key = await name(request.token);
      if (!index.signature.has(key)) index.signature.set(key, { id: request.id, token: request.token });
    }
  }
  for (const request of state.settings?.profileRequests ?? []) {
    if (request && nonEmptyString(request.token)) {
      const key = await name(request.token);
      if (!index.profile.has(key)) index.profile.set(key, { id: request.id, token: request.token });
    }
  }
  return index;
}

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** As the server: a non-empty token becomes its pseudonym, anything else but '' is no token at all. */
function redactToken(holder: Record<string, unknown>, field: string, index: PseudonymIndex): void {
  if (!Object.prototype.hasOwnProperty.call(holder, field)) return;
  const value = holder[field];
  if (nonEmptyString(value)) holder[field] = index.reverse.get(value) ?? pseudonymNow(value);
  else if (value !== '') delete holder[field];
}

function redactShowInPlace(show: Record<string, unknown>, index: PseudonymIndex): void {
  redactToken(show, 'viewToken', index);
  delete show.viewerKey;
}

/** The co-producer's view of one of the owner's shows: what a request's `base` for it should equal. */
export function viewOfShow(show: Show, index: PseudonymIndex): Show {
  const out = copy(show) as unknown;
  if (isBag(out)) redactShowInPlace(out, index);
  return (sanitizeShow(out) ?? out) as Show;
}

/** The co-producer's view of the owner's settings. */
export function viewOfSettings(settings: AppSettings, index: PseudonymIndex): AppSettings {
  const out = copy(settings) as unknown;
  if (!isBag(out)) return settings;
  if (Array.isArray(out.trash)) {
    for (const item of out.trash) {
      if (isBag(item) && isBag(item.data)) redactShowInPlace(item.data, index);
    }
  }
  for (const field of ['signatureRequests', 'profileRequests'] as const) {
    const rows = out[field];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!isBag(row)) continue;
      redactToken(row, 'token', index);
      row.key = '';
    }
  }
  return (sanitizeSettings(out) ?? out) as AppSettings;
}
