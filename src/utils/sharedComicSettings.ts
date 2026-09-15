import type { AppSettings, PotentialComic } from '../types';
import { resolvePerformerComic } from './rolodex';
import { fillRolodexFromSignatures } from './signatureImport';
import { rolodexKey } from './rolodex';
import { generateId } from './id';

/** Connect legacy paperwork before a rename, without rewriting its signed record. */
export function normalizeComicSettings(updated: AppSettings, previous: AppSettings): AppSettings {
  let changed = false;
  const prior = new Map(previous.signatureRequests.map(request => [request.token, request]));
  let requests = updated.signatureRequests.map(request => {
    const old = prior.get(request.token);
    const comic = !request.contactId && !old?.contactId
      ? resolvePerformerComic({ id: '', name: request.signerName }, previous.potentialComics)
        ?? resolvePerformerComic({ id: '', name: request.signerName }, updated.potentialComics)
      : undefined;
    const contactId = request.contactId ?? old?.contactId ?? comic?.id;
    const profileFiled = request.profileFiled || old?.profileFiled;
    if (contactId === request.contactId && profileFiled === request.profileFiled) return request;
    changed = true;
    return { ...request, contactId, profileFiled };
  });
  const comics: PotentialComic[] = fillRolodexFromSignatures(requests, updated.potentialComics, rolodexKey, generateId)
    ?? updated.potentialComics;
  if (comics !== updated.potentialComics) changed = true;
  requests = requests.map(request => {
    if (!request.signed || request.profileFiled) return request;
    changed = true;
    return { ...request, profileFiled: true };
  });
  return changed ? { ...updated, potentialComics: comics, signatureRequests: requests } : updated;
}
