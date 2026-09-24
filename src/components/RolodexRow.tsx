import { useState } from 'react';
import type { PotentialComic, ProfileRequest } from '../types';
import { describeGaps, performerReadiness } from '../utils/performerReadiness';
import { profileUrl, type ProfileLinkStatus } from '../utils/profileLink';
import { describeChanges, type ProfileChange } from '../utils/signatureImport';
import { useMediaUrl } from '../utils/useMediaUrl';
import { useConfirm } from './useConfirm';

/**
 * The address a row can put back on screen for a link still out asking.
 *
 * The one just made, when there is one; otherwise rebuilt from the request
 * on file. The link used to live only in the page's memory, shown once — so a
 * producer who switched to Messages before pasting, or whose phone dropped
 * the app, came back to "Asked for details" with nothing to send and no way
 * to ask again until an answer arrived. The token and key were filed all
 * along; this is what turns them back into the link.
 *
 * Nothing once it is answered: that link is used up.
 *
 * Exported so a test can pin the rule. The lint rule minds exports it has to
 * re-render, and this one has no UI of its own.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function shownProfileUrl(
  origin: string,
  status: ProfileLinkStatus,
  request: ProfileRequest | undefined,
  freshUrl?: string,
): string | undefined {
  if (freshUrl) return freshUrl;
  if (status !== 'waiting' || !request || request.submitted) return undefined;
  return profileUrl(origin, request.token, request.key);
}

/**
 * One person in the Rolodex.
 *
 * Its own component because the row now shows a headshot, and resolving a
 * media reference is a hook — which cannot be called inside a `.map` in the
 * page that renders the list.
 *
 * The row says what is missing. This is the list a producer builds a lineup
 * from, and until now it said only a name, so you would book someone and find
 * out at contract time that you have no address for them. The same rule that
 * flags a gap on a bill flags it here, one screen earlier — and beside the gap
 * sits the way to close it: a link that asks the person themselves.
 */
