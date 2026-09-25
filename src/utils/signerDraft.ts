/**
 * What a signer has typed, kept on their own device until it is sent.
 *
 * Everything on the signing page lived in React state and nowhere else, so a
 * reload lost it: a dropped connection, a phone killing a backgrounded tab, a
 * mistaken back gesture, a browser reclaiming memory while they went to find
 * their credit list. They came back to an empty form and had to type a long
 * agreement's worth of answers again — which is where someone stops and texts
 * the producer instead.
 *
 * Their device only. This never goes near the network, which is the point: the
 * server holds ciphertext it cannot read, and a draft of the answers is
 * exactly the plaintext it must not be given. Keyed by the link's token so two
 * contracts open on one phone cannot overwrite each other.
 *
 * The profile page keeps what a performer typed here too, for the same reason.
 * Its tokens come from the same generator as a contract's, so the two kinds of
 * link cannot collide.
 *
 * The headshot is deliberately not kept. A data URL is megabytes and would
 * exhaust the storage quota, taking the typed answers with it — and picking a
 * photo again is one tap, where retyping a credit list is not.
 */

const PREFIX = 'showrunner:signing:';

export interface SignerDraft {
  /** Their name, as edited. */
  signerName?: string;
  /** The signature they typed. */
  typedName?: string;
  /** Answers keyed by field id, as the page holds them. */
  values?: Record<string, string>;
  agreed?: boolean;
  /** The day-of cancellation rule, ticked. */
  ruleAgreed?: boolean;
}

/** Keep what they have typed so far. Silent on failure — this is a courtesy. */
export function saveSignerDraft(token: string, draft: SignerDraft): void {
  if (!token) return;
  try {
    localStorage.setItem(PREFIX + token, JSON.stringify(draft));
  } catch {
    /* private mode, or a full quota. The form still works; it just forgets. */
  }
}

/** What they had typed, if anything survived. */
export function loadSignerDraft(token: string): SignerDraft | null {
  if (!token) return null;
  try {
    const raw = localStorage.getItem(PREFIX + token);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const draft = parsed as SignerDraft;
    // Written by an older version, or by hand. Take only what fits.
    return {
      signerName: typeof draft.signerName === 'string' ? draft.signerName : undefined,
      typedName: typeof draft.typedName === 'string' ? draft.typedName : undefined,
      values:
        draft.values && typeof draft.values === 'object'
          ? Object.fromEntries(
              Object.entries(draft.values).filter(([, v]) => typeof v === 'string'),
            )
          : undefined,
      agreed: draft.agreed === true,
      ruleAgreed: draft.ruleAgreed === true,
    };
  } catch {
    return null;
  }
}

/** Once it is signed the draft is worth nothing and is nobody's business. */
export function clearSignerDraft(token: string): void {
  try {
    localStorage.removeItem(PREFIX + token);
  } catch {
    /* nothing to do about it, and nothing depends on it */
  }
}
