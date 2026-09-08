import type { PotentialComic } from '../types';
import { describeGaps, performerReadiness } from '../utils/performerReadiness';
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
 * flags a gap on a bill flags it here, one screen earlier.
 */
export function RolodexRow({
  comic,
  onEdit,
}: {
  comic: PotentialComic;
  onEdit: () => void;
}) {
  const photoUrl = useMediaUrl(comic.photo);
  const { gaps } = performerReadiness(comic);
  const walkOn = [comic.walkOnMusicName, comic.walkOnMusicArtist].filter(Boolean).join(' — ');

  return (
    <article className="rolodex__item">
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
      <button className="btn btn--secondary btn--sm" type="button" onClick={onEdit}>
        Edit
      </button>
    </article>
  );
}
