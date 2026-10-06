// A show to press Run on before you've built one. A new producer's first
// screen was an empty list and a form, and the part of the app that sells it —
// the clock counting a set down and saying you're running long — sat three
// sections and a lineup away.
import type { ScheduleItem, Show } from '../types';
import { clockLabel } from './elapsed';
import { DEFAULT_SECTIONS, hiddenFromSelected } from './showBlocks';
import { generateId } from './id';
import { toDateKey } from './showDate';

export const SAMPLE_SHOW_NAME = 'Sample Show — try Run Show';

// Roles, not names: performers here would be filed into the Rolodex as real
// people, so the bill lives only in the running order's free text.
const RUNNING_ORDER: { what: string; who?: string; minutes: number }[] = [
  { what: 'Doors & house music', minutes: 30 },
  { what: 'Host opens', who: 'Host', minutes: 5 },
  { what: 'Opening act', who: 'Opener', minutes: 7 },
  { what: 'Middle act', who: 'Middle', minutes: 10 },
  { what: 'Intermission', minutes: 10 },
  { what: 'Feature', who: 'Feature', minutes: 12 },
  { what: 'Headliner', who: 'Headliner', minutes: 20 },
  { what: 'Host closes & thank-yous', who: 'Host', minutes: 3 },
];

export function buildSampleShow(today: Date = new Date()): Omit<Show, 'id' | 'createdAt' | 'updatedAt'> {
  const date = new Date(today);
  date.setDate(date.getDate() + 7);

  // Doors at 7:30 so the show itself starts at 8.
  let at = 19 * 60 + 30;
  const schedule: ScheduleItem[] = RUNNING_ORDER.map((cue) => {
    const item: ScheduleItem = {
      id: generateId(),
      time: clockLabel(at),
      description: cue.what,
      performer: cue.who,
      durationMin: cue.minutes,
    };
    at += cue.minutes;
    return item;
  });

  return {
    name: SAMPLE_SHOW_NAME,
    date: toDateKey(date),
    time: '8:00 PM',
    venueName: 'The Basement',
    location: '',
    status: 'upcoming',
    sample: true,
    performers: [],
    artists: [],
    schedule,
    hosts: [],
    djSongs: [],
    staff: [],
    vendors: [],
    expenses: [],
    hiddenSections: hiddenFromSelected(DEFAULT_SECTIONS),
    productionNotes:
      'This is a sample. Press Run Show to watch the clock count each set down, then delete this show whenever you like — nothing else in your account depends on it.',
  };
}
