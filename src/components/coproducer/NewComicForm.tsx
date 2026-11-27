import { useId, useRef, useState } from 'react';
import {
  checkNewComic,
  needsText,
  NO_TAPE_SIGN,
  normalizeSocial,
  normalizeTapeUrl,
  TAPE_MINUTES,
  TAPE_REQUIRED_NOTICE,
  tapeLengthLabel,
  type NewComicNeed,
  type TapeMinutes,
} from '../../coproducer/newComics';
import { NoTapeSign } from './NoTapeSign';
import './coproducer.css';

/** What the form holds while it is being filled in. */
export interface NewComicValues { name: string; tape: string; minutes: TapeMinutes | null; social: string }
/** All a co-producer sends about someone new. */
export interface NewComicEntry { name: string; videoLink: string; tapeMinutes: TapeMinutes; socialMedia: string }

const EMPTY_NEW_COMIC: NewComicValues = { name: '', tape: '', minutes: null, social: '' };

/**
 * What was typed, as it would be sent: the name trimmed, the tape link with
 * its https://, the handle read by the app's own helpers. Or what is still
 * missing, in the order the form asks for it.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function readNewComic(values: NewComicValues): { entry: NewComicEntry } | { missing: NewComicNeed[] } {
  const entry = {
    name: values.name.trim(),
    videoLink: normalizeTapeUrl(values.tape) ?? '',
    tapeMinutes: values.minutes,
    socialMedia: normalizeSocial(values.social) ?? '',
  };
  const { missing } = checkNewComic(entry);
  return missing.length > 0 ? { missing } : { entry: entry as NewComicEntry };
}

const FIELD_ERRORS: Record<NewComicNeed, string> = {
  name: 'Add their name.',
  tape: NO_TAPE_SIGN,
  length: 'Choose 5 or 10 minutes.',
  social: 'Add their handle or a link to their profile.',
};

/** The form between presses: what is typed, what the last press of Add found missing, and how many presses were refused. */
export interface NewComicFormState {
  values: NewComicValues;
  /** Null until Add is pressed, and again once someone is added. */
  refused: NewComicNeed[] | null;
  attempts: number;
}
// eslint-disable-next-line react-refresh/only-export-components
export const NEW_COMIC_START: NewComicFormState = { values: EMPTY_NEW_COMIC, refused: null, attempts: 0 };

/**
 * One press of Add, or Enter. With everything there: the entry to add, and a
 * clean form. Otherwise nothing to add, however often it is pressed: what is
 * missing, one more refused attempt (each puts the no-tape sign up afresh),
 * and where to go, which is the tape field whenever there is no tape.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function pressAdd(state: NewComicFormState): { state: NewComicFormState; entry: NewComicEntry | null; focus: NewComicNeed } {
  const result = readNewComic(state.values);
  if ('entry' in result) return { state: NEW_COMIC_START, entry: result.entry, focus: 'name' };
  return {
    state: { ...state, refused: result.missing, attempts: state.attempts + 1 },
    entry: null,
    focus: result.missing.includes('tape') ? 'tape' : result.missing[0],
  };
}

/**
 * The only way a co-producer adds someone new: a name, a tape (its link, and
 * whether it is five or ten minutes) and their social media. Nothing else is
 * asked for, and nothing is added until all of it is there: pressing Add
 * without it says what is missing, beside each field and in one line by the
 * button, and leaves the page as it was. A tape is asked for before anything
 * is pressed, and every press without one puts the sign up again, at the top
 * of the form and beside the tape field, until a link that works is typed.
 * The owner's own forms are untouched.
 */
