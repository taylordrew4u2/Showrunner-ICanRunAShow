import { noTapeSign } from '../../coproducer/newComics';
import './coproducer.css';

/**
 * The sign a co-producer is shown every time they try to add or send someone
 * new with no tape: "Sorry, you can't submit without a tape.", with who it
 * is for when that is known. A warning mark beside the words, so it is never
 * told by colour alone. It does not go away by itself: whoever shows it
 * takes it down once the tape is there.
 */
export function NoTapeSign({ names, also, attempt, id, alert = true }: {
  /** Who has no tape, when the sign is about a change rather than the form in hand. */
  names?: readonly string[];
  /** One more short line said with it (the tape's length is missing too). */
  also?: string;
  /** Which try this is. A sign keyed by it is a new one each time, so it is read out again. */
  attempt?: number;
  id?: string;
  /** False inside a region that is already live, which reads it out itself. */
  alert?: boolean;
}) {
  return (
    <p className="no-tape-sign" role={alert ? 'alert' : undefined} id={id} data-attempt={attempt}>
      <svg className="no-tape-sign__icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="M12 3 2 20h20L12 3z" />
        <path d="M12 10v4" />
        <path d="M12 17h.01" />
      </svg>
      <span className="no-tape-sign__text">
        {noTapeSign(names)}
        {also && <span className="no-tape-sign__also"> {also}</span>}
      </span>
    </p>
  );
}
