// Roll a show up into the numbers the show page's overview tiles display.
// Kept out of the component so the arithmetic is testable on its own and the
// component stays about layout.
import type { Show } from '../types';

export interface ProgressStat {
  key: string;
  label: string;
  done: number;
  total: number;
}

export interface ShowStats {
  counts: {
    performers: number;
    artists: number;
    cues: number;
    songs: number;
    staff: number;
    vendors: number;
    expenses: number;
    todos: number;
  };
  /** Sum of every cue that carries a duration. */
  runMinutes: number;
  progress: ProgressStat[];
}

// Costs and durations arrive from imports and hand-typed fields, so anything
// non-numeric (undefined, '', NaN) has to count as zero rather than poison the
// whole sum into NaN.
function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function hasWalkOn(performer: Show['performers'][number]): boolean {
  return !!(performer.walkOnMusic || performer.walkOnMusicName || performer.walkOnMusicLink);
}

export function buildShowStats(show: Show): ShowStats {
  const performers = show.performers ?? [];
  const artists = show.artists ?? [];
  const schedule = show.schedule ?? [];
  const songs = show.djSongs ?? [];
  const staff = show.staff ?? [];
  const vendors = show.vendors ?? [];
  const expenses = show.expenses ?? [];
  const todos = show.todos ?? [];


  return {
    counts: {
      performers: performers.length,
      artists: artists.length,
      cues: schedule.length,
      songs: songs.length,
      staff: staff.length,
      vendors: vendors.length,
      expenses: expenses.length,
      todos: todos.length,
    },
    runMinutes: schedule.reduce((sum, cue) => sum + num(cue.durationMin), 0),
    progress: [
      // Only meaningful once a target is set; total 0 drops the bar entirely.
      {
        key: 'lineup',
        label: 'Lineup booked',
        done: performers.length,
        total: num(show.performerTarget),
      },
      {
        key: 'walkon',
        label: 'Walk-on music set',
        done: performers.filter(hasWalkOn).length,
        total: performers.length,
      },
      {
        key: 'cues',
        label: 'Cues timed',
        done: schedule.filter((cue) => num(cue.durationMin) > 0).length,
        total: schedule.length,
      },
      {
        key: 'vendors',
        label: 'Vendors booked',
        done: vendors.filter((v) => v.booked).length,
        total: vendors.length,
      },
    ],
  };
}

/**
 * An empty section is 0%, not a division by zero. Over-full is 100%, not 120% —
 * a bar wider than its track, and booking one act too many is not "more than
 * complete".
 */
export function progressPercent(stat: ProgressStat): number {
  if (stat.total <= 0) return 0;
  return Math.min(100, Math.round((stat.done / stat.total) * 100));
}

/** Whether a target has been met — the "the lineup is full" signal. */
export function isComplete(stat: ProgressStat): boolean {
  return stat.total > 0 && stat.done >= stat.total;
}

export function formatRunTime(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  if (total === 0) return '—';
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}
