import { getClient, ensureSchema } from './db';

export interface ArtistSignupPayload {
  showName: string;
  venueName?: string;
  scheduleVisible: boolean;
  schedule?: Array<{ time?: string; description: string; performer?: string }>;
  flashImage?: string;
  scheduleImage?: string;
  startsAtIso?: string; // ISO datetime for the public "starts at" countdown
  paymentLinks?: { cashApp?: string; venmo?: string; zelle?: string; other?: string };
  liveToken?: string; // so the page can also pull live on-stage/up-next from live_view
  welcomeMessage?: string;
  pricingLabels?: { black?: string; color?: string };
  sections?: {
    schedule?: boolean;
    flash?: boolean;
    live?: boolean;
    signups?: boolean;
    payment?: boolean;
  };
  lastUpdateMs: number;
}

export interface ArtistSignupEntry {
  id: string;
  name: string;
  phone?: string; // present for admin queries; the public list strips it client-side
  email?: string; // present for admin queries; the public list strips it client-side
  imageNumber?: number;
  color?: 'black' | 'color';
  completed: boolean;
  createdAt: string;
}

export async function publishArtistPayload(token: string, payload: ArtistSignupPayload): Promise<void> {
  await ensureSchema();
  const db = getClient();
  await db.execute({
    sql: `INSERT INTO artist_signup (token, payload, updated_at) VALUES (?, ?, datetime('now'))
          ON CONFLICT(token) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
    args: [token, JSON.stringify(payload)],
  });
}

export async function fetchArtistPayload(token: string): Promise<ArtistSignupPayload | null> {
  await ensureSchema();
  const db = getClient();
  const result = await db.execute({
    sql: `SELECT payload FROM artist_signup WHERE token = ?`,
    args: [token],
  });
  if (result.rows.length === 0) return null;
  try {
    return JSON.parse(result.rows[0][0] as string) as ArtistSignupPayload;
  } catch {
    return null;
  }
}

export async function listSignups(token: string): Promise<ArtistSignupEntry[]> {
  await ensureSchema();
  const db = getClient();
  const result = await db.execute({
    sql: `SELECT id, name, phone, email, image_number, color, completed, created_at
            FROM artist_signup_entries
           WHERE token = ?
           ORDER BY created_at ASC`,
    args: [token],
  });
  return result.rows.map((row) => ({
    id: String(row[0]),
    name: String(row[1] ?? ''),
    phone: row[2] != null ? String(row[2]) : undefined,
    email: row[3] != null ? String(row[3]) : undefined,
    imageNumber: row[4] != null ? Number(row[4]) : undefined,
    color: (row[5] === 'black' || row[5] === 'color' ? (row[5] as 'black' | 'color') : undefined),
    completed: Number(row[6]) === 1,
    createdAt: String(row[7] ?? ''),
  }));
}

export async function createSignup(
  token: string,
  entry: { id: string; name: string; phone?: string; email?: string; imageNumber?: number; color?: 'black' | 'color' },
): Promise<void> {
  await ensureSchema();
  const db = getClient();
  await db.execute({
    sql: `INSERT INTO artist_signup_entries (id, token, name, phone, email, image_number, color)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      entry.id,
      token,
      entry.name,
      entry.phone ?? null,
      entry.email ?? null,
      entry.imageNumber ?? null,
      entry.color ?? null,
    ],
  });
}

export async function setSignupCompleted(id: string, completed: boolean): Promise<void> {
  await ensureSchema();
  const db = getClient();
  await db.execute({
    sql: `UPDATE artist_signup_entries SET completed = ? WHERE id = ?`,
    args: [completed ? 1 : 0, id],
  });
}

export async function deleteSignup(id: string): Promise<void> {
  await ensureSchema();
  const db = getClient();
  await db.execute({ sql: `DELETE FROM artist_signup_entries WHERE id = ?`, args: [id] });
}
