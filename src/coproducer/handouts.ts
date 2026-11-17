/**
 * Links an approved share handed to a co-producer.
 *
 * A signing, details or viewer link works for whoever holds it, and keeps
 * working after the co-producer's own access ends: withdrawing their
 * co-producer link does not withdraw what they were given. So each approval
 * that hands one over is recorded (by request or show id, never a token),
 * the record outlives the co-producer's link, and the owner can see what was
 * given and withdraw it here, in words from the owner's own data.
 */
import type { ProfileRequest, SignatureRequest } from '../types';
import { linkStillLive } from '../utils/contracts';
import { visibleText } from './diff';
import type { OwnerState } from './redaction';
import type { HandoutRefs } from './types';

export type HandoutRef = HandoutRefs['links'][number];

export interface ResolvedHandout { ref: HandoutRef; text: string; state: 'live' | 'signed' | 'answered' | 'gone' }

function words(value: string | undefined): string {
  return visibleText((value ?? '').trim());
}

function findSignature(state: OwnerState, id: string): SignatureRequest | undefined {
  return (state.settings.signatureRequests ?? []).find((request) => request.id === id);
}

function findProfile(state: OwnerState, id: string): ProfileRequest | undefined {
  return (state.settings.profileRequests ?? []).find((request) => request.id === id);
}

/** One handed-out link in words: "Sam Lee's signing link for “Performer Agreement” (not signed yet)". */
export function resolveHandout(ref: HandoutRef, state: OwnerState): ResolvedHandout {
  if (ref.kind === 'signature') {
    const request = findSignature(state, ref.requestId);
    if (!request) return { ref, text: "A signing link that's been withdrawn", state: 'gone' };
    const what = `${words(request.signerName) || 'Someone'}'s signing link for “${words(request.contractName)}”`;
    return request.signed ? { ref, text: `${what} (signed)`, state: 'signed' } : { ref, text: `${what} (not signed yet)`, state: 'live' };
  }
  if (ref.kind === 'profile') {
    const request = findProfile(state, ref.requestId);
    if (!request) return { ref, text: "A details link that's been withdrawn", state: 'gone' };
    const what = `${words(request.personName) || 'Someone'}'s details link`;
    return request.submitted ? { ref, text: `${what} (answered)`, state: 'answered' } : { ref, text: `${what} (not answered yet)`, state: 'live' };
  }
  const show = state.shows.find((s) => s.id === ref.showId);
  if (!show || !show.viewToken) return { ref, text: "A viewer link that's been withdrawn", state: 'gone' };
  return { ref, text: `The viewer link for “${words(show.name)}”`, state: 'live' };
}

/** Every handed-out link in the rows, each once, in words. */
export function resolveHandouts(rows: { refs: HandoutRefs }[], state: OwnerState): ResolvedHandout[] {
  const seen = new Set<string>();
  const out: ResolvedHandout[] = [];
  for (const row of rows) {
    for (const ref of row.refs?.links ?? []) {
      const key = ref.kind === 'viewer' ? `viewer:${ref.showId}` : `${ref.kind}:${ref.requestId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(resolveHandout(ref, state));
    }
  }
  return out;
}

/** Read a decrypted handout record; null for anything that is not one. */
export function readHandoutRefs(value: unknown): HandoutRefs | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const links = (value as { links?: unknown }).links;
  if (!Array.isArray(links)) return null;
  const out: HandoutRef[] = [];
  for (const link of links) {
    if (!link || typeof link !== 'object') continue;
    const { kind, requestId, showId } = link as { kind?: unknown; requestId?: unknown; showId?: unknown };
    if ((kind === 'signature' || kind === 'profile') && typeof requestId === 'string') out.push({ kind, requestId });
    else if (kind === 'viewer' && typeof showId === 'string') out.push({ kind, showId });
  }
  return { links: out };
}

/** What withdrawing handed-out links needs from the owner's app (App passes its own state and helpers). */
export interface HandoutActions {
  /** The owner's latest state. */
  state(): OwnerState;
  /** DELETE the signing link on the server (contracts.ts revokeSignature). */
  revokeSignature(request: SignatureRequest): Promise<void>;
  /** As the Rolodex row's withdraw: the link and any photo sent through it. */
  retireProfile(request: ProfileRequest): void;
  /** DELETE the viewer link on the server. */
  withdrawViewer(token: string): Promise<void>;
  /** Take rows out of the owner's settings, by token. */
  removeSignatureRequests(tokens: string[]): void;
  removeProfileRequests(tokens: string[]): void;
  /** Clear these shows' viewer link (token and key). */
  clearViewerLinks(showIds: string[]): void;
}

/**
 * Withdraw handed-out links, resolved in the latest state. An unsigned
 * signing link is withdrawn as the Contracts page does it (a link the server
 * could not withdraw keeps its row, so its key is not lost); a signed one is
 * left alone. A details link goes as the Rolodex row's withdraw does it; a
 * viewer link comes off its show. Anything already gone is skipped.
 */
export async function withdrawHandoutLinks(links: HandoutRef[], actions: HandoutActions): Promise<{ withdrawn: number; skipped: string[] }> {
  const state = actions.state();
  const skipped: string[] = [];
  let withdrawn = 0;
  const signatures: string[] = [];
  const profiles: string[] = [];
  const viewers: string[] = [];
  const done = new Set<string>();
  for (const ref of links) {
    const key = ref.kind === 'viewer' ? `viewer:${ref.showId}` : `${ref.kind}:${ref.requestId}`;
    if (done.has(key)) continue;
    done.add(key);
    const resolved = resolveHandout(ref, state);
    if (ref.kind === 'signature') {
      const request = findSignature(state, ref.requestId);
      if (!request) {
        skipped.push(`${resolved.text} (already withdrawn)`);
        continue;
      }
      if (request.signed) {
        skipped.push(`${resolved.text.replace(/ \(signed\)$/, '')} (already signed)`);
        continue;
      }
      try {
        await actions.revokeSignature(request);
      } catch (err) {
        if (linkStillLive(err)) {
          skipped.push(`${resolved.text.replace(/ \(not signed yet\)$/, '')} (couldn't be withdrawn; try again)`);
          continue;
        }
      }
      signatures.push(request.token);
      withdrawn += 1;
    } else if (ref.kind === 'profile') {
      const request = findProfile(state, ref.requestId);
      if (!request) {
        skipped.push(`${resolved.text} (already withdrawn)`);
        continue;
      }
      actions.retireProfile(request);
      profiles.push(request.token);
      withdrawn += 1;
    } else {
      const show = state.shows.find((s) => s.id === ref.showId);
      if (!show?.viewToken) {
        skipped.push(`${resolved.text} (already withdrawn)`);
        continue;
      }
      await actions.withdrawViewer(show.viewToken).catch(() => {});
      viewers.push(show.id);
      withdrawn += 1;
    }
  }
  if (signatures.length) actions.removeSignatureRequests(signatures);
  if (profiles.length) actions.removeProfileRequests(profiles);
  if (viewers.length) actions.clearViewerLinks(viewers);
  return { withdrawn, skipped };
}
