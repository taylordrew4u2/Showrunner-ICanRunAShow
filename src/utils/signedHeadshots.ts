import type { AppSettings, PotentialComic, SignatureRequest } from '../types';
import { dataUrlToFile } from './media';
import { generateId } from './id';
import { rolodexKey } from './rolodex';
import { applyFiledHeadshot, headshotsToFile } from './signatureImport';

/**
 * Move every headshot that came back signed into the media store and, where
 * the person has no picture yet, onto their Rolodex entry.
 *
 * This used to run only when the producer opened the Contracts page. But a
 * signature is just as often found from the show page or a performer's
 * profile, and those looked for the signature without filing the photo — so
 * the face someone sent with their contract sat as a data URL on the signed
 * record, invisible, until the Contracts page happened to be opened. Now it
 * runs wherever signatures are refreshed.
 *
 * An entry that already has a photo keeps it: the filed copy stays on the
 * record as a stored reference, and the Contracts page offers it as a
 * replacement. Nothing chosen by the producer is displaced without asking.
 *
 * Returns the settings fields to write, or null when there was nothing to do.
 * A photo that will not upload is left exactly where it is — the data URL
 * stays on the record and the next refresh tries again. Losing the only copy
 * of someone's face to a dropped connection is not a trade worth making.
 */
export async function fileSignedHeadshots(
  requests: SignatureRequest[],
  comics: PotentialComic[],
  upload: (file: File) => Promise<string>,
  newId: () => string = generateId,
): Promise<Pick<AppSettings, 'potentialComics' | 'signatureRequests'> | null> {
  const pending = headshotsToFile(requests, comics, rolodexKey);
  if (pending.length === 0) return null;

  let next = comics;
  const refs = new Map<string, string>();
  for (const shot of pending) {
    try {
      const file = dataUrlToFile(shot.dataUrl, `${shot.name || 'headshot'}.jpg`);
      if (!file) continue;
      const ref = await upload(file);
      refs.set(shot.token, ref);
      next = applyFiledHeadshot(next, shot, ref, newId);
    } catch {
      // Left on the record to retry. Nothing is lost by failing here.
    }
  }
  if (refs.size === 0) return null;

  return {
    potentialComics: next,
    signatureRequests: requests.map((r) =>
      refs.has(r.token) && r.signed
        ? { ...r, signed: { ...r.signed, headshot: refs.get(r.token) } }
        : r,
    ),
  };
}