export function NewComicForm({ who, onAdd, initial }: {
  /** What this page calls the person: 'Performer', 'Artist', the Rolodex's own word. */
  who: string;
  onAdd: (entry: NewComicEntry) => void;
  /** For tests: the form as it stands after a refused Add. */
  initial?: Pick<NewComicFormState, 'values' | 'refused'> & { attempts?: number };
}) {
  const id = useId();
  const [form, setForm] = useState<NewComicFormState>({ ...NEW_COMIC_START, ...initial });
  const { values, refused, attempts } = form;
  const nameRef = useRef<HTMLInputElement>(null);
  const tapeRef = useRef<HTMLInputElement>(null);
  const lengthRef = useRef<HTMLInputElement>(null);
  const socialRef = useRef<HTMLInputElement>(null);
  const refs: Record<NewComicNeed, React.RefObject<HTMLInputElement | null>> = { name: nameRef, tape: tapeRef, length: lengthRef, social: socialRef };

  const read = readNewComic(values);
  const stillMissing = 'missing' in read ? read.missing : [];
  // A field is marked once Add has been refused for it, until it is put right.
  const bad = (need: NewComicNeed) => !!refused?.includes(need) && stillMissing.includes(need);
  const errorId = (need: NewComicNeed) => `${id}-${need}-error`;
  const described = (need: NewComicNeed, hint?: string) => [hint, bad(need) ? errorId(need) : undefined].filter(Boolean).join(' ') || undefined;
  const error = (need: NewComicNeed) => bad(need) && (
    <p className="new-comic__error" id={errorId(need)}>{FIELD_ERRORS[need]}</p>
  );
  const set = (patch: Partial<NewComicValues>) => setForm((current) => ({ ...current, values: { ...current.values, ...patch } }));

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const pressed = pressAdd(form);
    if (pressed.entry) onAdd(pressed.entry);
    setForm(pressed.state);
    refs[pressed.focus].current?.focus();
  }

  const shown = refused?.filter((need) => stillMissing.includes(need)) ?? [];

  return (
    <form className="new-comic" noValidate onSubmit={submit} aria-describedby={`${id}-intro`}>
      <div className="new-comic__top">
        {/* Always in the page, and a new sign in it for each refused press, so every press is read out. */}
        <div className="new-comic__sign" aria-live="assertive" aria-atomic="true">
          {bad('tape') && <NoTapeSign key={attempts} attempt={attempts} alert={false} also={bad('length') ? FIELD_ERRORS.length : undefined} />}
        </div>
        <p className="new-comic__intro" id={`${id}-intro`}>
          Someone new needs a name, a tape and their social media. The owner sees these before approving.
        </p>
      </div>
      <div className="new-comic__field">
        <label className="new-comic__label" htmlFor={`${id}-name`}>{who} name</label>
        <input
          ref={nameRef}
          id={`${id}-name`}
          className="section-field__input"
          value={values.name}
          onChange={(e) => set({ name: e.target.value })}
          autoComplete="off"
          aria-required="true"
          aria-invalid={bad('name') || undefined}
          aria-describedby={described('name')}
        />
        {error('name')}
      </div>
      <div className="new-comic__field">
        <label className="new-comic__label" htmlFor={`${id}-tape`}>Tape link</label>
        <input
          ref={tapeRef}
          id={`${id}-tape`}
          className="section-field__input"
          type="url"
          inputMode="url"
          value={values.tape}
          onChange={(e) => set({ tape: e.target.value })}
          placeholder="https://"
          autoComplete="off"
          aria-required="true"
          aria-invalid={bad('tape') || undefined}
          aria-describedby={described('tape', `${id}-tape-notice ${id}-tape-hint`)}
        />
        <p className="new-comic__notice" id={`${id}-tape-notice`}>{TAPE_REQUIRED_NOTICE}</p>
        <p className="new-comic__hint" id={`${id}-tape-hint`}>
          A link to a video of their set.{bad('tape') && values.tape.trim() !== '' && ' A tape link starts with http:// or https://.'}
        </p>
        {error('tape')}
      </div>
      <fieldset className="new-comic__length" aria-describedby={described('length')}>
        <legend className="new-comic__label">Tape length</legend>
        {TAPE_MINUTES.map((minutes, index) => (
          <label key={minutes} className="new-comic__choice">
            <input
              ref={index === 0 ? lengthRef : undefined}
              type="radio"
              name={`${id}-length`}
              value={minutes}
              checked={values.minutes === minutes}
              onChange={() => set({ minutes })}
              aria-invalid={bad('length') || undefined}
            />
            {tapeLengthLabel(minutes)}
          </label>
        ))}
        {error('length')}
      </fieldset>
      <div className="new-comic__field">
        <label className="new-comic__label" htmlFor={`${id}-social`}>Social media</label>
        <input
          ref={socialRef}
          id={`${id}-social`}
          className="section-field__input"
          value={values.social}
          onChange={(e) => set({ social: e.target.value })}
          placeholder="@handle or profile link"
          autoComplete="off"
          autoCapitalize="none"
          aria-required="true"
          aria-invalid={bad('social') || undefined}
          aria-describedby={described('social')}
        />
        {error('social')}
      </div>
      {/* Always in the page, so a screen reader hears it fill. */}
      <p className="new-comic__summary" role="alert">
        {shown.length > 0 && `Not added yet. Add ${needsText(shown)} first.`}
      </p>
      <button type="submit" className="btn btn--primary btn--sm new-comic__add">Add</button>
    </form>
  );
}
