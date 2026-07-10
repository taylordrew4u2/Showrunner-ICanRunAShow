import type { Show } from '../types';

/**
 * Trash lives inside the settings blob, and the whole settings blob is saved
 * to the backend in a single request with a hard ~4.5 MB ceiling. A deleted
 * show can carry megabytes of embedded base64 media (walk-on tracks, photos,
 * videos, files) — copying that into trash verbatim can make settings
 * permanently unsavable, which silently breaks every settings write (and the
 * deletion record itself). So trash keeps the show's *content* but drops the
 * embedded binaries: names, links, and metadata survive; data: URLs don't.
 */

/** How many deleted shows the trash retains (newest first). */
export const MAX_TRASH_ITEMS = 20;

const isEmbedded = (value?: string): boolean => !!value && value.startsWith('data:');
/** Drop embedded data: URLs but keep plain links/URIs untouched. */
const drop = (value?: string): string | undefined => (isEmbedded(value) ? undefined : value);

/**
 * Return a copy of the show with all embedded base64 media removed, safe to
 * store in trash. Restoring from trash brings back everything except the
 * uploaded binaries.
 */
export function stripShowMediaForTrash(show: Show): Show {
  return {
    ...show,
    flyer: drop(show.flyer),
    scheduleImage: drop(show.scheduleImage),
    artistFlashImage: drop(show.artistFlashImage),
    artistScheduleImage: drop(show.artistScheduleImage),
    // Files are pure uploads — without their data there is nothing to restore.
    files: [],
    performers: (show.performers || []).map((p) => ({
      ...p,
      photo: drop(p.photo),
      photos: (p.photos || []).filter((ph) => !isEmbedded(ph)),
      walkOnMusic: drop(p.walkOnMusic),
      video: drop(p.video),
    })),
    artists: (show.artists || []).map((a) => ({
      ...a,
      photo: drop(a.photo),
      walkOnMusic: drop(a.walkOnMusic),
      video: drop(a.video),
      file: drop(a.file),
    })),
    schedule: (show.schedule || []).map((s) => ({ ...s, music: drop(s.music) })),
    hosts: (show.hosts || []).map((h) => ({ ...h, photo: drop(h.photo) })),
    vendors: (show.vendors || []).map((v) => ({ ...v, photo: drop(v.photo) })),
    expenses: (show.expenses || []).map((e) => ({ ...e, receiptPhoto: drop(e.receiptPhoto) })),
  };
}
