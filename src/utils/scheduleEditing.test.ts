import { describe, expect, it } from 'vitest';
import type { ScheduleItem } from '../types';
import { buildSoundboard } from './soundboard';
import { cueAudioPatch, runtimeLabel } from './scheduleEditing';

const cue = (patch: Partial<ScheduleItem> = {}): ScheduleItem => ({
  id: 'cue', time: '', description: 'Intro', ...patch,
});

describe('schedule runtime summary', () => {
  it('includes the final segment and respects explicit lengths over clock gaps', () => {
    expect(runtimeLabel([
      cue({ time: '8:00 PM', durationMin: 10 }),
      cue({ id: 'last', time: '8:10 PM', durationMin: 10 }),
    ])).toBe('20m');
    expect(runtimeLabel([
      cue({ time: '8:00 PM', durationMin: 20 }),
      cue({ id: 'last', time: '8:10 PM', durationMin: 45 }),
    ])).toBe('1h 5m');
  });

  it('shows a single cue and preserves sub-minute allocations', () => {
    expect(runtimeLabel([cue({ description: 'Intro 30 sec' })])).toBe('30s');
    expect(runtimeLabel([cue()])).toBe('5m');
    expect(runtimeLabel([])).toBeNull();
  });
});

describe('replacing segment audio', () => {
  const old = cue({ music: 'old.mp3', musicName: 'Old', musicStartSec: 80, musicEndSec: 100, musicDuration: 20 });

  it('plays a replacement upload from the beginning through its natural end', () => {
    const updated = { ...old, ...cueAudioPatch({ music: 'new.mp3', musicName: 'New' }) };
    const track = buildSoundboard([updated], []).cues[0];
    expect(track.src).toBe('new.mp3');
    expect(track.startSec).toBeUndefined();
    expect(track.endSec).toBeUndefined();
  });

  it('uses the selected library song cut instead of the old segment cut', () => {
    const updated = { ...old, ...cueAudioPatch({ music: 'new.mp3', startSec: 15, endSec: 25 }) };
    const track = buildSoundboard([updated], []).cues[0];
    expect(track.startSec).toBe(15);
    expect(track.endSec).toBe(25);
    expect(updated.musicDuration).toBeUndefined();
  });

  it('removes audio and its trim together', () => {
    const updated = { ...old, ...cueAudioPatch() };
    expect(buildSoundboard([updated], []).cues).toEqual([]);
    expect(updated.musicStartSec).toBeUndefined();
    expect(updated.musicEndSec).toBeUndefined();
    expect(updated.musicDuration).toBeUndefined();
  });
});
