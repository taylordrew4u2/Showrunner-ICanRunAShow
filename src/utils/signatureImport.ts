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
  /** The song, as words — a title and artist to go and find, not audio. */
  walkOnMusicName?: string;
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
  walkOnMusicName: 'Walk-on',
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
    // Words only. The audio itself still has to be found and uploaded by the
    // producer; this saves them asking what the song was.
    if (!out.walkOnMusicName && /walk.?on|entrance|intro (song|music)|song/.test(label)) {
      out.walkOnMusicName = value;
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
  existing:
    | Pick<PotentialComic, 'email' | 'phone' | 'socialMedia' | 'credits' | 'walkOnMusicName'>
    | undefined,
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

/**
 * Headshots, which are filed rather than offered.
 *
 * The rest of this module asks before it writes, because a phone number typed
 * at 1am can be wrong and a curated profile outranks it. A photo is not that:
 * it is only ever taken where the entry has no face at all, so there is
 * nothing to displace and nothing to weigh up — and left behind a button, it
 * simply never got pressed. The face the producer needs for a flyer stayed
 * inside a signed contract nobody reopened.
 *
 * Filing also gets the picture out of the settings blob. A headshot arrives as
 * a data URL, and every save copies the whole blob — so one unfiled photo is
 * re-uploaded on every edit and kept in every snapshot. In the media store it
 * is written once, by id, like every other picture in the app.
 */
export interface HeadshotToFile {
  /** The signature request carrying it. */
  token: string;
  /** What the signer sent, as a data URL. */
  dataUrl: string;
  /** Their Rolodex entry, when they already have one. */
  entryId?: string;
  /** Their name, for the entry that has to be created and for the filename. */
  name: string;
  /** Whether that entry still needs a face. An existing photo is never displaced. */
  wantsPhoto: boolean;
}

/**
 * Which signed headshots are not yet in the producer's own store.
 *
 * Matched to a Rolodex entry the same way the details import matches: the
 * entry the contract was sent to, falling back to the name, since a contract
 * typed out by hand still belongs to a person you know.
 */
export function headshotsToFile(
  requests: SignatureRequestLike[],
  comics: PotentialComic[],
  key: (name: string) => string,
): HeadshotToFile[] {
  const out: HeadshotToFile[] = [];
  for (const request of requests) {
    const shot = request.signed?.headshot;
    // Only data URLs: a reference means this one has already been filed.
    if (!shot || !shot.startsWith('data:')) continue;
    const name = (request.signerName ?? '').trim();
    const entry =
      comics.find((c) => c.id === request.contactId) ??
      comics.find((c) => key(c.name) === key(name)) ??
      null;
    out.push({
      token: request.token,
      dataUrl: shot,
      entryId: entry?.id,
      name,
      wantsPhoto: !entry?.photo,
    });
  }
  return out;
}

/** The part of a signature request this needs, so tests can pass the shape. */
export interface SignatureRequestLike {
  token: string;
  contactId?: string;
  signerName: string;
  signed?: { headshot?: string };
}

/**
 * Put one filed headshot where it belongs: on the person, and on the record.
 *
 * The record keeps a reference rather than losing the photo, so a producer who
 * later replaces the profile picture has not destroyed what the signer
 * actually sent — the agreement still carries it.
 */
export function applyFiledHeadshot(
  comics: PotentialComic[],
  filed: HeadshotToFile,
  ref: string,
  newId: () => string,
): PotentialComic[] {
  if (!filed.wantsPhoto) return comics;
  const entry = filed.entryId ? comics.find((c) => c.id === filed.entryId) : undefined;
  if (entry) return comics.map((c) => (c.id === entry.id ? { ...c, photo: ref } : c));
  // Nobody by that name yet. Someone who has signed an agreement is a contact
  // whether or not they were filed as one, and an entry is how the photo is
  // ever seen again.
  if (!filed.name) return comics;
  return [...comics, { id: newId(), name: filed.name, photo: ref }];
}
