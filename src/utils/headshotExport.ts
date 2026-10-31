import type { Performer } from '../types';
import { dataUrlToBytes } from './media';
import { isMediaRef, resolveMediaUrl } from './mediaStore';
import { createZip } from './zip';

/**
 * Every headshot on a show's bill in one go, each file named after the act.
 *
 * A producer sends the lineup's faces on — to the venue, to whoever is making
 * the flyer, to the person posting the socials. One at a time from each
 * profile, that was a dozen trips in and out of the drawer and a downloads
 * folder of files someone then had to open to find out who was who. The name
 * on the file is the whole point: it is what the designer types under the
 * photo.
 */

/** One headshot that loaded, ready to hand over. */
export interface HeadshotFile {
  /** Who it is, as the bill has them (or "Performer 3" for a nameless slot). */
  performer: string;
  /** "Jane Doe.jpg" */
  fileName: string;
  /** Always an image type, so a share sheet offers to save it as a photo. */
  type: string;
  bytes: Uint8Array;
}

export interface GatheredHeadshots {
  /** In running order. */
  files: HeadshotFile[];
  /** Who has a photo on file that would not load, in running order. */
  missing: string[];
}

export interface LoadedImage {
  bytes: Uint8Array;
  type: string;
}

export function hasHeadshot(performer: Performer): boolean {
  return !!performer.photo?.trim();
}

export function countHeadshots(performers: Performer[]): number {
  return performers.filter(hasHeadshot).length;
}

/**
 * What the button says: how many it will fetch, or how far along it is.
 *
 * The one that takes the surprise guests too says so on its face, because the
 * point of leaving them out of the other is that nobody forwards them by
 * accident.
 */
export function headshotButtonLabel(
  count: number,
  progress?: { done: number; total: number } | null,
  { includesGuests = false }: { includesGuests?: boolean } = {},
): string {
  if (progress) return `Preparing ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`;
  return `Download ${count} headshot${count === 1 ? '' : 's'}${includesGuests ? ' with surprise guests' : ''}`;
}

/**
 * A name as a file name, changed only where a file system would refuse it.
 *
 * The characters Windows rejects (macOS and Linux reject fewer) go: slashes
 * and bars become a hyphen, since they usually stand between two words —
 * "AC/DC" should not come out as "ACDC" — and the rest are dropped. Control
 * characters become spaces. Everything else, accents and emoji included,
 * stays as the producer typed it.
 */
export function sanitizeFileName(name: string): string {
  const cleaned = Array.from(name.normalize('NFC'), (ch) => {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || (code >= 0x7f && code < 0xa0)) return ' ';
    if (ch === '/' || ch === '\\' || ch === '|') return '-';
    if (':*?"<>'.includes(ch)) return '';
    return ch;
  }).join('');
  // Capped well under the 255 bytes most file systems allow, counted in
  // characters so an emoji is never cut in half.
  return Array.from(cleaned.replace(/\s+/g, ' ').trim()).slice(0, 100).join('').trim();
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/pjpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'image/svg+xml': 'svg',
};

/** "image/jpeg; charset=binary" → "image/jpeg" */
function baseType(type: string): string {
  return type.split(';')[0].trim().toLowerCase();
}

/**
 * What the bytes are, from their first few, for a photo whose server called
 * it "application/octet-stream" — an image link pasted in from a storage
 * bucket, usually.
 */
function sniffExtension(bytes: Uint8Array): string | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (ascii(0, 8) === '\x89PNG\r\n\x1a\n') return 'png';
  if (ascii(0, 4) === 'GIF8') return 'gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  if (ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12);
    if (brand === 'avif' || brand === 'avis') return 'avif';
    if (['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx'].includes(brand)) return 'heic';
    if (brand === 'mif1' || brand === 'msf1') return 'heif';
  }
  return null;
}

/** The extension the file really needs: from its type, then its bytes, then JPEG — what every upload is resized to. */
export function imageExtension(type: string, bytes?: Uint8Array): string {
  return EXTENSIONS[baseType(type)] ?? (bytes && sniffExtension(bytes)) ?? 'jpg';
}

function isImage(image: LoadedImage): boolean {
  return image.bytes.length > 0 && (baseType(image.type).startsWith('image/') || sniffExtension(image.bytes) !== null);
}

function displayName(performer: Performer, position: number): string {
  return performer.name.trim() || `Performer ${position}`;
}

/**
 * The names Windows keeps for devices, in any case. Everything after the first
 * dot is ignored when it checks, so "Aux.jpg" and "Aux.Cord.jpg" are both the
 * AUX device, and Windows 10 will not extract either from a zip.
 */
