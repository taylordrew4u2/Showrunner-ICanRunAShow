import type { AppSettings, PotentialComic, SignatureRecord, SignatureRequest } from '../types';
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
 * entry the contract was sent to. Only legacy requests without that identity
 * can use a unique matching name; duplicate names never receive each other's photo.
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
    const nameMatches = comics.filter((c) => key(c.name) === key(name));
    const entry = request.contactId
      ? comics.find((c) => c.id === request.contactId)
      : nameMatches.length === 1 ? nameMatches[0] : undefined;
    out.push({
      token: request.token,
      dataUrl: shot,
      entryId: entry?.id,
      name,
      wantsPhoto: entry ? !entry.photo : !request.contactId && nameMatches.length === 0,
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
  if (entry?.photo) return comics;
  if (entry) return comics.map((c) => (c.id === entry.id ? { ...c, photo: ref } : c));
  // It was removed while the upload was running; do not recreate the person.
  if (filed.entryId) return comics;
  // Nobody by that name yet. Someone who has signed an agreement is a contact
  // whether or not they were filed as one, and an entry is how the photo is
  // ever seen again.
  if (!filed.name) return comics;
  return [...comics, { id: newId(), name: filed.name, photo: ref }];
}

/**
 * What a person's signed contracts know that their profile does not.
 *
 * The details import has always been an offer, on the grounds that a profile
 * curated for a year outranks whatever someone typed at 1am. That holds for a
 * *disagreement* — two different phone numbers is a question only the producer
 * can settle — but not for a gap. An empty email beside an email the person
 * typed themselves is not a decision; it is a button that did not get pressed,
 * and a Rolodex full of blanks six months later.
 *
 * So gaps fill themselves and conflicts stay an offer. Nothing here can
 * overwrite a value that is already on file.
 */
export function signedProfilePatch(
  requests: SignatureAnswersLike[],
  person: { id?: string; comicId?: string; name: string } & Partial<ImportedProfile>,
  key: (name: string) => string,
): ImportedProfile | null {
  const theirs = requests.filter(
    (r) => r.signed?.fields?.length && (r.contactId
      ? r.contactId === (person.comicId ?? person.id)
      : key(r.signerName ?? '') === key(person.name)),
  );
  if (theirs.length === 0) return null;

  // Newest first, so the most recent thing they told you fills a gap.
  const ordered = [...theirs].sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? ''));
  const patch: ImportedProfile = {};
  for (const request of ordered) {
    const answered = profileFromAnswers(request.signed?.fields);
    for (const change of profileChanges(person, answered)) {
      // `from` set means the profile already holds something different: a
      // conflict, which stays with the producer.
      if (change.from) continue;
      if (patch[change.key]) continue;
      patch[change.key] = change.to;
    }
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

/** The part of a signature request the answer-filling needs. */
export interface SignatureAnswersLike {
  signerName: string;
  profileFiled?: boolean;
  contactId?: string;
  sentAt?: string;
  signed?: { fields?: { label: string; value: string }[] };
}

/**
 * Fill every Rolodex entry's gaps from what its person has signed, and file
 * anyone who signed and was never added at all.
 *
 * Returns null when there is nothing to write, so an ordinary visit to the
 * contracts screen does not save the same settings back unchanged.
 */
export function fillRolodexFromSignatures(
  requests: (SignatureAnswersLike & { signerName: string })[],
  comics: PotentialComic[],
  key: (name: string) => string,
  newId: () => string,
): PotentialComic[] | null {
  const unfiled = requests.filter((request) => !request.profileFiled);
  const nameCounts = new Map<string, number>();
  for (const comic of comics) {
    const name = key(comic.name);
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }
  let changed = false;
  let next = comics.map((comic) => {
    const matching = unfiled.filter((request) => request.contactId || nameCounts.get(key(comic.name)) === 1);
    const patch = signedProfilePatch(matching, comic, key);
    if (!patch) return comic;
    changed = true;
    return { ...comic, ...patch };
  });

  // Someone who signed an agreement is a contact whether or not anyone filed
  // them as one, and their answers have nowhere else to live.
  const filed = new Set(next.map((c) => key(c.name)));
  for (const request of unfiled) {
    const name = (request.signerName ?? '').trim();
    // Explicit identity is authoritative even after a rename or deletion.
    if (request.contactId || !name || !request.signed?.fields?.length || filed.has(key(name))) continue;
    const patch = signedProfilePatch(unfiled, { name }, key);
    filed.add(key(name));
    changed = true;
    next = [...next, { id: newId(), name, ...(patch ?? {}) }];
  }

  return changed ? next : null;
}

/**
 * What a visit to the Contracts page writes back, from what it found there.
 *
 * Three lookups run on that visit — signatures that landed while the producer
 * was away, headshots to file from them, and Rolodex gaps their answers fill —
 * and each reports only what it changed. Combining them by hand lost the first
 * one: a signature whose answers filled a gap but carried no headshot wrote the
 * Rolodex and not the paperwork list, so the contract read as unsigned until
 * the next visit. Every piece that changed goes in, whichever others did.
 */
export function signatureVisitPatch(
  signed: SignatureRequest[] | null,
  filed: Pick<AppSettings, 'potentialComics' | 'signatureRequests'> | null,
  filledComics: PotentialComic[] | null,
): Partial<AppSettings> | null {
  const patch: Partial<AppSettings> = {};
  if (signed) patch.signatureRequests = signed;
  if (filed) Object.assign(patch, filed);
  if (filledComics) patch.potentialComics = filledComics;
  return Object.keys(patch).length > 0 ? patch : null;
}
