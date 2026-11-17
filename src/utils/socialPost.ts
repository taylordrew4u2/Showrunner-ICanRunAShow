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
import { hostHandle, joinHosts, showHosts } from './showHosts';
import { toHandle } from './social';
import { billedPerformers, surpriseGuests } from './surpriseGuests';

// Where every caller already imports it from.
export { toHandle };

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

/** A host as the post names them: who, and the handle to tag them by. */
interface PostedHost {
  name: string;
  handle: string | null;
}

/**
 * Who is hosting, with the handle each is tagged by.
 *
 * The Host fields win, and each host's own handle with them: picked from the
 * Rolodex or typed beside the name. A host with none saved still gets the
 * handle they carry on the bill, when they are performing too. With nobody in
 * the Host fields, whoever is marked hosting on the older hosts list.
 */
function postedHosts(show: Show): PostedHost[] {
  const billed = billedFrom(show);
  const onBill = (name: string) =>
    toHandle(billed.find((p) => p.name.trim().toLowerCase() === name.toLowerCase())?.socialMedia);
  const named = showHosts(show);
  if (named.length > 0) return named.map((host) => ({ name: host.name, handle: hostHandle(host) ?? onBill(host.name) }));
  return (show.hosts ?? [])
    .filter((h) => h.isHosting && h.name.trim())
    .map((h) => ({ name: h.name.trim(), handle: onBill(h.name.trim()) }));
}

/** "Hosted by …", one host or two, each with their handle when there is one to tag. */
export function hostLine(show: Show): string | null {
  const hosts = postedHosts(show);
  if (hosts.length === 0) return null;
  return `Hosted by ${joinHosts(hosts.map((host) => (host.handle ? `${host.name} ${host.handle}` : host.name)))}`;
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

/** Every handle in the post, the hosts' and then the bill's in billing order, without repeats. */
export function postTags(show: Show): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  const handles = [
    ...postedHosts(show).map((host) => host.handle),
    ...billedFrom(show).map((person) => toHandle(person.socialMedia)),
  ];
  handles.forEach((handle) => {
    if (handle && !seen.has(handle.toLowerCase())) {
      seen.add(handle.toLowerCase());
      tags.push(handle);
    }
  });
  return tags;
}

/**
 * Who in the post has no handle saved, so you know who to chase: a host
 * first, then the bill. A host who is also performing is on the bill, and
 * is listed there.
 */
export function untaggedNames(show: Show): string[] {
  const billed = billedFrom(show);
  const billedNames = new Set(billed.map((person) => person.name.trim().toLowerCase()));
  return [
    ...postedHosts(show)
      .filter((host) => !host.handle && !billedNames.has(host.name.toLowerCase()))
      .map((host) => host.name),
    ...billed.filter((person) => !toHandle(person.socialMedia)).map((person) => person.name),
  ];
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
  // that alone. Two hosts share the line, each with their own handle.
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
