// /api/artist-entries — public artist sign-up queue entries, keyed by token.
//   GET    ?token=…          → { entries: [...] }
//   POST   { token, entry }  → create
//   PATCH  { id, completed } → mark complete/incomplete
//   DELETE ?id=…             → remove
import { ensureSchema, getDb } from './_lib/db';
import { handleError, json, readJson } from './_lib/http';

interface NewEntry {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  imageNumber?: number;
  color?: 'black' | 'color';
}

export default async function handler(req: Request): Promise<Response> {
  try {
    await ensureSchema();
    const db = getDb();

    if (req.method === 'GET') {
      const token = new URL(req.url).searchParams.get('token');
      if (!token) return json({ error: 'bad_request' }, 400);
      const result = await db.execute({
        sql: `SELECT id, name, phone, email, image_number, color, completed, created_at
                FROM artist_signup_entries WHERE token = ? ORDER BY created_at ASC`,
        args: [token],
      });
      const entries = result.rows.map((row) => ({
        id: String(row[0]),
        name: String(row[1] ?? ''),
        phone: row[2] != null ? String(row[2]) : undefined,
        email: row[3] != null ? String(row[3]) : undefined,
        imageNumber: row[4] != null ? Number(row[4]) : undefined,
        color: row[5] === 'black' || row[5] === 'color' ? (row[5] as 'black' | 'color') : undefined,
        completed: Number(row[6]) === 1,
        createdAt: String(row[7] ?? ''),
      }));
      return json({ entries });
    }

    if (req.method === 'POST') {
      const { token, entry } = await readJson<{ token: string; entry: NewEntry }>(req);
      if (!token || !entry?.id || !entry?.name) return json({ error: 'bad_request' }, 400);
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
      return json({ ok: true });
    }

    if (req.method === 'PATCH') {
      const { id, completed } = await readJson<{ id: string; completed: boolean }>(req);
      if (!id) return json({ error: 'bad_request' }, 400);
      await db.execute({
        sql: `UPDATE artist_signup_entries SET completed = ? WHERE id = ?`,
        args: [completed ? 1 : 0, id],
      });
      return json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const id = new URL(req.url).searchParams.get('id');
      if (!id) return json({ error: 'bad_request' }, 400);
      await db.execute({ sql: `DELETE FROM artist_signup_entries WHERE id = ?`, args: [id] });
      return json({ ok: true });
    }

    return json({ error: 'method_not_allowed' }, 405);
  } catch (err) {
    return handleError(err);
  }
}

export const config = { runtime: 'edge' };
