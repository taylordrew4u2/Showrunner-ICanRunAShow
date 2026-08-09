import type { Show } from '../types';
import { buildOverview, showReadiness } from '../utils/showsOverview';
import { formatShowTime } from '../utils/showDate';
import { Icon } from './Icon';
import './ShowsDashboard.css';

/**
 * Whether the grid below is narrowed to the follow-up list.
 *
 * One value, not one per reason: the panel above shows both reasons in a
 * single queue, so "show me the rest of these" means the whole queue. Two
 * filters would have needed the panel to be two lists to pick between.
 */
export type ShowsFocus = 'attention' | null;

interface ShowsDashboardProps {
  shows: Show[];
  focus: ShowsFocus;
  onFocusChange: (focus: ShowsFocus) => void;
  onSelectShow: (show: Show, e: React.MouseEvent) => void;
  /** Open a show straight into live mode. */
  onRunShow?: (show: Show) => void;
  /** Injected in tests; the real page just uses now. */
  today?: Date;
}

/** How many follow-ups the panel lists before it defers to the filter. */
const ATTENTION_SHOWN = 4;

/**
 * The dashboard above the shows grid.
 *
 * A list of shows answers "what have I got". These two panels answer the
 * questions you actually open the app with: what's next, and what still needs
 * doing — and they answer them with the shows themselves rather than a count
 * you then have to go and act on by hand.
 *
 * This replaced a row of four count tiles. Counts made you do the work twice:
 * "Needs a lineup: 5" told you there was a problem but not which shows had it,
 * so the next move was always to filter the grid and read the names off it.
 * The names are the answer, so the panel prints the names.
 */
export function ShowsDashboard({
  shows, focus, onFocusChange, onSelectShow, onRunShow, today,
}: ShowsDashboardProps) {
  const { nextShow, nextShowWhen, upcomingCount, attention } = buildOverview(shows, today);

  if (shows.length === 0) return null;

  return (
    <section className="dash" aria-label="At a glance">
      <NextUpPanel
        show={nextShow}
        when={nextShowWhen}
        upcomingCount={upcomingCount}
        onSelectShow={onSelectShow}
        onRunShow={onRunShow}
      />
      <AttentionPanel
        attention={attention}
        focus={focus}
        onFocusChange={onFocusChange}
        onSelectShow={onSelectShow}
      />
    </section>
  );
}

interface NextUpPanelProps {
  show: Show | null;
  when: string | null;
  upcomingCount: number;
  onSelectShow: (show: Show, e: React.MouseEvent) => void;
  onRunShow?: (show: Show) => void;
}

function NextUpPanel({ show, when, upcomingCount, onSelectShow, onRunShow }: NextUpPanelProps) {
  if (!show) {
    return (
      <article className="dash-panel dash-panel--next">
        <h2 className="dash-panel__title">Next up</h2>
        <p className="dash-panel__quiet">
          Nothing dated yet. Give a show a date and it will lead this panel.
        </p>
      </article>
    );
  }

  const time = formatShowTime(show.time);
  const readiness = showReadiness(show);

  return (
    <article className="dash-panel dash-panel--next">
      <div className="dash-panel__head">
        <h2 className="dash-panel__title">Next up</h2>
        {/* The count the old row gave a whole tile to. It is one number about
            a list already on screen, so it rides along as a caption. */}
        <span className="dash-panel__aside">{upcomingCount} upcoming</span>
      </div>

      <button type="button" className="dash-next__name" onClick={(e) => onSelectShow(show, e)}>
        {show.name}
      </button>

      <p className="dash-next__meta">
        <span className="dash-next__when">{when}</span>
        {time && <><span className="dash-next__sep" aria-hidden="true">·</span>{time}</>}
        {show.venueName && (
          <><span className="dash-next__sep" aria-hidden="true">·</span>{show.venueName}</>
        )}
      </p>

      <ul className="dash-ready">
        {readiness.map((line) => (
          <li
            key={line.key}
            className={`dash-ready__line${line.ready ? ' dash-ready__line--ready' : ''}`}
          >
            <Icon name={line.ready ? 'check' : 'clock'} size={14} aria-hidden />
            <span>{line.label}</span>
            {/* The icon carries this for anyone reading the screen; say it in
                words for anyone who isn't. */}
            <span className="visually-hidden">{line.ready ? ' — done' : ' — still to do'}</span>
          </li>
        ))}
      </ul>

      <div className="dash-next__actions">
        {onRunShow && (
          <button
            type="button"
            className="btn btn--primary btn--sm dash-next__run"
            onClick={() => onRunShow(show)}
          >
            <Icon name="play" size={13} aria-hidden /> Run Show
          </button>
        )}
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={(e) => onSelectShow(show, e)}
        >
          Open show
        </button>
      </div>
    </article>
  );
}

interface AttentionPanelProps {
  attention: ReturnType<typeof buildOverview>['attention'];
  focus: ShowsFocus;
  onFocusChange: (focus: ShowsFocus) => void;
  onSelectShow: (show: Show, e: React.MouseEvent) => void;
}

function AttentionPanel({ attention, focus, onFocusChange, onSelectShow }: AttentionPanelProps) {
  if (attention.length === 0) {
    return (
      <article className="dash-panel dash-panel--attention dash-panel--clear">
        <h2 className="dash-panel__title">Needs attention</h2>
        <p className="dash-panel__all-clear">
          <Icon name="check" size={16} aria-hidden />
          Every upcoming show has a lineup and a running order.
        </p>
      </article>
    );
  }

  const shown = attention.slice(0, ATTENTION_SHOWN);
  const rest = attention.length - shown.length;

  return (
    <article className="dash-panel dash-panel--attention">
      <div className="dash-panel__head">
        <h2 className="dash-panel__title">Needs attention</h2>
        <span className="dash-panel__aside">{attention.length}</span>
      </div>

      <ul className="dash-todo">
        {shown.map((item) => (
          <li key={`${item.show.id}:${item.reason}`}>
            <button
              type="button"
              className="dash-todo__row"
              onClick={(e) => onSelectShow(item.show, e)}
            >
              <span className="dash-todo__name">{item.show.name}</span>
              <span className={`dash-todo__reason dash-todo__reason--${item.reason}`}>
                {item.label}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {/* Past the few that fit, the grid below is the better place to read
          them — so the overflow narrows the grid rather than growing a list
          that would push the shows off the screen it is meant to summarise. */}
      {rest > 0 && (
        <div className="dash-todo__more">
          <FocusLink label={`${rest} more`} focus={focus} onFocusChange={onFocusChange} />
        </div>
      )}
    </article>
  );
}

interface FocusLinkProps {
  label: string;
  focus: ShowsFocus;
  onFocusChange: (focus: ShowsFocus) => void;
}

/** Narrows the grid to every show on the follow-up queue, whatever it needs. */
function FocusLink({ label, focus, onFocusChange }: FocusLinkProps) {
  const active = focus === 'attention';
  return (
    <button
      type="button"
      className="dash-todo__more-btn"
      aria-pressed={active}
      aria-label={active
        ? 'Showing only shows that need attention — activate to show all shows'
        : 'Show only the shows that need attention'}
      onClick={() => onFocusChange(active ? null : 'attention')}
    >
      {active ? 'Show all shows' : label}
    </button>
  );
}
