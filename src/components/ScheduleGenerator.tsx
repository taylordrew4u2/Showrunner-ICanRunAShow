import { useMemo, useState } from 'react';
import type { Performer, ScheduleItem } from '../types';
import {
  generateSchedule,
  handoverRuntime,
  scheduleEndTime,
  scheduleRuntime,
  type ScheduleAct,
} from '../utils/generateSchedule';
import { Modal } from './Modal';
import { Icon } from './Icon';
import './ScheduleGenerator.css';

interface ScheduleGeneratorProps {
  performers: Performer[];
  host?: string;
  /** The show's start time, "HH:MM". */
  showTime?: string;
  /** How many cues the show already has, so a replace can warn first. */
  existingCount: number;
  onApply: (items: ScheduleItem[]) => void;
  onClose: () => void;
}

const INTRO_CHOICES = [1, 2, 3];
const SET_CHOICES = [5, 8, 10, 15];

/**
 * Building a run-of-show from the people already booked.
 *
 * The number worth looking at here is the handover total. Every producer knows
 * they introduce each act; almost nobody has added it up. Showing it beside the
 * end time is the point of the screen — it is the difference between a schedule
 * that holds and one that runs quietly late.
 */
export function ScheduleGenerator({
  performers,
  host,
  showTime,
  existingCount,
  onApply,
  onClose,
}: ScheduleGeneratorProps) {
  const [introMin, setIntroMin] = useState(1);
  const [setMin, setSetMin] = useState(10);
  const [withIntermission, setWithIntermission] = useState(performers.length >= 4);

  // The host works the room, not a slot on the bill — so if they are also
  // booked as a performer, they are not one of the acts to introduce.
  const acts: ScheduleAct[] = useMemo(
    () =>
      performers
        .filter((person) => !host || person.name.trim() !== host.trim())
        .map((person) => ({ performer: person })),
    [performers, host],
  );

  const items = useMemo(
    () =>
      generateSchedule({
        startTime: showTime ?? '',
        acts,
        hostName: host,
        introMin,
        defaultSetMin: setMin,
        intermissionAfter: withIntermission ? Math.ceil(acts.length / 2) : 0,
      }),
    [showTime, acts, host, introMin, setMin, withIntermission],
  );

  const runtime = scheduleRuntime(items);
  const handover = handoverRuntime(items);
  const endsAt = scheduleEndTime(showTime ?? '', items);
  const noStart = !showTime || items.length === 0;

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

        {noStart ? (
          <p className="gen__empty">
            {performers.length === 0
              ? 'Book someone onto this show first — the running order is built from the bill.'
              : 'Set a start time on the show before generating, so the cues have a clock to hang off.'}
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
                <span className="gen__control-label">Set length</span>
                <div className="gen__choices">
                  {SET_CHOICES.map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={`gen__choice${setMin === value ? ' gen__choice--on' : ''}`}
                      onClick={() => setSetMin(value)}
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

            <ol className="gen__cues">
              {items.map((item) => {
                const isHandover = item.description.startsWith('Intro — ');
                return (
                  <li
                    key={item.id}
                    className={`gen__cue${isHandover ? ' gen__cue--handover' : ''}`}
                  >
                    <span className="gen__cue-time">{item.time}</span>
                    <span className="gen__cue-body">
                      <span className="gen__cue-desc">{item.description}</span>
                      {item.performer && !isHandover && (
                        <span className="gen__cue-who">{item.performer}</span>
                      )}
                    </span>
                    <span className="gen__cue-len">{item.durationMin}m</span>
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
            disabled={noStart}
            onClick={() => onApply(items)}
          >
            {existingCount > 0 ? 'Replace the running order' : 'Use this running order'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
