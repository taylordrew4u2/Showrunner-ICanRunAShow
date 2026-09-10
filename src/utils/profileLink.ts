import type { ContractField, ProfileRequest, ProfileSubmission } from '../types';
import { api } from './api';
import { generateSignKey, generateSignToken } from './contracts';
import { decryptWithKey, encryptWithKey } from './encryption';
import type { SessionCredentials } from './session-vault';

/**
 * A self-serve profile link.
 *
 * "Can you send me your details" is the message a producer sends more than any
 * other, and the answer comes back as a text at 1am with half of it missing.
 * A profile link is that question as a form: the performer opens it on their
 * phone, fills in what they know about themselves, and it lands in the Rolodex
 * — no account for them, no form product for the producer, nothing to pay for.
 *
 * It rides the signing machinery unchanged. A signature request is already
 * "one unguessable token, one per-request key in the link's fragment, one
 * anonymous reply accepted exactly once" — which is precisely what asking
 * someone for their details needs. The server stores ciphertext it cannot open
 * and never sees the key. Nothing new was added to the backend for this, and
 * no new place for an anonymous stranger to write was opened.
 *
 * What it deliberately does not do is take a photo. A headshot is far bigger
 * than the anonymous-reply cap the server enforces on purpose, and lifting that
 * cap or opening a public upload is a security decision, not a UI one. Photos
 * come through the contract, which already carries them.
 */

/** What the performer is shown, encrypted under the request key. */
export interface ProfilePayload {
  /** Distinguishes this from a signing payload under the same key scheme. */
  kind: 'profile';
  /** Who is asking, so the page is not an anonymous form. */
  fromName: string;
  /** What the producer already has them filed as. Shown, editable. */
  personName: string;
  fields: ContractField[];
  createdAt: string;
}

/**
 * The questions a profile link asks.
 *
 * Fixed rather than editable, unlike a contract's, because the point is that
 * the answers map straight onto the profile — and the labels are matched by
 * the same rule that reads a signed contract, so they have to be words that
 * rule recognises.
 */
export function profileFields(): ContractField[] {
  return [
    { id: 'email', label: 'Email', required: true },
    { id: 'phone', label: 'Phone', placeholder: 'For show-day texts' },
    { id: 'social', label: 'Instagram or main social', placeholder: '@handle or a link' },
    {
      id: 'credits',
      label: 'How to credit you',
      placeholder: 'The line the host reads — credits, pronouns, anything',
      multiline: true,
    },
    { id: 'walkon', label: 'Walk-on song', placeholder: 'Title — artist' },
  ];
}

/** The link, with the key in the fragment so it never reaches a server. */
export function profileUrl(origin: string, token: string, key: string): string {
  return `${origin}/?profile=${encodeURIComponent(token)}#k=${key}`;
}

// ── Producer side ────────────────────────────────────────────────────────────

/**
 * Publish a profile link for one person and return the request to file.
 *
 * Creates a fresh token and key each time: a link is an invitation, and an
 * invitation you can revoke is only revocable if nobody else holds the same
 * address.
 */
export async function createProfileLink(
  person: { name: string; contactId?: string },
  fromName: string,
  creds: SessionCredentials,
): Promise<ProfileRequest> {
  const token = generateSignToken();
  const key = generateSignKey();
  const auth = { authUserId: creds.userId, authHash: creds.authHash };

  const payload: ProfilePayload = {
    kind: 'profile',
    fromName,
    personName: person.name.trim(),
    fields: profileFields(),
    createdAt: new Date().toISOString(),
  };
  await api.put('/api/sign', { token, payload: encryptWithKey(payload, key) }, auth);

  return {
    id: token.slice(0, 12),
    token,
    key,
    contactId: person.contactId,
    personName: person.name.trim(),
    sentAt: new Date().toISOString(),
  };
}

/** Withdraw a link — it stops working immediately. */
export async function revokeProfileLink(
  request: ProfileRequest,
  creds: SessionCredentials,
): Promise<void> {
  const auth = { authUserId: creds.userId, authHash: creds.authHash };
  await api.del(`/api/sign?token=${encodeURIComponent(request.token)}`, auth);
}

/**
 * Check one outstanding link for a reply.
 *
 * Null for "still waiting" and for "could not check" alike — a link whose
 * status we could not read is not evidence that nobody answered.
 */
export async function checkProfile(request: ProfileRequest): Promise<ProfileSubmission | null> {
  if (request.submitted) return null;
  try {
    const res = await api.get<{ signature: string | null }>(
      `/api/sign?token=${encodeURIComponent(request.token)}`,
    );
    if (!res.signature) return null;
    const record = decryptWithKey<ProfileSubmission>(res.signature, request.key);
    if (!record || !Array.isArray(record.fields)) return null;
    return record;
  } catch {
    return null;
  }
}

/**
 * Refresh every outstanding link, returning an updated list or null when
 * nothing changed — the caller writes the whole settings blob on any change,
 * and "still waiting" is by far the common answer.
 */
export async function refreshProfiles(
  requests: ProfileRequest[],
): Promise<ProfileRequest[] | null> {
  const pending = requests.filter((r) => !r.submitted);
  if (pending.length === 0) return null;
  const found = new Map<string, ProfileSubmission>();
  for (const request of pending) {
    const record = await checkProfile(request);
    if (record) found.set(request.token, record);
  }
  if (found.size === 0) return null;
  return requests.map((r) => (found.has(r.token) ? { ...r, submitted: found.get(r.token) } : r));
}

// ── Performer side ───────────────────────────────────────────────────────────

export interface ProfileView {
  payload: ProfilePayload;
  submitted: ProfileSubmission | null;
}

/** Open a link: what is being asked, and whether it has already been answered. */
export async function fetchProfileRequest(token: string, key: string): Promise<ProfileView | null> {
  try {
    const res = await api.get<{ payload: string; signature: string | null }>(
      `/api/sign?token=${encodeURIComponent(token)}`,
    );
    const payload = decryptWithKey<ProfilePayload>(res.payload, key);
    // A wrong key decrypts to nothing rather than throwing, and a contract's
    // payload under the right key is still not a profile — check both.
    if (!payload || payload.kind !== 'profile') return null;
    const submitted = res.signature ? decryptWithKey<ProfileSubmission>(res.signature, key) : null;
    return { payload, submitted: submitted && Array.isArray(submitted.fields) ? submitted : null };
  } catch {
    return null;
  }
}

/**
 * Send the answers. The server accepts this once and refuses after, so a
 * second submission cannot overwrite what the producer has already imported.
 */
export async function submitProfile(
  token: string,
  key: string,
  typedName: string,
  fields: { label: string; value: string }[],
): Promise<ProfileSubmission> {
  const record: ProfileSubmission = {
    submittedAt: new Date().toISOString(),
    typedName: typedName.trim(),
    fields,
  };
  await api.post('/api/sign', { token, signature: encryptWithKey(record, key) });
  return record;
}

// ── Status, for the producer ────────────────────────────────────────────────

export type ProfileLinkStatus = 'answered' | 'waiting' | null;

/**
 * Where one person stands on their profile link, for a Rolodex row.
 * Null means none was ever sent, which should not put a mark against them.
 */
export function profileLinkStatus(
  requests: ProfileRequest[] | undefined,
  contactId: string,
): ProfileLinkStatus {
  const mine = (requests ?? []).filter((r) => r.contactId === contactId);
  if (mine.length === 0) return null;
  return mine.some((r) => r.submitted) ? 'answered' : 'waiting';
}
