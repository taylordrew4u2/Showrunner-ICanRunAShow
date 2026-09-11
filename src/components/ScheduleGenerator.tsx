import { useMemo, useState } from 'react';
import type { Performer, ScheduleItem } from '../types';
import {
  generateSchedule,
  handoverRuntime,
  scheduleEndTime,
  scheduleRuntime,
  type ScheduleAct,
} from '../utils/generateSchedule';
import { parseClockToMinutes } from '../utils/showTiming';
import { Modal } from './Modal';
import { Icon } from './Icon';
import './ScheduleGenerator.css';

interface ScheduleGeneratorProps {
  performers: Performer[];
  host?: string;
  /** The show's start time, however it was typed: "8:00 PM", "20:00", "8pm". */
  showTime?: string;
  /** How many cues the show already has, so a replace can warn first. */
  existingCount: number;
  /**
   * Hands back the cues and the start time they were timed from. The time can
   * differ from the show's: it is editable here, because being sent to another
   * section to set it was the step that ended the job.
   */
  onApply: (items: ScheduleItem[], startTime: string) => void;
  onClose: () => void;
}

const DOORS_CHOICES = [0, 15, 30];
const INTRO_CHOICES = [1, 2, 3];
const SET_CHOICES = [5, 8, 10, 15];

/**
 * Building a run-of-show from the people already booked.
 *
 * Everything the running order depends on is on this one screen, and that is
 * deliberate. The generator used to be a preview with three knobs: if the show
 * had no start time it refused outright and sent you to another section, and
 * every act got the same set length, so the real work — the closer closes, the
 * guest spot gets five — happened afterwards, by hand, one cue row at a time.
 * Producing a running order took three screens and a round of edits to undo
 * what the generator had assumed.
 *
 * So the order is editable where you read it. Move an act, change its minutes,
 * fix the start time, and the clock times and the end of the night move with
 * you. Apply once, when it says what you meant.
 *
 * The number still worth looking at is the handover total. Every producer knows
 * they introduce each act; almost nobody has added it up. It is the difference
 * between a schedule that holds and one that runs quietly late.
 */
