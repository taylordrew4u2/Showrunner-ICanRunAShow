import { useState } from 'react';
import type { ScheduleItem } from '../types';
import { buildTimeline, segmentLength, billBalance, clockLabel } from '../utils/showTimeline';
import './ShowTimeline.css';

interface ShowTimelineProps {
  schedule: ScheduleItem[];
  /** The show's start time, used when no cue carries one of its own. */
  showTime?: string;
}

/**
 * The night as one proportional strip.
 *
 * The strip is an *addition* to the cue list below it, never a replacement:
 * everything here is also stated in words, and every segment is a real button
 * you can reach with a keyboard. Someone who can't see the proportions loses
 * the shape of the night but no information.
 */
export function ShowTimeline({ schedule, showTime }: ShowTimelineProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const timeline = buildTimeline(schedule, showTime);
  if (!timeline) return null;

  const { segments, totalSec, startMinutes, endMinutes, longestId } = timeline;
  const balance = billBalance(segments);
  const setCount = segments.filter((s) => s.kind === 'set').length;
  const open = segments.find((s) => s.id === openId) ?? null;

  const stageSec = segments.filter((s) => s.kind === 'set').reduce((sum, s) => sum + s.durationSec, 0);
  const stagePct = Math.round((stageSec / totalSec) * 100);

  return (
    <section className="timeline" aria-labelledby="timeline-heading">
      <div className="timeline__head">
        <h3 className="timeline__heading" id="timeline-heading">Shape of the night</h3>
        <p className="timeline__totals">
          {startMinutes != null && endMinutes != null && (
            <span className="timeline__totals-clock">
              {clockLabel(startMinutes)} – {clockLabel(endMinutes)}
            </span>
          )}
          <span>{segmentLength(totalSec)}</span>
          {setCount > 0 && <span>{stagePct}% on stage</span>}
        </p>
      </div>

      {/* The strip. Each segment is a button so it can be tabbed to and opened;
          the label underneath is what actually conveys the content. */}
      <ul className="timeline__strip">
        {segments.map((segment) => (
          <li
            key={segment.id}
            className="timeline__slot"
            style={{ flexGrow: segment.widthPct }}
          >
            <button
              type="button"
              className={[
                'timeline__seg',
                `timeline__seg--${segment.kind}`,
                segment.id === longestId ? 'timeline__seg--longest' : '',
                segment.id === openId ? 'timeline__seg--open' : '',
              ].filter(Boolean).join(' ')}
              aria-expanded={segment.id === openId}
              aria-label={[
                segment.clock ? `${segment.clock},` : '',
                segment.label + ',',
                segmentLength(segment.durationSec) + ',',
                segment.performer ? `${segment.performer} on stage,` : 'no performer,',
                `${Math.round(segment.sharePct)}% of the night`,
              ].filter(Boolean).join(' ')}
              onClick={() => setOpenId((id) => (id === segment.id ? null : segment.id))}
            >
              {/* Kind is carried by a hatch pattern as well as colour, so the
                  set/turnaround split survives a monochrome or colour-blind
                  reading of the strip. */}
              <span className="timeline__seg-fill" aria-hidden="true" />
              <span className="timeline__seg-text" aria-hidden="true">
                {segment.performer || segment.label}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {open ? (
        <p className="timeline__detail" role="status">
          <strong>{open.performer || open.label}</strong>
          {open.performer && <span className="timeline__detail-sub"> — {open.label}</span>}
          <span className="timeline__detail-facts">
            {[
              open.clock,
              segmentLength(open.durationSec),
              `${Math.round(open.sharePct)}% of the night`,
            ].filter(Boolean).join(' · ')}
          </span>
        </p>
      ) : (
        <p className="timeline__hint">
          {balance && balance.ratio >= 2
            ? `${balance.longest.performer} has ${Math.round(balance.ratio * 10) / 10}× the time of ${balance.shortest.performer}.`
            : 'Pick a block to see who it is and how long they have.'}
        </p>
      )}
    </section>
  );
}
