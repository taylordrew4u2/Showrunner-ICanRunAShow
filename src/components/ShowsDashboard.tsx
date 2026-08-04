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
 *
 * Every tile is one line of label and one number, side by side. Stacking them
 * — label, then a big figure, then a caption — cost about 90px of height each
 * for two short pieces of text, and four of those pushed the first show clean
 * off a phone screen. The row is chrome; it has to earn its height.
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
      <article className="dash__tile dash__tile--next">
        {nextShow ? (
          <>
            <h2 className="dash__label">Next up</h2>
            <p className="dash__next-line">
              <button
                type="button"
                className="dash__next-name"
                onClick={(e) => onSelectShow(nextShow, e)}
              >
                {nextShow.name}
              </button>
              <span className="dash__when">{nextShowWhen}</span>
              {nextShow.venueName && (
                <>
                  <span className="dash__sep" aria-hidden="true">·</span>
                  <span className="dash__venue">{nextShow.venueName}</span>
                </>
              )}
              {/* The standalone Upcoming tile steps aside on a phone to make
                  room for the two you can act on. The count itself shouldn't
                  vanish with it — the hero has width to spare, so it carries
                  the number at exactly the widths the tile doesn't. */}
              <span className="dash__hero-count">{upcomingCount} upcoming</span>
            </p>
          </>
        ) : (
          <>
            <h2 className="dash__label">Next up</h2>
            <p className="dash__quiet">Nothing dated yet.</p>
          </>
        )}
      </article>

      <article className="dash__tile dash__tile--count dash__tile--upcoming">
        <h2 className="dash__label">Upcoming</h2>
        <p className="dash__figure">{upcomingCount}</p>
      </article>

      <FollowUp
        label="Needs a lineup"
        count={needsLineup.length}
        active={focus === 'lineup'}
        onToggle={() => toggle('lineup')}
      />

      <FollowUp
        label="Needs a running order"
        count={needsSchedule.length}
        active={focus === 'schedule'}
        onToggle={() => toggle('schedule')}
      />
    </section>
  );
}

interface FollowUpProps {
  label: string;
  count: number;
  active: boolean;
  onToggle: () => void;
}

function FollowUp({ label, count, active, onToggle }: FollowUpProps) {
  // Nothing to chase: keep the tile, drop the button. A count of zero is good
  // news, and good news shouldn't be styled as a thing to click.
  if (count === 0) {
    return (
      <article className="dash__tile dash__tile--count dash__tile--clear">
        <h2 className="dash__label">{label}</h2>
        <p className="dash__figure dash__figure--clear">0</p>
      </article>
    );
  }

  return (
    <article className={`dash__tile dash__tile--todo${active ? ' dash__tile--active' : ''}`}>
      <button
        type="button"
        className="dash__action"
        aria-pressed={active}
        // The label alone would read the same pressed or not, and pressed state
        // isn't announced everywhere — so say what activating it will do.
        aria-label={active ? `${label}: ${count}. Showing only these — activate to show all shows` : `${label}: ${count}. Activate to show only these`}
        onClick={onToggle}
      >
        <span className="dash__label">{label}</span>
        <span className="dash__figure">{count}</span>
      </button>
    </article>
  );
}
