import { api } from './api';
import type { SessionCredentials } from './session-vault';
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

/**
 * Push the current state to the audience's page.
 *
 * Authenticated, and deliberately so: the viewer token is the link handed to
 * the room, so it identifies the page but cannot be the permission to write to
 * it. Without this, anyone holding a viewer link could overwrite what the
 * room's screen showed mid-show. The server checks the token belongs to this
 * account — see api/live.ts.
 */
export async function publishLiveView(
  token: string,
  payload: LiveViewPayload,
  creds: SessionCredentials,
): Promise<void> {
  await api.post(
    '/api/live',
    { token, payload },
    { authUserId: creds.userId, authHash: creds.authHash },
  );
}

export async function fetchLiveView(token: string): Promise<LiveViewPayload | null> {
  const { payload } = await api.get<{ payload: LiveViewPayload | null }>(
    `/api/live?token=${encodeURIComponent(token)}`,
  );
  return payload;
}
