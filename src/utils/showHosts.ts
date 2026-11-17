/**
 * Who is hosting a show: one person, or two who share the job.
 *
 * A show had a single host, kept as a name in `host`. The first host is
 * still there, and a second sits beside it in `coHost`, so a show saved
 * before there could be two needs nothing done to it. Each host carries a
 * handle the way a performer does: the Rolodex's when they were picked from
 * it, typed by hand when they are only a name.
 *
 * Everything that prints a host reads them through here, so one host and two
 * are worded the same way on the show page, the post, the room's screen and
 * the run sheet.
 */
import type { Show } from '../types';
import { toHandle } from './social';

export type HostSlot = 'host' | 'coHost';

/** First host, then second. */
export const HOST_SLOTS: readonly HostSlot[] = ['host', 'coHost'];

export const HOST_SOCIAL_FIELD = { host: 'hostSocial', coHost: 'coHostSocial' } as const;
export const HOST_COMIC_FIELD = { host: 'hostComicId', coHost: 'coHostComicId' } as const;

/** The six fields the two hosts are kept in. */
export type HostFields = Pick<Show, 'host' | 'hostSocial' | 'hostComicId' | 'coHost' | 'coHostSocial' | 'coHostComicId'>;

export interface ShowHost {
  slot: HostSlot;
  name: string;
  /** As typed or as the Rolodex has it: a handle or a pasted profile link. */
  social?: string;
  /** The Rolodex entry they were picked from, if they were. */
  comicId?: string;
}

/** What a slot holds, whether or not anyone is named in it. */
export function hostSlot(show: HostFields, slot: HostSlot): { name: string; social: string; comicId?: string } {
  return {
    name: show[slot] ?? '',
    social: show[HOST_SOCIAL_FIELD[slot]] ?? '',
    comicId: show[HOST_COMIC_FIELD[slot]] || undefined,
  };
}

/**
 * The hosts, in order. A slot with no name in it is nobody, whatever else
 * was left in it, so a second host with no first reads as the only host.
 */
export function showHosts(show: HostFields): ShowHost[] {
  const hosts: ShowHost[] = [];
  for (const slot of HOST_SLOTS) {
    const held = hostSlot(show, slot);
    const name = held.name.trim();
    if (!name) continue;
    hosts.push({ slot, name, social: held.social.trim() || undefined, comicId: held.comicId });
  }
  return hosts;
}

export function hostNames(show: HostFields): string[] {
  return showHosts(show).map((host) => host.name);
}

/** "Jo Park", or "Jo Park and Dev Okonjo". */
export function joinHosts(names: string[]): string {
  return names.join(' and ');
}

/** The host's handle, read the way a performer's is. Null when there is none to tag. */
export function hostHandle(host: Pick<ShowHost, 'social'>): string | null {
  return toHandle(host.social);
}

/** "Jo Park @jopark", or the name alone. */
export function hostWithHandle(host: Pick<ShowHost, 'name' | 'social'>): string {
  const handle = hostHandle(host);
  return handle ? `${host.name} ${handle}` : host.name;
}

/**
 * Every name a host's cue can carry: each host, and the two together, which
 * is who the generated running order puts on the welcome and the handovers
 * when the night has two.
 */
export function hostCueNames(hosts: (string | undefined)[]): string[] {
  const names = hosts.map((name) => name?.trim() ?? '').filter(Boolean);
  return names.length > 1 ? [...names, joinHosts(names)] : names;
}

/** The Rolodex's own test for two spellings of one name (rolodexKey). */
function sameName(a: string, b: string): boolean {
  const key = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');
  return key(a) === key(b);
}

function write<T extends HostFields>(show: T, slot: HostSlot, value: { name?: string; social?: string; comicId?: string }): T {
  return {
    ...show,
    [slot]: value.name || undefined,
    [HOST_SOCIAL_FIELD[slot]]: value.social || undefined,
    [HOST_COMIC_FIELD[slot]]: value.comicId || undefined,
  };
}

/**
 * A name typed into a host field.
 *
 * Typing over someone picked from the Rolodex names a different person, so
 * the link goes and so does the handle that came with it: left behind, the
 * new host would be tagged as the old one. A change the Rolodex would read
 * as the same name, its case or its spacing, is the same person still.
 */
export function retypeHost<T extends HostFields>(show: T, slot: HostSlot, name: string): T {
  const held = hostSlot(show, slot);
  if (!held.comicId || sameName(held.name, name)) return write(show, slot, { ...held, name });
  return write(show, slot, { name });
}

/** A handle typed into a host's social field. */
export function retypeHostSocial<T extends HostFields>(show: T, slot: HostSlot, social: string): T {
  return write(show, slot, { ...hostSlot(show, slot), social });
}

/**
 * A host set by name and handle alone, with no Rolodex to pick from: what an
 * assistant's edit is. A new name is typed over the old one, as above. A
 * new handle is that host's own from here on, so the link to an entry whose
 * handle it no longer matches goes with it; kept, the entry's handle would
 * be put back over the edit the next time the app opened the show. A handle
 * left beside no name belongs to nobody and is dropped.
 */
export function editHost<T extends HostFields>(show: T, slot: HostSlot, edit: { name?: string; social?: string }): T {
  let next = edit.name === undefined ? show : retypeHost(show, slot, edit.name);
  const held = hostSlot(next, slot);
  if (edit.social !== undefined && edit.social.trim() !== held.social.trim()) {
    next = write(next, slot, { name: held.name, social: edit.social.trim() });
  }
  return hostSlot(next, slot).name.trim() ? next : write(next, slot, {});
}

/** Someone chosen from the list: their name, their handle and, from the Rolodex, the link to their entry. */
export function pickHost<T extends HostFields>(show: T, slot: HostSlot, pick: { name: string; social?: string; comicId?: string }): T {
  return write(show, slot, { name: pick.name.trim(), social: pick.social?.trim(), comicId: pick.comicId });
}

/** Take a host off the show. The second host, left alone, becomes the host. */
export function removeHost<T extends HostFields>(show: T, slot: HostSlot): T {
  return promoteCoHost(write(show, slot, {}));
}

/**
 * Keep the only host in the first slot.
 *
 * Everything written before there could be two hosts reads `host` and
 * nothing else, so a show whose one host sat in the second slot would have
 * no host at all to an older app or an assistant's older copy.
 */
export function promoteCoHost<T extends HostFields>(show: T): T {
  if ((show.host ?? '').trim() || !(show.coHost ?? '').trim()) return show;
  return {
    ...show,
    host: show.coHost,
    hostSocial: show.coHostSocial,
    hostComicId: show.coHostComicId,
    coHost: undefined,
    coHostSocial: undefined,
    coHostComicId: undefined,
  };
}
