import type { PotentialComic, SignatureRecord } from '../types';
import { isEmail } from './social';
import { toHandle } from './socialPost';

/**
 * Getting a signer's details into their profile.
 *
 * A contract already asks the questions — email, phone, how to credit you, the
 * socials — and the answers arrive with the signature. Until now they sat on
 * the signed record and were retyped by hand into the Rolodex, which is the
 * kind of copying that quietly doesn't happen, so the entry you book from six
 * months later still has nothing on it.
 *
 * This is deliberately only reachable from a signed contract. That is the one
 * moment the person has told you these details themselves, and it means no
 * separate form to send, chase, or pay for.
 *
 * Nothing here overwrites silently. The producer is shown what would change,
 * old value beside new, and decides — a profile they have curated for a year
 * outranks whatever someone typed at 1am on their phone.
 */

/** The profile fields a contract's answers can populate. */
export interface ImportedProfile {
  email?: string;
  phone?: string;
  socialMedia?: string;
  credits?: string;
}

/** One change the producer is being offered, in the words they'll recognise. */
export interface ProfileChange {
  key: keyof ImportedProfile;
  /** The profile's own name for it, not the contract's question. */
  label: string;
  from?: string;
  to: string;
}

const LABELS: Record<keyof ImportedProfile, string> = {
  email: 'Email',
  phone: 'Phone',
  socialMedia: 'Socials',
  credits: 'Credits',
};

/**
 * Read a contract's answers as profile fields.
 *
 * Matched on the label rather than a field id, because the questions are the
 * producer's own words — "Instagram", "Your handle", "Where can people find
 * you" — and because the record keeps labels precisely so it still reads
 * correctly after the contract is edited or deleted.
 *
 * A stage name is not mapped onto the profile's name. Renaming someone in the
 * Rolodex off the back of a form answer would break every show that already
 * has them booked under the name you know them by.
 */
export function profileFromAnswers(
  fields: SignatureRecord['fields'] | undefined,
): ImportedProfile {
  const out: ImportedProfile = {};
  for (const field of fields ?? []) {
    const label = field.label.toLowerCase();
    const value = field.value.trim();
    if (!value) continue;

    // Order matters: "email" inside "email or phone" should not also claim the
    // phone slot, and a question about credit is not a question about socials
    // even when it mentions them.
    if (!out.email && /e-?mail/.test(label)) {
      if (isEmail(value)) out.email = value;
      continue;
    }
    if (!out.phone && /phone|mobile|cell|number|text me/.test(label)) {
      out.phone = value;
      continue;
    }
    if (!out.credits && /credit|bio|introduc|how to intro/.test(label)) {
      out.credits = value;
      continue;
    }
    if (!out.socialMedia && /social|instagram|\big\b|handle|tiktok|twitter|find you/.test(label)) {
      out.socialMedia = toHandle(value) ?? value;
      continue;
    }
  }
  return out;
}

/**
 * The changes worth offering, old beside new.
 *
 * A value identical to what is already filed is not a change, and an empty
 * answer is not a reason to clear a field that has something in it — a blank
 * is someone skipping a question, never an instruction to delete.
 */
export function profileChanges(
  existing: Pick<PotentialComic, 'email' | 'phone' | 'socialMedia' | 'credits'> | undefined,
  incoming: ImportedProfile,
): ProfileChange[] {
  const changes: ProfileChange[] = [];
  for (const key of Object.keys(LABELS) as (keyof ImportedProfile)[]) {
    const to = incoming[key]?.trim();
    if (!to) continue;
    const from = existing?.[key]?.trim() || undefined;
    if (from === to) continue;
    changes.push({ key, label: LABELS[key], from, to });
  }
  return changes;
}

/**
 * Apply the accepted changes to a Rolodex entry.
 *
 * Takes the changes rather than the whole profile so that the producer can
 * decline one and keep the rest, and so what is written is exactly what they
 * were shown.
 */
export function applyProfileChanges<T>(entry: T, changes: ProfileChange[]): T & ImportedProfile {
  const next = { ...entry } as T & ImportedProfile;
  for (const change of changes) next[change.key] = change.to;
  return next;
}

/** A one-line summary of what an import would do, for the button that offers it. */
export function describeChanges(changes: ProfileChange[]): string {
  if (changes.length === 0) return 'Nothing new to save';
  const overwrites = changes.filter((c) => c.from).length;
  const additions = changes.length - overwrites;
  const parts: string[] = [];
  if (additions) parts.push(`${additions} to fill in`);
  if (overwrites) parts.push(`${overwrites} to replace`);
  return parts.join(', ');
}
