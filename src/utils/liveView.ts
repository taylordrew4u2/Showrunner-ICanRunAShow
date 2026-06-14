import { api } from './api';
import type { ColorScheme } from './theme';

// What viewers see. Kept small so we can push it cheaply on state changes; the
// viewer ticks the timer locally between updates using lastUpdateMs.
export interface LiveViewPayload {
  showName: string;
  status: 'scheduled' | 'idle' | 'countdown' | 'running' | 'paused' | 'ended';
  countdown?: number; // pre-roll seconds when status === 'countdown'
  startsAt?: string; // ISO date-time when the show is scheduled to start
  note?: string; // optional admin note shown pre-show
  theme?: ColorScheme; // producer's color scheme, so the public viewer matches the app
  lineup?: { name: string; photo?: string; credits?: string }[]; // performers in order — shown pre-show, esp. when there's no schedule
  segment?: {
    name?: string;
    description?: string;
    photo?: string;
    credits?: string;
  };
  next?: {
    name?: string;
    description?: string;
    photo?: string;
  };
  totalSec?: number;
  remainingAtLastUpdate?: number; // seconds left when this payload was written
  lastUpdateMs: number; // host wall-clock time of the write
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
