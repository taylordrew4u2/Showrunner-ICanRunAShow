/**
 * Why a headshot would not go in, and what the person can do about it.
 *
 * The signer is a performer on their phone, usually not at a desk, and often
 * not especially interested in the difference between a file format and a
 * photo. "That image could not be read" is true and useless: it tells them the
 * app has a problem and leaves them with nothing to try, so they give up and
 * the producer chases a headshot by text for a week.
 *
 * Every message here ends with something to do, and the something has to work
 * on a phone with no other software. The screenshot trick is the workhorse:
 * it turns any picture the phone can display into a plain PNG, which is why it
 * is offered for the two failures that actually happen — an iPhone HEIC, and a
 * decode that failed for reasons nobody can diagnose from here.
 */

/** Formats a browser will not decode, however cheerfully the phone offers them. */
const UNREADABLE = /(^image\/(heic|heif|avif))|(\.(heic|heif)$)/i;

const SCREENSHOT =
  'Open the photo full screen, take a screenshot of it, and choose the screenshot instead.';

export function photoProblem(file: { name?: string; type?: string; size?: number }): string | null {
  const name = file.name ?? '';
  const type = file.type ?? '';

  // An iPhone saves HEIC by default and hands it over under that name. This is
  // the single most common reason a headshot does not arrive.
  if (UNREADABLE.test(type) || UNREADABLE.test(name)) {
    return `iPhone photos saved as HEIC cannot be opened by a web page. ${SCREENSHOT} You can also change it for good in Settings → Camera → Formats → Most Compatible.`;
  }

  if (file.size === 0) {
    return 'That file came through empty, which usually means it is still downloading from iCloud or Google Photos. Open it in your photos app first, wait for it to appear, then choose it again.';
  }

  if (type && !type.startsWith('image/')) {
    return `That is a ${type.split('/')[1] || 'file'} file rather than a photo. Choose a JPEG or PNG — a screenshot of the picture works too.`;
  }

  return null;
}

/**
 * The message after the resize itself failed.
 *
 * Reached when the file claimed to be a readable image and then would not
 * decode: a truncated download, a photo too large for the phone's canvas, or a
 * format lying about its type. None of those can be told apart from here, and
 * all of them are fixed by the same move.
 */
export function photoFailureMessage(file?: { name?: string; type?: string; size?: number }): string {
  const known = file ? photoProblem(file) : null;
  if (known) return known;
  return `That photo could not be read on this device. ${SCREENSHOT} If it still will not go, a smaller photo or a different one will.`;
}