export function ScheduleGenerator({
  performers,
  host,
  showTime,
  existingCount,
  onApply,
  onClose,
}: ScheduleGeneratorProps) {
  const [startTime, setStartTime] = useState(showTime ?? '');
  const [doorsMin, setDoorsMin] = useState(30);
  const [introMin, setIntroMin] = useState(1);
  const [setMin, setSetMin] = useState(10);
  const [withIntermission, setWithIntermission] = useState(performers.length >= 4);
  /** Per-act set lengths, by performer id. Anything absent runs at `setMin`. */
  const [lengths, setLengths] = useState<Record<string, number>>({});
  /** The running order, by performer id. Empty means "as booked". */
  const [order, setOrder] = useState<string[]>([]);

  // The host works the room, not a slot on the bill — so if they are also
  // booked as a performer, they are not one of the acts to introduce.
  const roster = useMemo(
    () => performers.filter((person) => !host || person.name.trim() !== host.trim()),
    [performers, host],
  );

  // `order` holds only what has been moved, so a performer booked after the
  // generator was opened still appears — at the back, where they were added —
  // rather than vanishing because they are missing from a stored order.
  const ordered = useMemo(() => {
    const byId = new Map(roster.map((person) => [person.id, person]));
    const seen = new Set<string>();
    const out: Performer[] = [];
    for (const id of order) {
      const person = byId.get(id);
      if (person && !seen.has(id)) {
        out.push(person);
        seen.add(id);
      }
    }
    for (const person of roster) if (!seen.has(person.id)) out.push(person);
    return out;
  }, [roster, order]);

  const acts: ScheduleAct[] = useMemo(
    () => ordered.map((person) => ({ performer: person, durationMin: lengths[person.id] ?? setMin })),
    [ordered, lengths, setMin],
  );

  const items = useMemo(
    () =>
      generateSchedule({
        startTime,
        acts,
        hostName: host,
        doorsMin,
        introMin,
        defaultSetMin: setMin,
        intermissionAfter: withIntermission ? Math.ceil(acts.length / 2) : 0,
      }),
    [startTime, acts, host, doorsMin, introMin, setMin, withIntermission],
  );

  /** Where each act sits in the order, so a preview row knows it can be moved. */
  const actIndex = useMemo(() => {
    const map = new Map<string, number>();
    ordered.forEach((person, index) => map.set(person.id, index));
    return map;
  }, [ordered]);

  const runtime = scheduleRuntime(items);
  const handover = handoverRuntime(items);
  const endsAt = scheduleEndTime(startTime, items);
  const startReadable = parseClockToMinutes(startTime) !== null;
  const canApply = startReadable && items.length > 0;

  function moveAct(index: number, dir: -1 | 1) {
    const ids = ordered.map((person) => person.id);
    const to = index + dir;
    if (to < 0 || to >= ids.length) return;
    [ids[index], ids[to]] = [ids[to], ids[index]];
    setOrder(ids);
  }

  function setActLength(id: string, raw: string) {
    const minutes = parseInt(raw, 10);
    setLengths((prev) => {
      const next = { ...prev };
      // A cleared field means "whatever the default is", not zero — a nought
      // would silently drop the act out of the running order entirely.
      if (!Number.isFinite(minutes) || minutes <= 0) delete next[id];
      else next[id] = Math.min(180, minutes);
      return next;
    });
  }

  /** The chips set every act at once, so they clear the per-act overrides. */
  function chooseSetLength(value: number) {
    setSetMin(value);
    setLengths({});
  }

  return (
    <Modal onClose={onClose} labelledBy="schedule-generator-title">
      <div className="gen">
        <div className="gen__head">
          <h2 id="schedule-generator-title" className="gen__title">
            Generate the run-of-show
          </h2>
          <p className="gen__sub">
            Built from the {acts.length} performer{acts.length === 1 ? '' : 's'} on this show
            {host ? `, hosted by ${host}` : ''}.
          </p>
        </div>

        {performers.length === 0 ? (
          <p className="gen__empty">
            Book someone onto this show first — the running order is built from the bill.
          </p>
        ) : (
          <>
            {/* Without a host there is nobody to hand over between acts, so the
                minute that makes this worth generating never gets written. That
                is a silent hole otherwise: the schedule looks finished and runs
                short of the truth by a minute per act. */}
            {!host && (
              <p className="gen__nohost">
                <Icon name="alert" size={14} aria-hidden />
                <span>
                  No host set for this show, so no intros between acts. Set the Host field on the
                  show to have them written in.
                </span>
              </p>
            )}

            <div className="gen__controls">
              {/* Editable here rather than on another section. A show with no
                  readable start time used to stop the generator dead and send
                  the producer away to set it — which is where the job ended. */}
              <div className="gen__control gen__control--start">
                <label className="gen__control-label" htmlFor="gen-start-time">
                  Show starts
                </label>
                <input
                  id="gen-start-time"
                  className="gen__time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  placeholder="8:00 PM"
                  autoFocus={!startReadable}
                />
                {!startReadable && (
                  <p className="gen__hint">
                    Type a time like <strong>8:00 PM</strong> — every cue below hangs off it.
                    {showTime ? '' : ' This sets the show’s start time too.'}
                  </p>
                )}
              </div>

              <div className="gen__control">
                <span className="gen__control-label">Doors — house music first</span>
                <div className="gen__choices">
                  {DOORS_CHOICES.map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={`gen__choice${doorsMin === value ? ' gen__choice--on' : ''}`}
                      onClick={() => setDoorsMin(value)}
                    >
                      {value === 0 ? 'None' : `${value} min`}
                    </button>
                  ))}
                </div>
              </div>

              {host && (
                <div className="gen__control">
                  <span className="gen__control-label">Host intro between acts</span>
                  <div className="gen__choices">
                    {INTRO_CHOICES.map((value) => (
                      <button
                        key={value}
                        type="button"
                        className={`gen__choice${introMin === value ? ' gen__choice--on' : ''}`}
                        onClick={() => setIntroMin(value)}
                      >
                        {value} min
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="gen__control">
                <span className="gen__control-label">Set length — every act</span>
                <div className="gen__choices">
                  {SET_CHOICES.map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={`gen__choice${
                        setMin === value && Object.keys(lengths).length === 0
                          ? ' gen__choice--on'
                          : ''
                      }`}
                      onClick={() => chooseSetLength(value)}
                    >
                      {value} min
                    </button>
                  ))}
                </div>
              </div>

              <label className="gen__toggle">
                <input
                  type="checkbox"
                  checked={withIntermission}
                  onChange={(e) => setWithIntermission(e.target.checked)}
                />
                <span>Intermission halfway</span>
              </label>
            </div>

            {startReadable ? (
              <>
                {/* The preview is the editor. Every act row carries its own
                    minutes and its place in the order, so the running order is
                    changed where it is read — rather than applied, found wrong,
                    and then fixed a cue at a time in the list underneath. */}
                <p className="gen__nudge">
                  Move an act or change its minutes right here — the clock times follow.
                </p>

                <ol className="gen__cues">
                  {items.map((item) => {
                    const isHandover = item.description.startsWith('Intro — ');
                    const index = item.performerId ? actIndex.get(item.performerId) : undefined;
                    const editable = index !== undefined;
                    return (
                      <li
                        key={item.id}
                        className={`gen__cue${isHandover ? ' gen__cue--handover' : ''}${
                          editable ? ' gen__cue--act' : ''
                        }`}
                      >
                        <span className="gen__cue-time">{item.time}</span>
                        <span className="gen__cue-body">
                          <span className="gen__cue-desc">{item.description}</span>
                          {item.performer && !isHandover && (
                            <span className="gen__cue-who">{item.performer}</span>
                          )}
                        </span>
                        {editable ? (
                          <span className="gen__cue-edit">
                            <span className="gen__move">
                              <button
                                type="button"
                                className="gen__move-btn"
                                onClick={() => moveAct(index, -1)}
                                disabled={index === 0}
                                aria-label={`Move ${item.performer} earlier`}
                                title="Move earlier"
                              >
                                <span aria-hidden>↑</span>
                              </button>
                              <button
                                type="button"
                                className="gen__move-btn"
                                onClick={() => moveAct(index, 1)}
                                disabled={index === ordered.length - 1}
                                aria-label={`Move ${item.performer} later`}
                                title="Move later"
                              >
                                <span aria-hidden>↓</span>
                              </button>
                            </span>
                            <input
                              className="gen__cue-min"
                              type="number"
                              min="1"
                              max="180"
                              step="1"
                              value={item.durationMin ?? ''}
                              onChange={(e) => setActLength(item.performerId!, e.target.value)}
                              aria-label={`Set length for ${item.performer}, in minutes`}
                            />
                            <span className="gen__cue-min-unit" aria-hidden>
                              m
                            </span>
                          </span>
                        ) : (
                          <span className="gen__cue-len">{item.durationMin}m</span>
                        )}
                      </li>
                    );
                  })}
                </ol>

                <div className="gen__totals">
                  <div className="gen__total">
                    <span className="gen__total-label">Runs</span>
                    <span className="gen__total-value">{runtime} min</span>
                  </div>
                  <div className="gen__total">
                    <span className="gen__total-label">Ends</span>
                    <span className="gen__total-value">{endsAt}</span>
                  </div>
                  {host && (
                    <div className="gen__total gen__total--note">
                      <span className="gen__total-label">Your handovers</span>
                      <span className="gen__total-value">{handover} min</span>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <p className="gen__empty">
                The running order appears as soon as there is a start time to hang it off.
              </p>
            )}

            {existingCount > 0 && (
              <p className="gen__warn">
                <Icon name="alert" size={14} />
                This replaces the {existingCount} cue{existingCount === 1 ? '' : 's'} already on
                this show.
              </p>
            )}
          </>
        )}

        <div className="gen__actions">
          <button className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn--primary"
            disabled={!canApply}
            onClick={() => onApply(items, startTime)}
          >
            {existingCount > 0 ? 'Replace the running order' : 'Use this running order'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