export function RolodexRow({
  comic,
  onEdit,
  linkStatus,
  linkUrl,
  linkBusy,
  onRequestDetails,
  pending,
  onImport,
  onSkipImport,
  linkError,
  pendingPhoto,
  request,
  onWithdraw,
}: {
  comic: PotentialComic;
  onEdit: () => void;
  /** Whether a profile link has been sent, and whether it came back. */
  linkStatus: ProfileLinkStatus;
  /** The link just created for this row, shown as soon as it is made. */
  linkUrl?: string;
  linkBusy?: boolean;
  onRequestDetails: () => void;
  /** The link still out asking, as filed, so it can be shown again later. */
  request?: ProfileRequest;
  /** Withdraw that link: stop it working and drop it, so the ask comes back. */
  onWithdraw?: () => void | Promise<void>;
  /** What their answers would change on the profile, once they have replied. */
  pending?: ProfileChange[];
  onImport?: () => void;
  onSkipImport?: () => void;
  /** Why the last attempt to make a link failed, if it did. */
  linkError?: string;
  /** The headshot that came with their reply, opened, if they sent one. */
  pendingPhoto?: string;
}) {
  const photoUrl = useMediaUrl(comic.photo);
  const { gaps } = performerReadiness(comic);
  const walkOn = [comic.walkOnMusicName, comic.walkOnMusicArtist].filter(Boolean).join(' — ');
  const { confirm, confirmDialog } = useConfirm();

  const url = shownProfileUrl(window.location.origin, linkStatus, request, linkUrl);
  // A link just made is open on the row; one brought back after a reload is
  // behind "Show link", so a Rolodex with a dozen links out is still a list
  // of people rather than a list of addresses.
  const [revealed, setRevealed] = useState(false);
  const linkOpen = Boolean(url) && (Boolean(linkUrl) || revealed);
  const [copied, setCopied] = useState<'no' | 'yes' | 'failed'>('no');
  const [withdrawing, setWithdrawing] = useState(false);

  // Copied here, on the tap, rather than claimed. The page's own write
  // happens after the link is made — outside the gesture, where iOS Safari
  // refuses it without a word — and the row used to say "Copied." either way.
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied('yes');
    } catch {
      setCopied('failed');
    }
    setTimeout(() => setCopied('no'), 2500);
  }

  async function withdraw() {
    if (!onWithdraw) return;
    const go = await confirm({
      message: `Withdraw ${comic.name}'s link? It stops working straight away. You can ask again after.`,
      confirmLabel: 'Withdraw',
    });
    if (!go) return;
    setWithdrawing(true);
    try {
      await onWithdraw();
      setRevealed(false);
    } finally {
      setWithdrawing(false);
    }
  }

  return (
    <article className="rolodex__item">
      <div className="rolodex__item-main">
        <button className="rolodex__open-profile" type="button" onClick={onEdit}
          aria-label={`Open ${comic.name}'s full profile`}>
        {photoUrl ? (
          <img className="rolodex__photo" src={photoUrl} alt="" />
        ) : (
          <span className="rolodex__photo-placeholder">{comic.name.charAt(0).toUpperCase()}</span>
        )}
        <span className="rolodex__item-content">
          <span className="rolodex__name">{comic.name}</span>
          {/* Stated as what is missing rather than a percentage: "Needs an
              email" is something you can act on, and 50% is not.

              It belongs under the name, with the rest of what is known about
              this person, rather than out on the row as its own column. On a
              phone that column plus the two buttons left the name nothing:
              a list of contacts rendered as single initials with no names
              at all. */}
          {gaps.length > 0 && (
            <span className="rolodex__gaps" title={`Missing: ${describeGaps(gaps)}`}>
              Needs {describeGaps(gaps).toLowerCase()}
            </span>
          )}
          {linkStatus === 'waiting' && !linkUrl && (
            <span className="rolodex__gaps rolodex__gaps--waiting">Asked for details</span>
          )}
          {comic.socialMedia && <span className="rolodex__meta">{comic.socialMedia}</span>}
          {walkOn && <span className="rolodex__meta">{walkOn}</span>}
          {comic.notes && <span className="rolodex__notes">{comic.notes}</span>}
        </span>
        </button>
        {/* Offered where there is a gap to close and nothing already out
            asking. A link for someone whose profile is complete is a chore
            for them and a chase for you, and there is nothing at the end of
            it. */}
        {gaps.length > 0 && linkStatus === null && (
          <button
            className="btn btn--ghost btn--sm"
            type="button"
            onClick={onRequestDetails}
            disabled={linkBusy}
          >
            {linkBusy ? 'Making link…' : 'Ask for details'}
          </button>
        )}
        {/* The way back to a link that is out asking. Same spot as the ask,
            so the row never carries more than two buttons on a phone. */}
        {linkStatus === 'waiting' && !linkUrl && url && (
          <button
            className="btn btn--ghost btn--sm"
            type="button"
            onClick={() => setRevealed((r) => !r)}
          >
            {revealed ? 'Hide link' : 'Show link'}
          </button>
        )}
        <button className="btn btn--secondary btn--sm" type="button" onClick={onEdit}>
          Edit
        </button>
      </div>

      {/* Shown right after it is made: the producer's next move is always to
          send it, and a link they cannot see is a link they cannot paste into
          a message. Shown again on request while it is still out, for the
          send that did not happen the first time. */}
      {linkOpen && url && (
        <div className="rolodex__link">
          <input
            className="rolodex__link-url"
            readOnly
            value={url}
            aria-label={`Profile link for ${comic.name}`}
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            className="btn btn--secondary btn--sm"
            type="button"
            onClick={() => void copy(url)}
          >
            {copied === 'yes' ? 'Copied' : 'Copy link'}
          </button>
          {onWithdraw && (
            <button
              className="btn btn--ghost btn--sm"
              type="button"
              onClick={() => void withdraw()}
              disabled={withdrawing}
            >
              {withdrawing ? 'Withdrawing…' : 'Withdraw'}
            </button>
          )}
          <span className="rolodex__link-hint" role="status">
            {copied === 'failed'
              ? "Couldn't reach the clipboard — select the link above and copy it."
              : `Send it to ${comic.name} — it works once, and only for them.`}
          </span>
        </div>
      )}

      {linkError && (
        <p className="rolodex__link-error" role="alert">{linkError}</p>
      )}

      {/* Their answers, offered rather than applied. Same rule as a signed
          contract's: nothing is written until the producer says so. Shown
          even when nothing would change, so the reply can be let go and the
          row does not sit "answered" with nothing to press. */}
      {pending && (
        <div className="rolodex__import">
          <span className="rolodex__import-head">
            {comic.name} sent their details — {describeChanges(pending)}
            {pendingPhoto ? (comic.photo ? ', and a new headshot' : ', and a headshot') : ''}
          </span>
          {/* Shown rather than described: a photo is the one thing you can
              judge at a glance, and the flyer depends on it. */}
          {pendingPhoto && (
            <div className="rolodex__import-photo">
              <img src={pendingPhoto} alt={`Headshot sent by ${comic.name}`} />
              <span>{comic.photo ? 'Replaces the photo on their profile' : 'For the flyer'}</span>
            </div>
          )}
          <ul className="rolodex__import-list">
            {pending.map((c) => (
              <li key={c.key}>
                <span className="rolodex__import-label">{c.label}</span>
                {c.from && <span className="rolodex__import-was">{c.from}</span>}
                <span className="rolodex__import-new">{c.to}</span>
              </li>
            ))}
          </ul>
          <div className="rolodex__import-actions">
            {(pending.length > 0 || pendingPhoto) && (
              <button className="btn btn--secondary btn--sm" type="button" onClick={onImport}>
                Save to profile
              </button>
            )}
            <button className="btn btn--ghost btn--sm" type="button" onClick={onSkipImport}>
              {pending.length > 0 || pendingPhoto ? 'Skip' : 'Dismiss'}
            </button>
          </div>
        </div>
      )}
      {confirmDialog}
    </article>
  );
}
