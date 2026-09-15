/**
 * A signature that has been given but not yet delivered.
 *
 * The signing page used to end a bad connection by telling the performer it
 * had not gone through. That is the one answer they can do nothing useful
 * with: they are in a basement, the bars are not coming back before doors, and
 * the agreement is still unsigned as far as the producer can see.
 *
 * So a submission that cannot reach the server is kept here instead of being
 * refused. It survives the page closing, goes out again the moment the browser
 * says it is back online, and is retried on a timer in between. The signer is
 * told it is signed and waiting to send — which is true — rather than that
 * they cannot sign.
 *
 * What is stored is the ciphertext that was going to be posted, exactly as it
 * was going to be posted. The server could not read it and neither can this;
 * the key that opens it only ever exists in the link's fragment, which is why
 * resuming needs nothing but the bytes and the token.
 */

const PREFIX = 'showrunner:pending-signature:';

export interface PendingSignature {
  /** The encrypted signature, ready to post unchanged. */
  signature: string;
  /** When it was signed, for telling them how long it has been waiting. */
  savedAt: string;
}

export function savePendingSignature(token: string, signature: string): boolean {
  if (!token || !signature) return false;
  try {
    const entry: PendingSignature = { signature, savedAt: new Date().toISOString() };
    localStorage.setItem(PREFIX + token, JSON.stringify(entry));
    return true;
  } catch {
    /*
     * Out of room, or a private window. Nothing else changes: the page keeps
     * retrying for as long as it is open, it just cannot also survive being
     * closed. Never a reason to fail the submission.
     */
    return false;
  }
}

export function loadPendingSignature(token: string): PendingSignature | null {
  if (!token) return null;
  try {
    const raw = localStorage.getItem(PREFIX + token);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const entry = parsed as PendingSignature;
    if (!entry || typeof entry.signature !== 'string' || !entry.signature) return null;
    return { signature: entry.signature, savedAt: typeof entry.savedAt === 'string' ? entry.savedAt : '' };
  } catch {
    return null;
  }
}

export function clearPendingSignature(token: string): void {
  try {
    localStorage.removeItem(PREFIX + token);
  } catch {
    /* nothing depends on this succeeding */
  }
}

/**
 * How long to wait before trying a held signature again.
 *
 * Quick at first, because most of these are a lift door or a tunnel, then
 * slowing to something that can sit in a background tab all evening without
 * being a nuisance. Never gives up: giving up is the behaviour being removed.
 */
export function retryDelayMs(attempt: number): number {
  const seconds = [2, 5, 10, 20, 30, 60];
  return 1000 * (seconds[Math.min(attempt, seconds.length - 1)] ?? 60);
}
