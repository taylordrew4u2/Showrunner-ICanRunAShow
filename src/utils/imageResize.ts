/**
 * Shrinking a photo before it's stored.
 *
 * A performer photo is displayed at 68px on the Run Show board and 110px on
 * the profile. A phone camera hands us 4000px and four megabytes of it. Every
 * one of those bytes would be encrypted, chunked, uploaded, and then fetched
 * and decrypted again on show day over whatever the venue calls wifi — for a
 * thumbnail. So the photo is resized in the browser first and only the small
 * version is ever stored.
 */

import { dataUrlToFile, readFileAsDataURL } from './media';

/** Longest edge kept, in pixels. 2× the largest place a photo is displayed. */
export const AVATAR_MAX_DIM = 640;

/**
 * Longest edge for a headshot a performer sends in for the flyer.
 *
 * Bigger than an avatar because this one leaves the app: it goes on a poster
 * and into a social post, where 640px is visibly soft. Still bounded, because
 * it travels through the same encrypt-and-chunk path as everything else and
 * the person uploading it is on a phone.
 */
export const FLYER_MAX_DIM = 1400;

/**
 * Smaller and smaller, for a photo the server will not take.
 *
 * Tried in order when a submission comes back too large. The server is the
 * judge of what fits — the payload is encrypted before it is sent, so its
 * final size is not something the page can work out in advance — which is why
 * this is a ladder to walk down rather than one calculation.
 */
export const HEADSHOT_FALLBACK_DIMS = [900, 600, 400] as const;
const JPEG_QUALITY = 0.82;

/**
 * The size an image becomes when it has to fit inside a `max` box, keeping its
 * aspect ratio. An image already inside the box is left alone — upscaling
 * would add bytes and no detail.
 */
export function fitWithin(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const longest = Math.max(width, height);
  if (longest <= max) return { width: Math.round(width), height: Math.round(height) };
  const scale = max / longest;
  return {
    // A very wide image can round its short edge to 0, which canvas rejects.
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Decode a file to something drawable, preferring the path that doesn't leak. */
async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; release: () => void }> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not read that image'));
      el.src = url;
    });
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

/**
 * Resize `file` to fit `maxDim` and re-encode it as JPEG. Throws if the browser
 * can't decode the image — an iPhone HEIC outside Safari is the usual case, and
 * the caller turns that into "try a JPEG or PNG".
 */
export async function downscaleImage(file: File, maxDim = AVATAR_MAX_DIM): Promise<File> {
  const { source, width, height, release } = await decode(file);
  try {
    const size = fitWithin(width, height, maxDim);
    if (!size.width || !size.height) throw new Error('Could not read that image');
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not read that image');
    ctx.drawImage(source, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    );
    if (!blob) throw new Error('Could not read that image');
    const name = file.name.replace(/\.[^.]+$/, '') || 'photo';
    return new File([blob], `${name}.jpg`, { type: 'image/jpeg' });
  } finally {
    release();
  }
}

/**
 * Re-encode a data URL at a smaller size, as a data URL.
 *
 * A signer's headshot only ever exists as a data URL — it was read from their
 * camera roll, downscaled once, and is held in memory as text — so shrinking
 * it again means going back out to a File and in again. Null if it cannot be
 * read, which the caller treats as "send without the photo".
 */
export async function shrinkDataUrl(dataUrl: string, maxDim: number): Promise<string | null> {
  try {
    const file = dataUrlToFile(dataUrl, 'headshot');
    if (!file) return null;
    const smaller = await downscaleImage(file, maxDim);
    return await readFileAsDataURL(smaller);
  } catch {
    return null;
  }
}
