import { TAPE_MINUTES, tapeLengthLabel, type TapeMinutes } from '../../coproducer/newComics';

/**
 * How long the set in someone's video is: a five-minute tape or a ten-minute
 * one. Sits under the video link on every profile. Optional for the owner; a
 * co-producer adding someone new has to say which.
 */
export function TapeLength({ id, value, onChange }: {
  id: string;
  value: TapeMinutes | undefined;
  onChange: (minutes: TapeMinutes | undefined) => void;
}) {
  return (
    <>
      <label className="perf-profile__media-label" htmlFor={id}>Tape length</label>
      <select
        id={id}
        className="perf-profile__input"
        value={value ?? ''}
        onChange={(e) => {
          const minutes = Number(e.target.value);
          onChange(TAPE_MINUTES.find((length) => length === minutes));
        }}
      >
        <option value="">Not set</option>
        {TAPE_MINUTES.map((minutes) => (
          <option key={minutes} value={minutes}>{tapeLengthLabel(minutes)}</option>
        ))}
      </select>
    </>
  );
}
