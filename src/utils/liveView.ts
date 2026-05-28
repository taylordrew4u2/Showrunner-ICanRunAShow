import { getClient, ensureSchema } from './db';

// What viewers see. Kept small so we can push it cheaply on state changes; the
// viewer ticks the timer locally between updates using lastUpdateMs.
export interface LiveViewPayload {
  showName: string;
  status: 'scheduled' | 'idle' | 'countdown' | 'running' | 'paused' | 'ended';
  countdown?: number; // pre-roll seconds when status === 'countdown'
  startsAt?: string; // ISO date-time when the show is scheduled to start
  note?: string; // optional admin note shown pre-show
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
  await ensureSchema();
  const db = getClient();
  await db.execute({
    sql: `INSERT INTO live_view (token, payload, updated_at) VALUES (?, ?, datetime('now'))
          ON CONFLICT(token) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
    args: [token, JSON.stringify(payload)],
  });
}

export async function fetchLiveView(token: string): Promise<LiveViewPayload | null> {
  await ensureSchema();
  const db = getClient();
  const result = await db.execute({
    sql: `SELECT payload FROM live_view WHERE token = ?`,
    args: [token],
  });
  if (result.rows.length === 0) return null;
  const raw = result.rows[0][0] as string;
  try {
    return JSON.parse(raw) as LiveViewPayload;
  } catch {
    return null;
  }
}
