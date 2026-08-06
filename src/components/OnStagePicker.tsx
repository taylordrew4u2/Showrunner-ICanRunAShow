import { useEffect, useRef, useState } from 'react';
import type { Performer, PotentialComic } from '../types';

/**
 * Who's on stage for a cue — one control, everywhere a cue is edited.
 *
 * There used to be a text box called "On stage" with a separate dropdown
 * beside it, and the AI import screen had the text box alone. So the same
 * question was asked two ways in one place and one way in the other, and only
 * the dropdown produced the link Run Show needs to put a face and a walk-on on
 * the soundboard. Typing a name is an option inside this control rather than a
 * rival to it.
 */

/** Sentinel values for people with no performer record to link to. */
const HOST_OPTION = 'host:';
const CUSTOM_OPTION = 'custom:';

export interface OnStageValue {
  performer?: string;
  performerId?: string;
}

interface OnStagePickerProps {
  value: OnStageValue;
  /** This show's bill. */
  performers: Performer[];
  /** Everyone on file who isn't booked on this show yet. */
  unbookedComics?: PotentialComic[];
  /** Who's hosting, from the Host field on the show. */
  host?: string;
  /**
   * Book someone from the Rolodex onto this show and hand back their new
   * record, so the cue can link to it. Without it the Rolodex group is hidden,
   * because picking from it would have nothing to attach.
   */
  onBookPerformer?: (comic: PotentialComic) => Performer;
  onChange: (next: OnStageValue) => void;
  selectClassName?: string;
  inputClassName?: string;
  /** Enter in the name box. */
  onSubmit?: () => void;
  /** Escape in the name box. */
  onCancel?: () => void;
}

export function OnStagePicker({
  value,
  performers,
  unbookedComics = [],
  host,
  onBookPerformer,
  onChange,
  selectClassName,
  inputClassName,
  onSubmit,
  onCancel,
}: OnStagePickerProps) {
  // "Someone else" is chosen but nothing typed yet. Read off the name alone,
  // picking it on an empty cue put nothing on screen — the option needs a box
  // to type into, and the box only existed once a name had been typed in it.
  const [typingName, setTypingName] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const focusNameRef = useRef(false);

  const performerId = value.performerId ?? '';
  const typedName = (value.performer ?? '').trim();
  const hostName = host?.trim() ?? '';
  // A host who is also booked is already in the list — link the cue to that
  // record so Run Show gets their face and their walk-on, and mark which one
  // they are rather than offering the same person twice.
  const hostPerformer = hostName
    ? performers.find((p) => p.name.trim().toLowerCase() === hostName.toLowerCase())
    : undefined;
  const hostOnly = !!hostName && !hostPerformer;
  const isHostPick = hostOnly && typedName.toLowerCase() === hostName.toLowerCase();
  const isCustom = !performerId && !isHostPick && (typedName !== '' || typingName);
  // A pick with no record has no id to hold, so a sentinel stands in for it —
  // otherwise the select would fall back to "nobody" as though nothing had been
  // chosen at all.
  const selectValue = performerId || (isHostPick ? HOST_OPTION : isCustom ? CUSTOM_OPTION : '');

  // Choosing "someone else" should land the cursor in the box it reveals — but
  // only when it was just chosen. Opening a cue that already has a typed name
  // must leave focus wherever editing starts.
  useEffect(() => {
    if (!focusNameRef.current) return;
    focusNameRef.current = false;
    nameInputRef.current?.focus();
  }, [isCustom]);

  function pick(next: string) {
    if (next === CUSTOM_OPTION) {
      // Someone with no record anywhere — a guest, a drop-in, a name off a run
      // sheet. Keep whatever is already typed and put the cursor in the box.
      setTypingName(true);
      focusNameRef.current = true;
      onChange({ performer: typedName || undefined, performerId: undefined });
      return;
    }
    setTypingName(false);
    if (next === '') {
      onChange({ performer: undefined, performerId: undefined });
      return;
    }
    if (next === HOST_OPTION) {
      // The host isn't on the bill, so there's no record to link — the name is
      // the whole attachment, and Run Show reads it to put them on stage.
      onChange({ performer: hostName, performerId: undefined });
      return;
    }
    if (next.startsWith('rolodex:')) {
      const comic = unbookedComics.find((c) => c.id === next.slice('rolodex:'.length));
      const booked = comic && onBookPerformer?.(comic);
      if (booked) onChange({ performer: booked.name, performerId: booked.id });
      return;
    }
    const perf = performers.find((p) => p.id === next);
    onChange({ performer: perf?.name, performerId: next });
  }

  return (
    <>
      <select
        className={selectClassName}
        value={selectValue}
        onChange={(e) => pick(e.target.value)}
        aria-label="Who's on stage"
      >
        <option value="">On stage: nobody</option>
        {/* First, because on most nights the host works more cues than anybody
            on the bill does. */}
        {hostOnly && (
          <optgroup label="Hosting">
            <option value={HOST_OPTION}>{hostName}</option>
          </optgroup>
        )}
        {performers.length > 0 && (
          <optgroup label="On this bill">
            {performers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.id === hostPerformer?.id ? ' (host)' : ''}
                {p.walkOnMusic ? ' (walk-on)' : ''}
              </option>
            ))}
          </optgroup>
        )}
        {onBookPerformer && unbookedComics.length > 0 && (
          <optgroup label="From your Rolodex — adds them to the bill">
            {unbookedComics.map((c) => (
              <option key={c.id} value={`rolodex:${c.id}`}>
                {c.name}{c.walkOnMusic ? ' (walk-on)' : ''}
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label="Not on file">
          {/* Reads the name back when there is one, so the closed select still
              says who is on stage rather than "someone". */}
          {/* Reads the name back only when this is the option in force. Echoing
              it unconditionally listed the host twice — once under Hosting,
              once here. */}
          <option value={CUSTOM_OPTION}>
            {isCustom && typedName ? typedName : 'Someone else — type a name'}
          </option>
        </optgroup>
      </select>
      {isCustom && (
        <input
          ref={nameInputRef}
          className={inputClassName}
          value={value.performer ?? ''}
          onChange={(e) => onChange({ performer: e.target.value, performerId: undefined })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSubmit?.();
            if (e.key === 'Escape') onCancel?.();
          }}
          aria-label="Name of who's on stage"
          placeholder="Their name"
        />
      )}
    </>
  );
}
