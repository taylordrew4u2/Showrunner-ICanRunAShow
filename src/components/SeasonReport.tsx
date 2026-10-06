import { useEffect, useMemo, useRef, useState } from 'react';
import type { Expense, Show } from '../types';
import { DEFAULT_SETTINGS } from '../types';
import { buildSeasonReport, formatMoney, seasonPitch, type SeasonRange } from '../utils/seasonReport';
import { PageHeader } from './PageHeader';
import './SeasonReport.css';

interface SeasonReportProps {
  shows: Show[];
  brandExpenses: Expense[];
  brandName: string;
  onBack: () => void;
  backLabel?: string;
}

type Copied = 'none' | 'done' | 'failed';

/**
 * Every show added up. A producer asking a new room for a Thursday is asked
 * the same three things — how many shows, how many people, who's on them —
 * and until now the answer lived in their head or nowhere.
 */
export function SeasonReport({ shows, brandExpenses, brandName, onBack, backLabel = 'More' }: SeasonReportProps) {
  const [range, setRange] = useState<SeasonRange>('year');
  const [copied, setCopied] = useState<Copied>('none');
  // One reset at a time: a second press restarts the clock rather than being
  // cut short by the first press's timer, and leaving the page cancels it.
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(resetTimer.current), []);
  const report = useMemo(() => buildSeasonReport(shows, brandExpenses, range), [shows, brandExpenses, range]);
  // The placeholder brand would make the pitch read "Show Producer has
  // produced…", which is worse than the plain "We have".
  const name = brandName === DEFAULT_SETTINGS.brandName ? '' : brandName;
  const pitch = useMemo(() => seasonPitch(report, name, range), [report, name, range]);
  const year = new Date().getFullYear();

  async function copyPitch() {
    try {
      await navigator.clipboard.writeText(pitch);
      setCopied('done');
    } catch {
      // Refused clipboards are ordinary (insecure origin, locked-down browser);
      // the text is on the page to select by hand.
      setCopied('failed');
    }
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied('none'), 2500);
  }

  const tiles: { label: string; value: string; note?: string; tone?: 'good' | 'bad' }[] = [
    { label: 'Shows run', value: String(report.run), note: report.upcoming ? `${report.upcoming} coming up` : undefined },
    {
      label: 'Audience',
      value: report.audience.toLocaleString('en-US'),
      note: report.showsWithAudience ? `${report.averageAudience} a night on average` : 'Add attendance in a show’s recap',
    },
    { label: 'Performers booked', value: String(report.uniquePerformers), note: `${report.bookings} spots filled` },
    {
      label: 'Net',
      value: formatMoney(report.net),
      note: `${formatMoney(report.revenue)} in, ${formatMoney(report.showCosts)} out`,
      tone: report.net > 0 ? 'good' : report.net < 0 ? 'bad' : undefined,
    },
  ];

  return (
    <div className="season-page">
      <PageHeader
        title="Season report"
        subtitle="Every show added up — what you’ve built, and the numbers to pitch your next room with."
        onBack={onBack}
        backLabel={backLabel}
      />

      <div className="season__range" role="group" aria-label="Period">
        {(['year', 'all'] as SeasonRange[]).map((r) => (
          <button
            key={r}
            type="button"
            className={`season__range-btn ${range === r ? 'season__range-btn--active' : ''}`}
            aria-pressed={range === r}
            onClick={() => setRange(r)}
          >
            {r === 'year' ? String(year) : 'All time'}
          </button>
        ))}
      </div>

      {report.shows === 0 ? (
        <div className="season__empty">
          <p className="season__empty-title">No shows {range === 'year' ? `dated in ${year}` : 'yet'}.</p>
          <p>Once you’ve run a few, this page tallies the audience, the money and who you keep booking.</p>
        </div>
      ) : (
        <>
          <div className="season__tiles">
            {tiles.map((t) => (
              <div key={t.label} className={`season__tile ${t.tone ? `season__tile--${t.tone}` : ''}`}>
                <span className="season__tile-label">{t.label}</span>
                <span className="season__tile-value">{t.value}</span>
                {t.note && <span className="season__tile-note">{t.note}</span>}
              </div>
            ))}
          </div>

          <div className="season__columns">
            <section className="season__panel" aria-labelledby="season-regulars">
              <h2 id="season-regulars" className="season__panel-title">Your regulars</h2>
              {report.topPerformers.length ? (
                <ol className="season__rank">
                  {report.topPerformers.map((p, i) => (
                    <li key={`${i}-${p.name}`}>
                      <span>{p.name}</span>
                      <span className="season__rank-count">{p.count} {p.count === 1 ? 'show' : 'shows'}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="season__muted">Nobody on a lineup yet.</p>
              )}
            </section>

            <section className="season__panel" aria-labelledby="season-rooms">
              <h2 id="season-rooms" className="season__panel-title">Your rooms</h2>
              {report.topVenues.length ? (
                <ol className="season__rank">
                  {report.topVenues.map((v, i) => (
                    <li key={`${i}-${v.name}`}>
                      <span>{v.name}</span>
                      <span className="season__rank-count">{v.count} {v.count === 1 ? 'show' : 'shows'}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="season__muted">Add a venue to your shows to see where you play most.</p>
              )}
              {report.bestNight && (
                <p className="season__best">
                  Biggest night: <strong>{report.bestNight.name}</strong> — {report.bestNight.attendance.toLocaleString('en-US')} people
                </p>
              )}
            </section>
          </div>

          <section className="season__panel" aria-labelledby="season-money">
            <h2 id="season-money" className="season__panel-title">Money</h2>
            <dl className="season__money">
              <div><dt>Merch &amp; sales (from recaps)</dt><dd>{formatMoney(report.revenue)}</dd></div>
              <div><dt>Show costs</dt><dd>{formatMoney(report.showCosts)}</dd></div>
              <div><dt>Brand spending</dt><dd>{formatMoney(report.brandSpending)}</dd></div>
              <div className="season__money-total">
                <dt>Net after everything</dt>
                <dd>{formatMoney(report.net - report.brandSpending)}</dd>
              </div>
            </dl>
            {report.cancelled > 0 && (
              <p className="season__muted">Includes costs from {report.cancelled} cancelled {report.cancelled === 1 ? 'show' : 'shows'}.</p>
            )}
          </section>

          <section className="season__panel season__pitch" aria-labelledby="season-pitch">
            <h2 id="season-pitch" className="season__panel-title">Pitch a venue</h2>
            <p className="season__muted">Your track record in a few lines, for the email to a room you want to book. Nothing is sent — it’s copied for you to paste.</p>
            <pre className="season__pitch-text">{pitch}</pre>
            <button type="button" className="btn btn--primary" onClick={copyPitch}>
              {copied === 'done' ? 'Copied' : copied === 'failed' ? 'Couldn’t copy — select the text above' : 'Copy pitch'}
            </button>
          </section>
        </>
      )}
    </div>
  );
}
