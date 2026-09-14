import type { Show } from '../types';
import type { ShowContext } from './contracts';
import { rolodexKey } from './rolodex';
import { parseShowDate } from './showDate';

/**
 * Which show a contract is for, when it is sent from the Contracts screen.
 *
 * Sent from inside a show, the answer is obvious and the show is handed over
 * directly. Sent from the library — More → Contracts, pick a name — nothing
 * said which night it was for, so the date and the venue went out blank and
 * the performer was asked to fill in facts only the producer knows.
 *
 * So: the soonest show they are booked on that has not happened yet. Not a
 * guess so much as the only reading that makes sense — a contract sent today
 * to someone booked on Friday is for Friday. A cancelled show is not it, and
 * neither is last month's. When they are on nothing upcoming there is nothing
 * to fill in and the fields stay empty, as before.
 *
 * Whatever this picks, the performer sees it filled in and can correct it;
 * these are ordinary values in the field, not locked ones.
 */
export function showContextForSigner(
  shows: Show[] | undefined,
  signerName: string,
  now = new Date(),
): ShowContext | undefined {
  const key = rolodexKey(signerName);
  if (!key) return undefined;
  // Midnight today, so a show happening tonight still counts as upcoming.
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  const candidates = (shows ?? [])
    .filter((show) => show.status !== 'cancelled')
    .filter((show) => (show.performers ?? []).some((p) => rolodexKey(p.name) === key))
    .map((show) => ({ show, at: parseShowDate(show.date)?.getTime() }))
    .filter((c): c is { show: Show; at: number } => c.at !== undefined && c.at >= today)
    .sort((a, b) => a.at - b.at);

  const soonest = candidates[0]?.show;
  if (!soonest) return undefined;
  return {
    showName: soonest.name,
    date: soonest.date,
    time: soonest.time,
    venueName: soonest.venueName,
    location: soonest.location,
  };
}
