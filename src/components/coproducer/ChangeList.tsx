import { useEffect, useState } from 'react';
import type { ChangeGroup, Conflict, FieldChange, HandOver } from '../../coproducer/types';
import './coproducer.css';

/**
 * What a request changes, change by change: what is there now beside what is
 * asked for, the asked-for value in red and labelled "Pending approval".
 *
 * Both producers read it: the co-producer before sending and while waiting,
 * the owner on each request card. Every value arrives as whole text from the
 * diff (never cut there) and is rendered as text, never as markup. Long text
 * shows a window around where the two sides first differ, with the whole of
 * both a tap away; it is in the page either way, inside a <details>.
 */

/** Past this, a value shows a window around the difference rather than all of it. */
const LONG_CHARS = 300;
const LONG_LINES = 6;
/** How much of a long value shows either side of where the two sides first differ. */
const WINDOW = 120;
/** Changes shown in a group before the rest fold away, except on the owner's card. */
const FOLD_AFTER = 30;

/** Only pictures the app made itself: never a link to somewhere else. */
const SAFE_IMAGE = /^(?:data:image\/|blob:)/i;

type Resolve = (ref: string) => Promise<string | null>;

export interface ChangeListProps {
  groups: ChangeGroup[];
  /** Turns a media ref into something an <img> can show; omitted means no previews. */
  resolveMedia?: Resolve;
  /** The owner's inbox: values changed since the request was made. */
  conflicts?: Conflict[];
  /** Who asked, for the conflicts' heading. Defaults to "they". */
  who?: string;
  /** Column names. Defaults: 'Now' and 'Pending approval'. */
  nowLabel?: string;
  proposedLabel?: string;
  /** The owner's inbox: no "Show {n} more" folding, so nothing is hidden behind a toggle except long text. */
  complete?: boolean;
}

function isLong(text: string | null): boolean {
  return !!text && (text.length > LONG_CHARS || text.split('\n').length > LONG_LINES);
}

/** Where two texts first differ, in characters (code points, so no emoji is split). */
function firstDifference(a: string[], b: string[]): number {
  const shortest = Math.min(a.length, b.length);
  for (let i = 0; i < shortest; i++) if (a[i] !== b[i]) return i;
  return shortest;
}

/** The part of `text` around `at`, with "…" where it was cut. */
function windowOf(chars: string[], at: number): string {
  const start = Math.max(0, at - WINDOW);
  const end = Math.min(chars.length, Math.max(at, start) + WINDOW);
  return `${start > 0 ? '…' : ''}${chars.slice(start, end).join('')}${end < chars.length ? '…' : ''}`;
}

/** Both sides of a change cut to a window around their first difference, or null when neither is long. */
function changeWindows(before: string | null, after: string | null): { before: string | null; after: string | null } | null {
  if (!isLong(before) && !isLong(after)) return null;
  const a = Array.from(before ?? '');
  const b = Array.from(after ?? '');
  const at = firstDifference(a, b);
  return {
    before: before === null ? null : windowOf(a, at),
    after: after === null ? null : windowOf(b, at),
  };
}

function Nothing() {
  return <span className="change-list__nothing">Nothing</span>;
}

function PendingPill() {
  return <span className="pending-pill">Pending approval</span>;
}

