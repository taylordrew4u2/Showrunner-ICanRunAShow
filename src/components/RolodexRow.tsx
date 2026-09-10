import type { PotentialComic } from '../types';
import { describeGaps, performerReadiness } from '../utils/performerReadiness';
import type { ProfileLinkStatus } from '../utils/profileLink';
import { describeChanges, type ProfileChange } from '../utils/signatureImport';
import { useMediaUrl } from '../utils/useMediaUrl';

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
}: {
  comic: PotentialComic;
  onEdit: () => void;
  /** Whether a profile link has been sent, and whether it came back. */
  linkStatus: ProfileLinkStatus;
  /** The link just created for this row, shown once so it can be sent on. */
  linkUrl?: string;
  linkBusy?: boolean;
  onRequestDetails: () => void;
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

  return (
    <article className="rolodex__item">
      <div className="rolodex__item-main">
        {photoUrl ? (
          <img className="rolodex__photo" src={photoUrl} alt="" />
        ) : (
          <div className="rolodex__photo-placeholder">{comic.name.charAt(0).toUpperCase()}</div>
        )}
        <div className="rolodex__item-content">
          <p className="rolodex__name">{comic.name}</p>
          {comic.socialMedia && <p className="rolodex__meta">{comic.socialMedia}</p>}
          {walkOn && <p className="rolodex__meta">{walkOn}</p>}
          {comic.notes && <p className="rolodex__notes">{comic.notes}</p>}
        </div>
        {/* Stated as what is missing rather than a percentage: "Needs an email"
            is something you can act on, and 50% is not. */}
        {gaps.length > 0 && (
          <span className="rolodex__gaps" title={`Missing: ${describeGaps(gaps)}`}>
            Needs {describeGaps(gaps).toLowerCase()}
          </span>
        )}
        {linkStatus === 'waiting' && !linkUrl && (
          <span className="rolodex__gaps rolodex__gaps--waiting">Asked for details</span>
        )}
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
        <button className="btn btn--secondary btn--sm" type="button" onClick={onEdit}>
          Edit
        </button>
      </div>

      {/* Shown once, right after it is made: the producer's next move is
          always to send it, and a link they cannot see is a link they cannot
          paste into a message. Copied to the clipboard as well, where that
          works. */}
      {linkUrl && (
        <div className="rolodex__link">
          <input
            className="rolodex__link-url"
            readOnly
            value={linkUrl}
            aria-label={`Profile link for ${comic.name}`}
            onFocus={(e) => e.currentTarget.select()}
          />
          <span className="rolodex__link-hint">
            Copied. Send it to {comic.name} — it works once, and only for them.
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
            {pendingPhoto ? ', and a headshot' : ''}
          </span>
          {/* Shown rather than described: a photo is the one thing you can
              judge at a glance, and the flyer depends on it. */}
          {pendingPhoto && (
            <div className="rolodex__import-photo">
              <img src={pendingPhoto} alt={`Headshot sent by ${comic.name}`} />
              <span>For the flyer</span>
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
    </article>
  );
}
