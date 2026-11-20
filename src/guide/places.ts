/**
 * Where the guide can take the app.
 *
 * A step names a place, never a click path: App turns the place into the
 * same state changes its own navigation makes (see guideGo in App.tsx), so
 * the tour and the wizards can only ever land on a page a producer could
 * have reached by hand.
 */
import type { SectionKey, Show } from '../types';
import { toDateKey } from '../utils/showDate';

export type GuidePageView = 'list' | 'rolodex' | 'music' | 'more' | 'contracts' | 'season' | 'emails' | 'expenses' | 'help';

export type GuidePlace =
  | { view: GuidePageView }
  /** `anchor` names the Settings card the step is about; the outline scrolls to it. */
  | { view: 'settings'; anchor?: string }
  /** The sample show, or one of the producer's own. */
  | { view: 'detail'; show: 'sample' | 'real'; section?: SectionKey }
  /** Wizards only: the Shows page with the New show form open. */
  | { view: 'list'; newShow: true };

/** Every view a place may name. guideGo handles exactly these. */
export const GUIDE_VIEWS: readonly string[] = [
  'list', 'rolodex', 'music', 'more', 'contracts', 'season', 'emails', 'expenses', 'help', 'settings', 'detail',
];

/** Which show a place opens, or null when it is not a show's page. */
export function placeShow(place: GuidePlace | undefined): 'sample' | 'real' | null {
  return place && place.view === 'detail' ? place.show : null;
}

export function opensNewShow(place: GuidePlace | undefined): boolean {
  return !!place && 'newShow' in place && place.newShow === true;
}

/**
 * The show a step opens.
 *
 * 'sample' is the newest sample show. 'real' is the next of the producer's
 * own shows still ahead, else the one they touched last: the show they are
 * most likely working on. The sample never stands in for a real show.
 */
export function resolveShow(shows: readonly Show[], which: 'sample' | 'real', today: Date = new Date()): Show | null {
  if (which === 'sample') {
    const samples = shows.filter((show) => show.sample);
    if (samples.length === 0) return null;
    return samples.reduce((newest, show) => (show.createdAt > newest.createdAt ? show : newest));
  }
  const real = shows.filter((show) => !show.sample);
  if (real.length === 0) return null;
  const todayKey = toDateKey(today);
  const ahead = real
    .filter((show) => !!show.date && show.date >= todayKey && show.status !== 'completed' && show.status !== 'cancelled')
    .sort((a, b) => a.date.localeCompare(b.date));
  if (ahead.length > 0) return ahead[0];
  return real.reduce((latest, show) => (show.updatedAt > latest.updatedAt ? show : latest));
}
