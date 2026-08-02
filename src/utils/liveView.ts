import { api } from './api';
import type { ColorScheme } from './theme';
import type { ViewerPlayback, ViewerTrack } from './viewerAudio';

// What viewers see. Kept small so we can push it cheaply on state changes; the
// viewer ticks the timer locally between updates using lastUpdateMs.
export interface LiveViewPayload {
  showName: string;
  status: 'scheduled' | 'idle' | 'countdown' | 'running' | 'paused' | 'ended';
  countdown?: number; // pre-roll seconds when status === 'countdown'
  startsAt?: string; // ISO date-time when the show is scheduled to start
  note?: string; // optional admin note shown pre-show
  theme?: ColorScheme; // producer's color scheme, so the public viewer matches the app
  lineup?: { name: string; credits?: string }[]; // performers in order — shown pre-show, esp. when there's no schedule
  segment?: {
    name?: string;
    description?: string;
    credits?: string;
  };
  next?: {
    name?: string;
    description?: string;
  };
  totalSec?: number;
  remainingAtLastUpdate?: number; // seconds left when this payload was written
  lastUpdateMs: number; // host wall-clock time of the write
  /**
   * Tracks the board has published for the viewer to play — just ids and chunk
   * counts, so the manifest stays inside the payload's size cap however big
   * the audio is. The audio itself is in /api/live-media, and the key to read
   * it is in the viewer link's fragment, never here.
   */
  audio?: ViewerTrack[];
  /** What the viewer should be playing right now, if anything. */
  playback?: ViewerPlayback;
}

export async function publishLiveView(token: string, payload: LiveViewPayload): Promise<void> {
  await api.post('/api/live', { token, payload });
}

export async function fetchLiveView(token: string): Promise<LiveViewPayload | null> {
  const { payload } = await api.get<{ payload: LiveViewPayload | null }>(
    `/api/live?token=${encodeURIComponent(token)}`,
  );
  return payload;
}
