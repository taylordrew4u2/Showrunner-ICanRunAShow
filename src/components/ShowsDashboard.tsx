import type { Show } from '../types';
import { buildOverview } from '../utils/showsOverview';
import './ShowsDashboard.css';

/** Which follow-up list the grid below is narrowed to, if any. */
export type ShowsFocus = 'lineup' | 'schedule' | null;

interface ShowsDashboardProps {
  shows: Show[];
  focus: ShowsFocus;
  onFocusChange: (focus: ShowsFocus) => void;
  onSelectShow: (show: Show, e: React.MouseEvent) => void;
  /** Injected in tests; the real page just uses now. */
  today?: Date;
}

/**
 * The strip of widgets above the shows grid.
 *
 * A list of shows answers "what have I got". These answer the two questions
 * you actually open the app with: what's next, and what still needs doing.
 *
 * The two follow-up widgets are buttons that narrow the grid below, so the
 * count is a way in rather than a statistic to read and then act on by hand.
 * A widget with nothing to report goes quiet — it keeps its tile so the row
 * doesn't reflow as work gets done, but it stops looking like a task.
 */
export function ShowsDashboard({ shows, focus, onFocusChange, onSelectShow, today }: ShowsDashboardProps) {
  const { nextShow, nextShowWhen, upcomingCount, needsLineup, needsSchedule } =
    buildOverview(shows, today);

  if (shows.length === 0) return null;

  function toggle(which: Exclude<ShowsFocus, null>) {
    onFocusChange(focus === which ? null : which);
  }

  return (
    <section className="dash" aria-label="At a glance">
      {nextShow ? (
        <article className="dash__tile dash__tile--next">
          <h2 className="dash__label">Next up</h2>
          <button
            type="button"
            className="dash__next-name"
            onClick={(e) => onSelectShow(nextShow, e)}
          >
            {nextShow.name}
          </button>
          <p className="dash__next-meta">
            <span className="dash__when">{nextShowWhen}</span>
            {nextShow.venueName && <span className="dash__sep" aria-hidden="true">·</span>}
            {nextShow.venueName && <span>{nextShow.venueName}</span>}
          </p>
        </article>
      ) : (
        <article className="dash__tile dash__tile--next">
          <h2 className="dash__label">Next up</h2>
          <p className="dash__quiet">Nothing on the books with a date yet.</p>
        </article>
      )}

      <article className="dash__tile">
        <h2 className="dash__label">Upcoming</h2>
        <p className="dash__figure">{upcomingCount}</p>
        <p className="dash__sub">{upcomingCount === 1 ? 'show ahead' : 'shows ahead'}</p>
      </article>

      <FollowUp
        label="Needs a lineup"
        count={needsLineup.length}
        done="Every show has a bill"
        active={focus === 'lineup'}
        onToggle={() => toggle('lineup')}
      />

      <FollowUp
        label="Needs a running order"
        count={needsSchedule.length}
        done="Every bill has an order"
        active={focus === 'schedule'}
        onToggle={() => toggle('schedule')}
      />
    </section>
  );
}

interface FollowUpProps {
  label: string;
  count: number;
  done: string;
  active: boolean;
  onToggle: () => void;
}

function FollowUp({ label, count, done, active, onToggle }: FollowUpProps) {
  // Nothing to chase: keep the tile, drop the button. A count of zero is good
  // news, and good news shouldn't be styled as a thing to click.
  if (count === 0) {
    return (
      <article className="dash__tile dash__tile--clear">
        <h2 className="dash__label">{label}</h2>
        <p className="dash__figure dash__figure--clear">0</p>
        <p className="dash__sub">{done}</p>
      </article>
    );
  }

  return (
    <article className={`dash__tile dash__tile--todo${active ? ' dash__tile--active' : ''}`}>
      <button type="button" className="dash__action" aria-pressed={active} onClick={onToggle}>
        <span className="dash__label">{label}</span>
        <span className="dash__figure">{count}</span>
        <span className="dash__sub">
          {active ? 'Showing these — tap to clear' : count === 1 ? 'show to sort out' : 'shows to sort out'}
        </span>
      </button>
    </article>
  );
}
