import type { TrackPreview } from '../utils/useTrackPreview';
import { Icon } from './Icon';

/**
 * The round play/stop button on an uploaded track. State and playback live in
 * useTrackPreview — one per list, so two rows can never both claim to be
 * playing.
 */
export function TrackPreviewButton({
  src,
  title,
  preview,
}: {
  src: string;
  title: string;
  preview: TrackPreview;
}) {
  const playing = preview.playingSrc === src;
  return (
    <button
      type="button"
      className={`track-preview ${playing ? 'track-preview--playing' : ''}`}
      onClick={() => preview.toggle(src)}
      aria-pressed={playing}
      aria-label={playing ? `Stop ${title}` : `Play ${title}`}
      title={playing ? `Stop ${title}` : `Play ${title}`}
    >
      <Icon name={playing ? 'pause' : 'play'} size={16} />
    </button>
  );
}
