import { monogramInitials, monogramTone } from '../utils/rolodexDisplay';
import { useMediaUrl } from '../utils/useMediaUrl';

/**
 * The face beside a Rolodex name: the headshot when there is one, their
 * initials on a quiet tint when there is not. One disc for both, so a list
 * with three photos in it still reads as one column.
 *
 * Decoration only. The name is always written out beside it, so neither the
 * photo nor the letters are announced a second time.
 */
export function RolodexAvatar({ name, photo, size }: {
  name: string;
  /** Headshot (media store reference), if one is filed. */
  photo?: string;
  /** The row's disc by default; "lg" for the head of the profile drawer. */
  size?: 'lg';
}) {
  const photoUrl = useMediaUrl(photo);
  const sized = size ? ` rolodex__avatar--${size}` : '';
  if (photoUrl) {
    return <img className={`rolodex__photo rolodex__avatar${sized}`} src={photoUrl} alt="" />;
  }
  return (
    <span
      className={`rolodex__photo-placeholder rolodex__avatar rolodex__monogram${sized}`}
      data-tone={monogramTone(name)}
      aria-hidden="true"
    >
      {monogramInitials(name)}
    </span>
  );
}
