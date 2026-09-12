import type { DJSong, ScheduleItem } from '../types';
import { baseDurations } from './showTiming';

/** Use the same allocations as Run Show, including the final cue. */
export function totalRuntimeLabel(items: ScheduleItem[]): string | null {
  if (items.length === 0) return null;
  const total = Math.round(baseDurations(items).reduce((sum, seconds) => sum + seconds, 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours && `${hours}h`, minutes && `${minutes}m`, seconds && `${seconds}s`]
    .filter(Boolean).join(' ') + ' total';
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
