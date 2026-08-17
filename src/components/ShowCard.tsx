import type { Show } from '../types';
import { parseShowDate, formatShowTime } from '../utils/showDate';
import { formatRuntime } from '../utils/sectionSummary';
import { baseDurations } from '../utils/showTiming';
import { lineupProgress } from '../utils/lineupTarget';
import { whenLabel } from '../utils/showsOverview';
import { useConfirm } from './useConfirm';
import './ShowCard.css';

interface ShowCardProps {
  show: Show;
  onSelect: (show: Show, e: React.MouseEvent) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  /** Injected in tests and previews; the real grid just uses now. */
  today?: Date;
}

const STATUS_LABELS: Record<Show['status'], string> = {
  upcoming: 'Upcoming',
  'in-progress': 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export function ShowCard({ show, onSelect, onDelete, onDuplicate, today }: ShowCardProps) {
  const { confirm, confirmDialog } = useConfirm();
  const sceneCount = show.scenes?.length ?? 0;
  const doneCount = show.scenes?.filter((s) => s.status === 'done').length ?? 0;

  // What you actually want to know at a glance about a show you haven't opened:
  // how big the bill is, how long the night runs, who's hosting. The card knew
  // all of it and showed none of it.
  const lineupCount = show.performers.length + show.artists.length;
  // With a target set, "how big is the bill" stops being the useful number and
  // "how close is it to booked" takes over. Same calculation the Performers
  // section runs, so a card can't call a bill full that the section doesn't.
  const lineup = lineupProgress(show.performers.length, show.performerTarget);
  const runtime = show.schedule.length
    ? formatRuntime(baseDurations(show.schedule).reduce((sum, sec) => sum + sec, 0))
    : null;
  const facts = [
    runtime,
    show.host?.trim() ? `Host ${show.host.trim()}` : null,
  ].filter((f): f is string => !!f);
  const lineupFact = lineup.targetSet
    ? lineup.shortLabel
    : lineupCount > 0
      ? `${lineupCount} on the bill`
      : null;

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    const ok = await confirm({
      title: `Delete "${show.name}"?`,
      message: 'It will be moved to trash, where you can recover it.',
    });
    if (ok) onDelete(show.id);
  }

  function handleDuplicate(e: React.MouseEvent) {
    e.stopPropagation();
    onDuplicate(show.id);
  }

  const showDate = parseShowDate(show.date);
  const isCurrentYear = showDate?.getFullYear() === new Date().getFullYear();
  const timeStr = formatShowTime(show.time);
  // "Tonight", "In 6 days", "Yesterday". The date block gives you Aug 14; this
  // gives you how long you've got, which is the thing you were working out in
  // your head every time you read one. Same wording as the Next-up tile.
  const whenStr = showDate && show.status !== 'completed' && show.status !== 'cancelled'
    ? whenLabel(showDate, today ?? new Date())
    : null;
  // The city, when it isn't just restating the venue. Search already looks at
  // it, so it's a field people fill in — the card was the one place it never
  // reached.
  const place = show.location?.trim() && show.location.trim() !== show.venueName?.trim()
    ? show.location.trim()
    : null;
  const fullDateStr = showDate?.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  // On a phone the date block is gone (see ShowCard.css) and the meta row is
  // the only line under the title, so the date has to be in it. "In 5 days"
  // already carries one when there is one; this is the fallback for the shows
  // that don't get one — finished, cancelled, or with the date still to set.
  const leadStr = whenStr
    ?? (showDate
      ? showDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
      : 'Date TBD');

  return (
    // The card is a container, not a control. It used to be role="button" with
    // two real buttons inside it — a control nested in a control, which is
    // invalid and leaves assistive tech guessing what activating it does. An
    // overlay button covers the card instead, so tapping anywhere opens the
    // show while Duplicate and Delete stay separately reachable, and nothing
    // is nested inside anything.
    // A full bill is the one thing on this card that's an *outcome* rather than
    // a property, so it gets the card's colour. It rides alongside the status
    // rather than replacing it — the left stripe still says upcoming or
    // completed, because a full show can be either.
    <article
      className={`show-card show-card--${show.status}${lineup.full ? ' show-card--full' : ''}`}
    >
      {/* A real element covering the card, not a pseudo-element stretched out
          of the title. That version put `::after { inset: 0 }` on the title's
          <button>, and Chromium clips hit-testing of a button's pseudo-element
          to the button's own box — so the overlay painted across the whole card
          but only accepted taps on the line the title sat on. Roughly
          four-fifths of every card did nothing when tapped.

          First child so it leads the tab order: "Open <show>", then Duplicate
          and Delete, which sit above it. */}
      <button
        type="button"
        className="show-card__open"
        aria-label={`Open ${show.name}${fullDateStr ? `, ${fullDateStr}` : ''}`}
        onClick={e => onSelect(show, e)}
      />

      <div className="show-card__top">
        <div
          className={`show-card__date${showDate ? '' : ' show-card__date--tbd'}`}
          aria-hidden="true"
        >
          {showDate ? (
            <>
              <span className="show-card__date-month">
                {showDate.toLocaleDateString(undefined, { month: 'short' })}
              </span>
              <span className="show-card__date-day">{showDate.getDate()}</span>
              <span className="show-card__date-sub">
                {isCurrentYear
                  ? showDate.toLocaleDateString(undefined, { weekday: 'short' })
                  : showDate.getFullYear()}
              </span>
            </>
          ) : (
            <span className="show-card__date-tbd">TBD</span>
          )}
        </div>

        <div className="show-card__main">
          <h2 className="show-card__title">{show.name}</h2>
          {/* Separators are drawn by CSS on the *following* item, not written
              between items as their own elements. A standalone "·" is a flex
              child that can be left stranded at the end of a wrapped line —
              which is exactly what a phone-width card used to show. */}
          <div className="show-card__meta">
            {/* Only one of these two is ever displayed — the lead on a phone,
                where it stands in for the date block, and the when-label at
                every other width, where the date block is still there. */}
            <span className="show-card__meta-item show-card__meta-lead">{leadStr}</span>
            {timeStr && <span className="show-card__meta-item show-card__meta-time">{timeStr}</span>}
            {whenStr && <span className="show-card__meta-item show-card__meta-when">{whenStr}</span>}
            {show.venueName && (
              <span className="show-card__meta-item show-card__meta-venue">{show.venueName}</span>
            )}
            {place && <span className="show-card__meta-item show-card__meta-place">{place}</span>}
            <span className="show-card__status">{STATUS_LABELS[show.status]}</span>
          </div>
        </div>

        <div className="show-card__actions">
          <button
            className="show-card__action-btn"
            onClick={handleDuplicate}
            aria-label="Duplicate show"
            title="Duplicate show"
          >
            ⧉
          </button>
          <button
            className="show-card__action-btn show-card__action-btn--delete"
            onClick={handleDelete}
            aria-label="Delete show"
            title="Delete show"
          >
            ×
          </button>
        </div>

        {/* Phone only. A row that opens something says so with a chevron —
            it is the one mark iOS uses for "this goes somewhere", and this
            list had nothing saying it at all. Decoration, not a control: the
            overlay button behind it is what you actually tap. */}
        <span className="show-card__chevron" aria-hidden="true" />
      </div>

      {(lineupFact || facts.length > 0 || sceneCount > 0) && (
        <div className="show-card__footer">
          {(lineupFact || facts.length > 0) && (
            <span className="show-card__facts">
              {lineupFact && (
                <span
                  className={`show-card__fact show-card__lineup${lineup.full ? ' show-card__lineup--full' : ''}`}
                >
                  {lineupFact}
                </span>
              )}
              {facts.map((fact) => (
                <span key={fact} className="show-card__fact">{fact}</span>
              ))}
            </span>
          )}
          {sceneCount > 0 && (
            <div className="show-card__progress-wrap">
              <div
                className="show-card__progress"
                role="progressbar"
                aria-valuenow={doneCount}
                aria-valuemin={0}
                aria-valuemax={sceneCount}
                aria-label={`${doneCount} of ${sceneCount} scenes done`}
              >
                <div
                  className="show-card__progress-bar"
                  style={{ width: `${(doneCount / sceneCount) * 100}%` }}
                />
              </div>
              {/* "2/3" on its own was a fraction of nothing in particular. */}
              <span className="show-card__progress-label" aria-hidden="true">
                {doneCount}/{sceneCount} scenes
              </span>
            </div>
          )}
        </div>
      )}
      {confirmDialog}
    </article>
  );
}
