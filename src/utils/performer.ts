import type { Performer } from '../types';

/**
 * Keep the legacy `photo` (cover) field in sync with `photos[0]` so every
 * consumer that still reads `photo` (list thumbnails, PDF export, Run Show,
 * the public viewer) always agrees with the gallery's cover photo.
 *
 * Also normalizes an empty `photos` array to `undefined`. Returns the same
 * reference when nothing needs to change.
 */
export function syncPerformerCover(p: Performer): Performer {
  const photos = p.photos && p.photos.length ? p.photos : undefined;
  const photo = photos ? photos[0] : p.photo;
  if (photos === p.photos && photo === p.photo) return p;
  return { ...p, photos, photo };
}
