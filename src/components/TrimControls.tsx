import { useEffect, useRef, useState } from 'react';
import { audioEngine } from '../utils/audioEngine';
import { formatTimecode, parseTimecode, trimmedLength } from '../utils/trim';
import './TrimControls.css';

interface TrimControlsProps {
  /** The audio this trim applies to, so the preview can play the real thing. */
  src?: string;
  startSec?: number;
  endSec?: number;
  onChange: (trim: { startSec?: number; endSec?: number }) => void;
}

/**
 * Set where a song starts and stops.
 *
 * The preview is the point of this control, not a nicety: a producer can read
 * "1:12" off a music player, but whether the cut lands on the beat is not
 * something you can tell by looking at a number. This plays exactly what the
 * soundboard button will play, so the answer is a press away.
 */
export function TrimControls({ src, startSec, endSec, onChange }: TrimControlsProps) {
  // Held as text while being typed: "1:2" is halfway to "1:23" and must not be
  // snapped to 1 minute 2 seconds under the producer's fingers.
  const [startText, setStartText] = useState(() => formatTimecode(startSec));
  const [endText, setEndText] = useState(() => formatTimecode(endSec));
  const [previewing, setPreviewing] = useState(false);
  const previewTimer = useRef<number | null>(null);

  // Follow the record when it changes underneath — a different song being
  // edited, or a change made elsewhere. Adjusted during render rather than in
  // an effect: an effect would paint the old timecode for a frame first, and
  // React re-runs this render before committing anything.
  const [lastStart, setLastStart] = useState(startSec);
  if (startSec !== lastStart) {
    setLastStart(startSec);
    setStartText(formatTimecode(startSec));
  }
  const [lastEnd, setLastEnd] = useState(endSec);
  if (endSec !== lastEnd) {
    setLastEnd(endSec);
    setEndText(formatTimecode(endSec));
  }

  useEffect(() => () => {
    if (previewTimer.current !== null) window.clearTimeout(previewTimer.current);
  }, []);

  const startInvalid = startText.trim() !== '' && parseTimecode(startText) == null;
  const endInvalid = endText.trim() !== '' && parseTimecode(endText) == null;
  const length = trimmedLength(startSec, endSec);
  // Only worth flagging once both ends are real numbers — mid-typing, "end
  // before start" is just an unfinished edit.
  const backwards =
    startSec != null && endSec != null && !startInvalid && !endInvalid && endSec <= startSec;

  function commit(which: 'start' | 'end', text: string) {
    const trimmed = text.trim();
    const value = trimmed === '' ? undefined : parseTimecode(trimmed) ?? undefined;
    // An unparseable entry leaves the stored value alone rather than wiping it.
    if (trimmed !== '' && value == null) return;
    onChange(which === 'start' ? { startSec: value, endSec } : { startSec, endSec: value });
  }

  function stopPreview() {
    if (previewTimer.current !== null) {
      window.clearTimeout(previewTimer.current);
      previewTimer.current = null;
    }
    audioEngine.stop({ fadeMs: 120 });
    setPreviewing(false);
  }

  function togglePreview() {
    if (previewing) {
      stopPreview();
      return;
    }
    if (!src) return;
    setPreviewing(true);
    audioEngine.play(src, {
      fadeInMs: 0,
      fadeOutMs: 120,
      offsetSec: startSec,
      durationSec: length ?? undefined,
      onEnded: () => setPreviewing(false),
    });
    // A song with no out-point would otherwise run the whole track from this
    // little row. Cap the audition; the real button plays it in full.
    const capMs = ((length ?? 15) + 0.3) * 1000;
    previewTimer.current = window.setTimeout(() => {
      previewTimer.current = null;
      stopPreview();
    }, capMs);
  }

  return (
    <div className="trim">
      <div className="trim__fields">
        <label className="trim__field">
          <span className="trim__label">Starts at</span>
          <input
            className={`trim__input${startInvalid ? ' trim__input--invalid' : ''}`}
            value={startText}
            onChange={(e) => setStartText(e.target.value)}
            onBlur={() => commit('start', startText)}
            onKeyDown={(e) => e.key === 'Enter' && commit('start', startText)}
            placeholder="0:00"
            inputMode="numeric"
            aria-label="Start time"
            aria-invalid={startInvalid || undefined}
          />
        </label>
        <label className="trim__field">
          <span className="trim__label">Ends at</span>
          <input
            className={`trim__input${endInvalid || backwards ? ' trim__input--invalid' : ''}`}
            value={endText}
            onChange={(e) => setEndText(e.target.value)}
            onBlur={() => commit('end', endText)}
            onKeyDown={(e) => e.key === 'Enter' && commit('end', endText)}
            placeholder="end of track"
            inputMode="numeric"
            aria-label="End time"
            aria-invalid={endInvalid || backwards || undefined}
          />
        </label>
        {src && (
          <button
            type="button"
            className="btn btn--secondary btn--sm trim__preview"
            onClick={togglePreview}
          >
            {previewing ? 'Stop' : 'Hear it'}
          </button>
        )}
      </div>
      <p className="trim__hint">
        {startInvalid || endInvalid
          ? 'Use mm:ss — 1:23 — or just the number of seconds.'
          : backwards
            ? 'The end is before the start, so the whole track will play.'
            : length != null
              ? `Plays ${formatTimecode(length)} of the track.`
              : 'Leave blank to play the whole track.'}
      </p>
    </div>
  );
}
