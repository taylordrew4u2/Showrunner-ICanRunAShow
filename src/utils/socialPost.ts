/**
 * Turning a booked show into a post you can paste.
 *
 * Announcing a night means retyping what the app already knows — the date, the
 * room, the bill — and then hunting every performer's handle so nobody is left
 * untagged. Both halves are already in the show record, so the caption is built
 * from the booking itself and cannot drift out of date the way a hand-written
 * post does. Anyone with no handle saved is named rather than silently dropped,
 * because a missing tag is only noticed by the person who was missed.
 *
 * Surprise guests are the one deliberate exception: a post is the most public
 * thing the app writes, and naming or tagging them in it is the spoiler the
 * flag exists to prevent. They are left out of the caption, the tags and the
 * untagged list, and reported separately so the producer can see why.
 */

import type { Artist, Performer, Show } from '../types';
import { formatShowTime, parseShowDate } from './showDate';
import { billedPerformers, surpriseGuests } from './surpriseGuests';

/** Anyone who appears on the bill and can be tagged. */
type Billed = Pick<Performer, 'id' | 'name' | 'socialMedia'>;

export interface SocialPost {
  /** The whole caption, ready for the clipboard. */
  text: string;
  /** Just the handles, for pasting into a first comment. */
  tags: string[];
  /** People on the bill with no handle saved. */
  untagged: string[];
  /** Surprise guests, left out of all of the above on purpose. */
  withheld: string[];
}

/**
 * Sites whose profile links start with the handle: instagram.com/name.
 *
 * Not TikTok or Threads: a profile there is always tiktok.com/@name, found by
 * its @, and what else comes first is a share link — tiktok.com/t/ZT8abc,
 * the one the app's Share button copies — which was tagged "@t".
 */
const HANDLE_FIRST = new Set(['instagram.com', 'x.com', 'twitter.com']);

/** Pages on those sites that are not anybody's profile: a post, a reel, a story. */
const NOT_A_PROFILE = new Set([
  'p', 'reel', 'reels', 'stories', 'explore', 'tv', 'accounts', 'share', 's', 'i', 'intent', 'hashtag', 'search', 'home',
]);

/**
 * The handle in a pasted profile link, if it has one.
 *
 * An "@name" anywhere in the path is one (youtube.com/@name,
 * tiktok.com/@name). Otherwise only the sites that put the handle first are
 * read that way. Everywhere else the first part of the path is a page —
 * youtube.com/channel/…, facebook.com/profile.php — and tagging "@channel"
 * tags a stranger, so the person is named untagged instead.
 */
function handleInLink(host: string, path: string): string | null {
  const site = host.toLowerCase().replace(/^(?:www|m|mobile)\./, '');
  const parts = path.split(/[?#]/)[0].split('/').filter(Boolean);
  const first = parts[0];
  const candidate = parts.find((part) => part.startsWith('@'))
    ?? (HANDLE_FIRST.has(site) && first && !NOT_A_PROFILE.has(first.toLowerCase()) ? first : null);
  const handle = candidate?.replace(/^@+/, '');
  return handle && /^[\w.-]+$/.test(handle) ? `@${handle}` : null;
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

  // A pasted link has a scheme or a path. "mona.sable" with neither is a
  // handle with a dot in it, not a web address.
  const url = /^(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(\/\S*)?$/i.exec(text);
  if (url && (url[2] !== undefined || /^https?:\/\//i.test(text))) return handleInLink(url[1], url[2] ?? '');

  const cleaned = text.replace(/^@+/, '').replace(/\/+$/, '').trim();
  // A slash left over is a link that could not be read, not a handle.
  if (!cleaned || /[\s/]/.test(cleaned)) return null;
  return `@${cleaned}`;
}

/** "Hosted by …", with the host's handle when they are also on the bill. */
export function hostLine(show: Show): string | null {
  const named = show.host?.trim();
  const hosting = (show.hosts ?? []).filter((h) => h.isHosting && h.name.trim()).map((h) => h.name.trim());
  const names = named ? [named] : hosting;
  if (names.length === 0) return null;
  const withHandle = names.map((name) => {
    const onBill = billedFrom(show).find((p) => p.name.trim().toLowerCase() === name.toLowerCase());
    const handle = toHandle(onBill?.socialMedia);
    return handle ? `${name} ${handle}` : name;
  });
  return `Hosted by ${withHandle.join(' & ')}`;
}

/** Everyone the post may name: the bill without its surprise guests. */
function billedFrom(show: Show): Billed[] {
  const performers: Billed[] = billedPerformers(show.performers).map((person) => ({
    id: person.id,
    name: person.name,
    socialMedia: person.socialMedia,
  }));
  const artists: Billed[] = billedPerformers(show.artists ?? []).map((artist: Artist) => ({
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
  // In words, the way every other screen prints them: the date input stores
  // "2026-09-24", and that is not a line anyone pastes under a flyer.
  const day = parseShowDate(show.date);
  const dateText = day ? day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : show.date;
  const when = [dateText, formatShowTime(show.time)].filter(Boolean).join(' · ');
  if (when) lines.push(when);
  if (where) lines.push(where);

  // The host is on the bill too, and was the one name the post kept leaving
  // out: they are not in the performer list, and the caption was built from
  // that alone. The free-text host field wins; otherwise whoever is marked
  // hosting on the hosts list.
  const host = hostLine(show);
  if (host) lines.push(host);

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

  const withheld = surpriseGuests([...show.performers, ...(show.artists ?? [])])
    .map((person) => person.name.trim())
    .filter(Boolean);
  return { text: lines.join('\n'), tags, untagged: untaggedNames(show), withheld };
}
