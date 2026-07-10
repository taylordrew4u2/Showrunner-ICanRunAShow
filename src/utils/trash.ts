import type { Show } from '../types';

/**
 * Trash lives inside the settings blob, and the whole settings blob is saved
 * to the backend in a single request with a hard ~4.5 MB ceiling. A deleted
 * show can still carry embedded base64 audio (legacy walk-on tracks and cue
 * music saved before audio moved to the media store) — copying that into
 * trash verbatim can make settings permanently unsavable, which silently
 * breaks every settings write (and the deletion record itself). So trash
 * keeps the show's *content* but drops the embedded binaries: names, links,
 * and metadata survive; data: URLs don't.
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
    performers: (show.performers || []).map((p) => ({
      ...p,
      walkOnMusic: drop(p.walkOnMusic),
    })),
    artists: (show.artists || []).map((a) => ({
      ...a,
      walkOnMusic: drop(a.walkOnMusic),
    })),
    schedule: (show.schedule || []).map((s) => ({ ...s, music: drop(s.music) })),
  };
}
