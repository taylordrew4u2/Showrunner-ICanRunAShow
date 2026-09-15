import type { DJSong, ScheduleItem } from '../types';
import { baseDurations } from './showTiming';

/**
 * "1h 45m" — how long the running order runs.
 *
 * Uses the same allocations as Run Show, including the final cue, so the
 * planning figure and the countdown on the night cannot disagree.
 */
export function runtimeLabel(items: ScheduleItem[]): string | null {
  if (items.length === 0) return null;
  const total = Math.round(baseDurations(items).reduce((sum, seconds) => sum + seconds, 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours && `${hours}h`, minutes && `${minutes}m`, seconds && `${seconds}s`]
    .filter(Boolean).join(' ');
}

/** A new file owns its own trim; never carry the previous file's cut over. */
export function cueAudioPatch(
  song?: Pick<DJSong, 'music' | 'musicName' | 'startSec' | 'endSec'>,
): Partial<ScheduleItem> {
  return {
    music: song?.music,
    musicName: song?.musicName,
    musicStartSec: song?.startSec,
    musicEndSec: song?.endSec,
    musicDuration: undefined,
  };
}