/** A picture of one side, fetched once it is on screen. */
function Thumb({ media, resolve, alt }: { media: string; resolve: Resolve; alt: string }) {
  const [url, setUrl] = useState<{ media: string; url: string } | null>(null);
  useEffect(() => {
    let live = true;
    resolve(media)
      .then((resolved) => {
        if (live && resolved && SAFE_IMAGE.test(resolved)) setUrl({ media, url: resolved });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [media, resolve]);
  if (!url || url.media !== media) return null;
  return <img className="change-list__thumb" src={url.url} alt={alt} width={64} height={64} loading="lazy" />;
}

function Where({ path, label }: { path: string[]; label: string }) {
  return (
    <p className="change-list__where">
      {path.length > 0 && <span className="change-list__path">{path.join(' › ')}</span>}
      <strong className="change-list__label">{label}</strong>
    </p>
  );
}

/** One side's value: the text, or "Nothing". */
function Text({ text }: { text: string | null }) {
  return text === null ? <Nothing /> : <>{text}</>;
}

/** The proposed side of a change, in red, with "Pending approval" on it. */
function Proposed({ change, text }: { change: FieldChange; text: string | null }) {
  return (
    <>
      {change.change === 'removed' ? 'Removed' : <Text text={text} />}
      <PendingPill />
    </>
  );
}

function Change({ change, resolve, nowLabel, proposedLabel }: {
  change: FieldChange;
  resolve?: Resolve;
  nowLabel: string;
  proposedLabel: string;
}) {
  const windows = changeWindows(change.before, change.after);
  const image = change.media?.kind === 'image' && resolve ? change.media : null;
  const values = (before: string | null, after: string | null, pictures: boolean) => (
    <dl className="change-list__values">
      <div className="change-list__side">
        <dt>{nowLabel}</dt>
        <dd>
          <Text text={before} />
          {pictures && image?.before && (
            <span className="change-list__thumbs">
              <Thumb media={image.before} resolve={resolve!} alt={`${nowLabel}: ${change.label}`} />
            </span>
          )}
        </dd>
      </div>
      <div className="change-list__side change-list__proposed">
        <dt>{proposedLabel}</dt>
        <dd className="coproducer-proposed">
          <Proposed change={change} text={after} />
          {pictures && image?.after && (
            <span className="change-list__thumbs">
              <Thumb media={image.after} resolve={resolve!} alt={`${proposedLabel}: ${change.label}`} />
            </span>
          )}
        </dd>
      </div>
    </dl>
  );
  return (
    <div className="change-list__change">
      <Where path={change.path} label={change.label} />
      {windows ? values(windows.before, windows.after, true) : values(change.before, change.after, true)}
      {windows && (
        <details className="change-list__all">
          <summary>Show all</summary>
          {values(change.before, change.after, false)}
        </details>
      )}
    </div>
  );
}

/** A long value of a share's details: the start, and the rest a tap away. */
function DetailValue({ value }: { value: string }) {
  const windows = changeWindows(value, null);
  if (!windows) return <>{value}</>;
  return (
    <>
      {windows.before}
      <details className="change-list__all">
        <summary>Show all</summary>
        {value}
      </details>
    </>
  );
}

/** A share or download: what would be handed over, in place of "Now". */
function HandOverChange({ change, handOver, resolve, proposedLabel }: {
  change: FieldChange;
  handOver: HandOver;
  resolve?: Resolve;
  proposedLabel: string;
}) {
  const image = handOver.media?.kind === 'image' && resolve ? handOver.media.ref : null;
  return (
    <div className="change-list__change">
      <Where path={change.path} label={change.label} />
      <dl className="change-list__values">
        <div className="change-list__side">
          <dt>What</dt>
          <dd>
            {handOver.what}
            {image && (
              <span className="change-list__thumbs">
                <Thumb media={image} resolve={resolve!} alt={handOver.what} />
              </span>
            )}
            {handOver.details.length > 0 && (
              <dl className="change-list__details">
                {handOver.details.map((line, i) => (
                  <div key={`${line.label}:${i}`}>
                    <dt>{line.label}</dt>
                    <dd><DetailValue value={line.value} /></dd>
                  </div>
                ))}
              </dl>
            )}
          </dd>
        </div>
        <div className="change-list__side change-list__proposed">
          <dt>{proposedLabel}</dt>
          <dd className="coproducer-proposed">
            <Proposed change={change} text={change.after} />
          </dd>
        </div>
      </dl>
    </div>
  );
}

function Group({ group, resolve, nowLabel, proposedLabel, complete }: {
  group: ChangeGroup;
  resolve?: Resolve;
  nowLabel: string;
  proposedLabel: string;
  complete: boolean;
}) {
  const render = (change: FieldChange, i: number) =>
    group.handOver ? (
      <HandOverChange key={`${change.key}:${i}`} change={change} handOver={group.handOver} resolve={resolve} proposedLabel={proposedLabel} />
    ) : (
      <Change key={`${change.key}:${i}`} change={change} resolve={resolve} nowLabel={nowLabel} proposedLabel={proposedLabel} />
    );
  const shown = complete ? group.changes : group.changes.slice(0, FOLD_AFTER);
  const rest = complete ? [] : group.changes.slice(FOLD_AFTER);
  return (
    <div className="change-list__group">
      {group.title && (
        <h3 className="change-list__title">
          {group.title}
          {group.note && <span className="change-list__note">{group.note}</span>}
        </h3>
      )}
      {shown.map(render)}
      {rest.length > 0 && (
        <details className="change-list__more">
          <summary>Show {rest.length} more</summary>
          <div className="change-list__group-rest">{rest.map((change, i) => render(change, FOLD_AFTER + i))}</div>
        </details>
      )}
    </div>
  );
}

function Conflicts({ conflicts, who, nowLabel }: { conflicts: Conflict[]; who: string; nowLabel: string }) {
  return (
    <div className="change-list__conflicts">
      <h3 className="change-list__conflicts-title">Changed since they asked</h3>
      <p className="change-list__conflicts-hint">You've changed these since {who} asked.</p>
      {conflicts.map((conflict, i) => (
        <div className="change-list__change" key={`${conflict.groupKey}:${conflict.key}:${i}`}>
          <Where path={conflict.path} label={conflict.label} />
          <dl className="change-list__values">
            <div className="change-list__side">
              <dt>When they asked</dt>
              <dd><Text text={conflict.asked} /></dd>
            </div>
            <div className="change-list__side">
              <dt>{nowLabel}</dt>
              <dd><Text text={conflict.now} /></dd>
            </div>
            <div className="change-list__side change-list__proposed">
              <dt>Their version</dt>
              <dd className="coproducer-proposed">
                <Text text={conflict.proposed} />
                <PendingPill />
              </dd>
            </div>
          </dl>
        </div>
      ))}
    </div>
  );
}

export function ChangeList({
  groups,
  resolveMedia,
  conflicts,
  who = 'they',
  nowLabel = 'Now',
  proposedLabel = 'Pending approval',
  complete = false,
}: ChangeListProps) {
  return (
    <div className="change-list">
      {conflicts && conflicts.length > 0 && <Conflicts conflicts={conflicts} who={who} nowLabel={nowLabel} />}
      {groups.map((group, i) => (
        <Group
          key={`${group.key}:${i}`}
          group={group}
          resolve={resolveMedia}
          nowLabel={nowLabel}
          proposedLabel={proposedLabel}
          complete={complete}
        />
      ))}
    </div>
  );
}
