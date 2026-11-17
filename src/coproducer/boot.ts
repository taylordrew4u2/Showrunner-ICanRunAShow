/**
 * Opening a co-producer link.
 *
 * The link page's inline script (utils/coproduceLinkPage) runs before
 * anything else on the page: on the main origin it moves the page to the
 * review origin, fragment and all; on the review origin it takes the token
 * out of the fragment, leaves it on the window and strips the address. What
 * is here picks the token up from there, keeps it on this device (sealed, on
 * the review origin only) so a reload opens the same link, and keeps a
 * co-producer's unsent changes the same way when the page is put away.
 */
import { clearLocal, openLocal, sealLocal } from '../utils/session-vault';
import { mainOrigin, reviewOrigin } from './origins';
import { validatePayload } from './schema';
import { COPRODUCER_TOKEN_GLOBAL, COPRODUCER_TOKEN_PATTERN, type EditPayload } from './types';
import { parseUntrusted } from './untrusted';

const TOKEN_KEY = 'showrunner:coproducer:v1';
const UNSENT_KEY = 'showrunner:coproducer:unsent:v1';

/** '/coproduce', in any case, with or without a trailing slash. */
export function isCoproducePath(pathname: string): boolean {
  return /^\/coproduce\/?$/i.test(pathname);
}

/** On a main origin's /coproduce: the link page's script is moving this page to the review origin. */
export function movingToReviewOrigin(at: Pick<Location, 'origin' | 'pathname'>): boolean {
  if (!isCoproducePath(at.pathname)) return false;
  const review = reviewOrigin();
  return review !== '' && at.origin !== review;
}

export type BootToken = { token: string } | { missing: true };

/**
 * The token picked up on this page, kept in memory too: the page may ask
 * twice before the first copy has been written to this device (React runs a
 * new page's effects twice in development).
 */
let pickedUp: string | null = null;

/**
 * The token the link page's script left on the window (read, then deleted,
 * then kept on this device), else the one kept last time. Never reads the
 * address: the script has already taken the token out of it.
 */
export async function takeCoproduceToken(): Promise<BootToken> {
  const holder = globalThis as unknown as Record<string, unknown>;
  const left = holder[COPRODUCER_TOKEN_GLOBAL];
  delete holder[COPRODUCER_TOKEN_GLOBAL];
  if (typeof left === 'string' && COPRODUCER_TOKEN_PATTERN.test(left)) {
    pickedUp = left;
    await saveCoproduceToken(left);
    return { token: left };
  }
  if (pickedUp) return { token: pickedUp };
  const saved = await loadCoproduceToken();
  return saved ? { token: saved } : { missing: true };
}

export function saveCoproduceToken(token: string): Promise<void> {
  return sealLocal(TOKEN_KEY, token);
}

export async function loadCoproduceToken(): Promise<string | null> {
  const saved = await openLocal(TOKEN_KEY);
  return saved !== null && COPRODUCER_TOKEN_PATTERN.test(saved) ? saved : null;
}

export function clearCoproduceToken(): void {
  pickedUp = null;
  clearLocal(TOKEN_KEY);
}

/** Changes a co-producer made and had not sent when the page was put away. */
export interface UnsentDraft {
  linkId: string;
  savedAt: string;
  payload: EditPayload;
  mediaIds: string[];
}

export function saveUnsentDraft(draft: UnsentDraft): Promise<void> {
  return sealLocal(UNSENT_KEY, JSON.stringify(draft));
}

/** The draft kept for this link, or null: none, another link's, or one that no longer reads as a change. */
export async function loadUnsentDraft(linkId: string): Promise<UnsentDraft | null> {
  const text = await openLocal(UNSENT_KEY);
  if (text === null) return null;
  try {
    const value = parseUntrusted(text) as Partial<UnsentDraft> | null;
    if (!value || typeof value !== 'object' || value.linkId !== linkId || typeof value.savedAt !== 'string') return null;
    const mediaIds = Array.isArray(value.mediaIds) && value.mediaIds.every((id) => typeof id === 'string') ? value.mediaIds : null;
    if (!mediaIds) return null;
    const checked = validatePayload(value.payload, { appOrigins: [mainOrigin(), reviewOrigin() || location.origin] });
    if (!checked.payload || checked.payload.kind !== 'edit') return null;
    return { linkId, savedAt: value.savedAt, payload: checked.payload, mediaIds };
  } catch {
    return null;
  }
}

export function clearUnsentDraft(): void {
  clearLocal(UNSENT_KEY);
}
