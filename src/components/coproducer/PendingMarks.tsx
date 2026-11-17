/**
 * The co-producer's open requests, shown where they apply: a chip on a show
 * card or a section, the proposed values under the field they change, a row
 * struck through when its removal is waiting, and a ghost card for a show a
 * request would add. Every one of these renders nothing outside co-producer
 * view, where there is no overlay to read.
 */
import { usePendingMarks, usePendingNewShows, type PendingMark } from '../../coproducer/PendingOverlay';
import { resolveMediaUrl } from '../../utils/mediaStore';
import { ChangeList } from './ChangeList';
import './coproducer.css';

/** Past this many, the marks under one place fold to a single line. */
const INLINE_AT_MOST = 3;

function countWords(n: number): string {
  return `${n} ${n === 1 ? 'change' : 'changes'}`;
}

/** A red outlined pill "Pending approval" (with a count when more than one), or nothing. */
export function PendingChip({ groupKey, prefix }: { groupKey: string; prefix?: string }) {
  const marks = usePendingMarks(groupKey, prefix);
  if (marks.length === 0) return null;
  return (
    <span className="pending-pill" role="note" aria-label={`Pending approval: ${countWords(marks.length)}`}>
      Pending approval
      {marks.length > 1 && <span className="pending-pill__count" aria-hidden="true">· {marks.length}</span>}
    </span>
  );
}

function groupOf(groupKey: string, marks: PendingMark[], title = '') {
  return [{ key: groupKey, title, changes: marks.map((mark) => mark.change) }];
}

/** The marks under one place as an inline list: now, and the proposed value in red. Folded to one line past three. */
export function PendingInline({ groupKey, prefix, title }: { groupKey: string; prefix?: string; title?: string }) {
  const marks = usePendingMarks(groupKey, prefix);
  if (marks.length === 0) return null;
  const list = <ChangeList groups={groupOf(groupKey, marks, title)} resolveMedia={resolveMediaUrl} />;
  if (marks.length <= INLINE_AT_MOST) {
    return <div className="pending-inline" role="group" aria-label="Pending approval">{list}</div>;
  }
  return (
    <details className="pending-inline">
      <summary className="pending-inline__summary">
        {title ? `${title}: ` : ''}{countWords(marks.length)} waiting for approval
        <span className="pending-pill">Pending approval</span>
      </summary>
      {list}
    </details>
  );
}

/**
 * A row's title, struck through with "Pending approval: remove" when a
 * request would remove the row, or with the plain chip when it changes it.
 */
export function PendingRowMark({ groupKey, rowKey, children }: { groupKey: string; rowKey: string; children: React.ReactNode }) {
  const marks = usePendingMarks(groupKey, rowKey);
  if (marks.length === 0) return <>{children}</>;
  const removal = marks.some((mark) => mark.change.key === rowKey && mark.change.change === 'removed');
  if (removal) {
    return (
      <span className="pending-row pending-row--removed">
        <s className="pending-row__title">{children}</s>
        <span className="pending-pill" role="note">Pending approval: remove</span>
      </span>
    );
  }
  return (
    <span className="pending-row">
      <span className="pending-row__title">{children}</span>
      <span className="pending-pill" role="note" aria-label={`Pending approval: ${countWords(marks.length)}`}>Pending approval</span>
    </span>
  );
}

/** Ghost cards for shows that open requests would create: muted, not clickable, the name and the red pill. */
export function PendingNewShows() {
  const shows = usePendingNewShows();
  if (shows.length === 0) return null;
  return (
    <div className="pending-new-shows">
      {shows.map((show) => (
        <div
          key={`${show.requestId}:${show.showId}`}
          className="show-card pending-ghost"
          role="group"
          aria-label={`${show.name}: a new show, pending approval`}
        >
          <div className="pending-ghost__row">
            <h2 className="show-card__title">{show.name}</h2>
            <span className="pending-pill">Pending approval</span>
          </div>
        </div>
      ))}
    </div>
  );
}