const WINDOWS_DEVICE_NAME = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?=\s*(?:\.|$))/i;

/**
 * File names for a run of headshots, in the same order.
 *
 * Named exactly as the bill has them. A slot with no usable name is called by
 * its place in the running order, so "Performer 3" can be matched back to the
 * third act. Two acts with one name get "Jane Doe (2)" and so on, compared
 * without case because macOS and Windows treat "jane doe.jpg" and
 * "Jane Doe.jpg" as one file and the second would overwrite the first. An act
 * billed as a Windows device name, "Aux" or "Con", becomes "Aux (performer)",
 * or the venue on Windows is short one face.
 */
export function nameHeadshotFiles(
  shots: { name: string; position: number; type: string; bytes?: Uint8Array }[],
): string[] {
  const taken = new Set<string>();
  return shots.map((shot) => {
    const base = (sanitizeFileName(shot.name) || `Performer ${shot.position}`).replace(WINDOWS_DEVICE_NAME, '$1 (performer)');
    let name = base;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} (${n})`;
    taken.add(name.toLowerCase());
    return `${name}.${imageExtension(shot.type, shot.bytes)}`;
  });
}

/**
 * "Late Set headshots.zip", or "Late Set headshots with surprise guests.zip"
 * for the one that has them, so the two never land in Downloads under one
 * name for the wrong one to be sent on.
 */
export function zipFileName(showName?: string, { includesGuests = false }: { includesGuests?: boolean } = {}): string {
  const show = sanitizeFileName(showName ?? '');
  const guests = includesGuests ? ' with surprise guests' : '';
  return show ? `${show} headshots${guests}.zip` : `Headshots${guests}.zip`;
}

/**
 * "José-headshot.jpg" from a profile, "Café Comedy-flyer.png" from a show.
 *
 * Named by the same rule as the files in the zip. The old ASCII-only rule
 * saved José as "Jos-headshot.jpg" and 李小龙 as "comic-headshot.jpg", so the
 * designer could not tell whose face it was.
 */
export function singleImageFileName(name: string, kind: 'headshot' | 'flyer', extension: string): string {
  return `${sanitizeFileName(name) || (kind === 'headshot' ? 'comic' : 'show')}-${kind}.${extension}`;
}

/**
 * One photo's bytes, by the same route the app takes to show it.
 *
 * A `media:` reference is resolved through the encrypted media store, which
 * keeps what it has already fetched — so faces already on screen cost
 * nothing, and a second try after a dropped connection only goes back for the
 * ones that failed. Older shows may still hold a data URL, decoded here
 * because the production CSP will not fetch one; anything else is a link,
 * fetched as it is.
 *
 * Null for anything that does not arrive as an image.
 */
export async function loadHeadshot(photo: string): Promise<LoadedImage | null> {
  const url = isMediaRef(photo) ? await resolveMediaUrl(photo) : photo;
  if (!url) return null;
  if (url.startsWith('data:')) {
    const bytes = dataUrlToBytes(url);
    const comma = url.indexOf(',');
    return bytes ? { bytes, type: comma > 0 ? url.slice('data:'.length, comma).split(';')[0] : '' } : null;
  }
  const response = await fetch(url);
  if (!response.ok) return null;
  const blob = await response.blob();
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type };
}

/**
 * Run `work` over `items`, at most `limit` at a time, keeping their order.
 *
 * Each media-store photo is already a handful of chunk requests; a whole bill
 * of them at once would queue behind the browser's per-host cap and leave the
 * progress count standing still.
 */
async function inTurn<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await work(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
  return results;
}

/**
 * Fetch every headshot on the bill, and say plainly who could not be fetched.
 *
 * One photo failing does not cost the producer the others: what loaded is
 * returned, and the rest are named so they know whose to chase.
 */
export async function gatherHeadshots(
  performers: Performer[],
  load: (photo: string) => Promise<LoadedImage | null> = loadHeadshot,
  { concurrency = 3, onProgress }: { concurrency?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<GatheredHeadshots> {
  const wanted = performers
    .map((performer, i) => ({ performer, position: i + 1 }))
    .filter(({ performer }) => hasHeadshot(performer));
  let done = 0;
  const images = await inTurn(wanted, concurrency, async ({ performer }) => {
    let image: LoadedImage | null = null;
    try {
      image = await load(performer.photo!.trim());
    } catch {
      image = null;
    }
    onProgress?.(++done, wanted.length);
    return image && isImage(image) ? image : null;
  });

  const loaded: { performer: Performer; position: number; image: LoadedImage }[] = [];
  const missing: string[] = [];
  wanted.forEach(({ performer, position }, i) => {
    const image = images[i];
    if (image) loaded.push({ performer, position, image });
    else missing.push(displayName(performer, position));
  });
  const names = nameHeadshotFiles(
    loaded.map(({ performer, position, image }) => ({ name: performer.name, position, type: image.type, bytes: image.bytes })),
  );
  return {
    files: loaded.map(({ performer, position, image }, i) => {
      const type = baseType(image.type);
      const extension = imageExtension(type, image.bytes);
      return {
        performer: displayName(performer, position),
        fileName: names[i],
        type: type.startsWith('image/') ? type : `image/${extension === 'jpg' ? 'jpeg' : extension}`,
        bytes: image.bytes,
      };
    }),
    missing,
  };
}

/** "Jane", "Jane and Bo", "Jane, Bo and Cal" */
function listNames(names: string[]): string {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** What to tell the producer once it is done, or null when everything came through. */
export function exportNote(delivered: number, missing: string[]): { tone: 'alert' | 'status'; text: string } | null {
  if (missing.length === 0) return null;
  const retry = 'Check your connection and try again.';
  if (delivered === 0) {
    return {
      tone: 'alert',
      text: missing.length === 1
        ? `${missing[0]}'s headshot wouldn't load, so nothing was downloaded. ${retry}`
        : `None of the ${missing.length} headshots would load, so nothing was downloaded. ${retry}`,
    };
  }
  return {
    tone: 'status',
    text: missing.length === 1
      ? `${missing[0]} isn't included: their headshot wouldn't load. ${retry}`
      : `${listNames(missing)} aren't included: their headshots wouldn't load. ${retry}`,
  };
}

export type Delivery = 'share' | 'zip';

/**
 * Hand the photos over in a share sheet, or as one zip.
 *
 * A zip on an iPhone or iPad lands in Files, where it has to be found and
 * opened before there is a single photo to look at, and the photos then still
 * are not in Photos. The share sheet offers Save Images straight into Photos,
 * and Save to Files with the names intact. Everywhere else — a laptop, an
 * Android phone — one .zip in Downloads is the tidier thing to receive.
 *
 * An iPad asking for the desktop site says it is a Mac; it is the one "Mac"
 * with a touch screen.
 */
export function chooseDelivery({ userAgent, maxTouchPoints, canShareFiles }: {
  userAgent: string;
  maxTouchPoints: number;
  canShareFiles: boolean;
}): Delivery {
  const iPhoneOrIPad = /iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1);
  return iPhoneOrIPad && canShareFiles ? 'share' : 'zip';
}

/** Whether this browser can put these files in a share sheet at all. */
export function canShareFiles(files: File[]): boolean {
  try {
    return typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' && navigator.canShare({ files });
  } catch {
    return false;
  }
}

export type ShareOutcome = 'shared' | 'cancelled' | 'needs-tap' | 'failed';

/**
 * What a refused share means.
 *
 * Closing the sheet is an answer, not a failure. NotAllowedError is Safari
 * saying the tap that asked has gone stale: a share has to start from a
 * fresh tap, and fetching a bill of photos can outlast one. A tap on a
 * "ready" button gets it there. Anything else, the zip is the way out.
 */
export function shareFailure(error: unknown): Exclude<ShareOutcome, 'shared'> {
  const name = (error as { name?: unknown } | null)?.name;
  if (name === 'AbortError') return 'cancelled';
  if (name === 'NotAllowedError') return 'needs-tap';
  return 'failed';
}

/**
 * Open the share sheet with the photos.
 *
 * navigator.share is called before anything is awaited, so a call made from
 * a click handler is still inside that click.
 */
export async function shareHeadshots(files: File[]): Promise<ShareOutcome> {
  try {
    // Nothing but the files, so the sheet treats it as photos to save.
    await navigator.share({ files });
    return 'shared';
  } catch (error) {
    return shareFailure(error);
  }
}

/** The photos as Files, for a share sheet. */
export function asShareableFiles(files: HeadshotFile[]): File[] {
  return files.map((file) => new File([file.bytes as BlobPart], file.fileName, { type: file.type }));
}

/** One .zip of the lot. */
export function headshotZip(files: HeadshotFile[]): Blob {
  return new Blob([createZip(files.map((file) => ({ name: file.fileName, data: file.bytes })))], {
    type: 'application/zip',
  });
}
