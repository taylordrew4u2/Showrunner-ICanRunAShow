// /api/artist-entries — public artist sign-up queue entries, keyed by token.
//   GET    ?token=…              → { entries: [...] }
//   POST   { token, entry }      → create
//   PATCH  { id, completed }     → mark complete/incomplete
//   DELETE ?id=…                 → remove
import { ensureSchema, getPrisma } from './_lib/db';
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
    const prisma = getPrisma();

    if (req.method === 'GET') {
      const token = new URL(req.url).searchParams.get('token');
      if (!token) return json({ error: 'bad_request' }, 400);
      const rows = await prisma.artistSignupEntry.findMany({
        where: { token },
        orderBy: { createdAt: 'asc' },
      });
      const entries = rows.map((r) => ({
        id: r.id,
        name: r.name,
        phone: r.phone ?? undefined,
        email: r.email ?? undefined,
        imageNumber: r.imageNumber ?? undefined,
        color: r.color === 'black' || r.color === 'color' ? r.color : undefined,
        completed: r.completed === 1,
        createdAt: r.createdAt ?? '',
      }));
      return json({ entries });
    }

    if (req.method === 'POST') {
      const { token, entry } = await readJson<{ token: string; entry: NewEntry }>(req);
      if (!token || !entry?.id || !entry?.name) return json({ error: 'bad_request' }, 400);
      await prisma.artistSignupEntry.create({
        data: {
          id: entry.id,
          token,
          name: entry.name,
          phone: entry.phone ?? null,
          email: entry.email ?? null,
          imageNumber: entry.imageNumber ?? null,
          color: entry.color ?? null,
        },
      });
      return json({ ok: true });
    }

    if (req.method === 'PATCH') {
      const { id, completed } = await readJson<{ id: string; completed: boolean }>(req);
      if (!id) return json({ error: 'bad_request' }, 400);
      await prisma.artistSignupEntry.update({
        where: { id },
        data: { completed: completed ? 1 : 0 },
      });
      return json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const id = new URL(req.url).searchParams.get('id');
      if (!id) return json({ error: 'bad_request' }, 400);
      await prisma.artistSignupEntry.delete({ where: { id } });
      return json({ ok: true });
    }

    return json({ error: 'method_not_allowed' }, 405);
  } catch (err) {
    return handleError(err);
  }
}
