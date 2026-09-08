/**
 * Turning a booked show into a post you can paste.
 *
 * Announcing a night means retyping what the app already knows — the date, the
 * room, the bill — and then hunting every performer's handle so nobody is left
 * untagged. Both halves are already in the show record, so the caption is built
 * from the booking itself and cannot drift out of date the way a hand-written
 * post does. Anyone with no handle saved is named rather than silently dropped,
 * because a missing tag is only noticed by the person who was missed.
 */

import type { Artist, Performer, Show } from '../types';

/** Anyone who appears on the bill and can be tagged. */
type Billed = Pick<Performer, 'id' | 'name' | 'socialMedia'>;

export interface SocialPost {
  /** The whole caption, ready for the clipboard. */
  text: string;
  /** Just the handles, for pasting into a first comment. */
  tags: string[];
  /** People on the bill with no handle saved. */
  untagged: string[];
}

/**
 * Normalise whatever the producer typed into a handle.
 *
 * The field is free text and gets filled in from wherever the booking came
 * from, so it arrives as "@name", "name", or a pasted profile URL.
 */
export function toHandle(input: string | undefined): string | null {
  const text = input?.trim();
  if (!text) return null;

  // A pasted profile URL: the handle is the first path segment.
  const url = /^(?:https?:\/\/)?(?:www\.)?[a-z]+\.[a-z.]+\/(@?[\w.-]+)/i.exec(text);
  const candidate = url ? url[1] : text;

  const cleaned = candidate.replace(/^@+/, '').replace(/\/+$/, '').trim();
  if (!cleaned || /\s/.test(cleaned)) return null;
  return `@${cleaned}`;
}

function billedFrom(show: Show): Billed[] {
  const performers: Billed[] = show.performers.map((person) => ({
    id: person.id,
    name: person.name,
    socialMedia: person.socialMedia,
  }));
  const artists: Billed[] = (show.artists ?? []).map((artist: Artist) => ({
    id: artist.id,
    name: artist.name,
    socialMedia: artist.socialMedia,
  }));
  return [...performers, ...artists];
}

/** Every handle on the bill, in billing order, without repeats. */
export function postTags(show: Show): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  billedFrom(show).forEach((person) => {
    const handle = toHandle(person.socialMedia);
    if (handle && !seen.has(handle.toLowerCase())) {
      seen.add(handle.toLowerCase());
      tags.push(handle);
    }
  });
  return tags;
}

/** Who on the bill has no handle saved, so you know who to chase. */
export function untaggedNames(show: Show): string[] {
  return billedFrom(show)
    .filter((person) => !toHandle(person.socialMedia))
    .map((person) => person.name);
}

/**
 * The caption: what the night is, who is on it, where to get in.
 *
 * Kept plain-text and unstyled — every platform mangles formatting differently,
 * and this is going into a box the producer can still edit before posting.
 */
export function buildSocialPost(show: Show): SocialPost {
  const lines: string[] = [];

  lines.push(show.name.toUpperCase());

  const where = [show.venueName, show.location].filter(Boolean).join(', ');
  const when = [show.date, show.time].filter(Boolean).join(' · ');
  if (when) lines.push(when);
  if (where) lines.push(where);

  const billed = billedFrom(show);
  if (billed.length > 0) {
    lines.push('');
    billed.forEach((person) => {
      const handle = toHandle(person.socialMedia);
      lines.push(handle ? `${person.name} ${handle}` : person.name);
    });
  }

  if (show.ticketLink) {
    lines.push('');
    lines.push(`Tickets: ${show.ticketLink}`);
  }

  const tags = postTags(show);
  if (tags.length > 0) {
    lines.push('');
    lines.push(tags.join(' '));
  }

  return { text: lines.join('\n'), tags, untagged: untaggedNames(show) };
}
