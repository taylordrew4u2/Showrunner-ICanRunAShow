// /api/artist — public artist-signup page payload, keyed by token.
//   GET  ?token=…           → { payload | null }
//   POST { token, payload } → upsert
import { ensureSchema, getPrisma } from './_lib/db';
import { handleError, json, readJson } from './_lib/http';

export default async function handler(req: Request): Promise<Response> {
  try {
    await ensureSchema();
    const prisma = getPrisma();

    if (req.method === 'GET') {
      const token = new URL(req.url).searchParams.get('token');
      if (!token) return json({ error: 'bad_request' }, 400);
      const row = await prisma.artistSignup.findUnique({ where: { token }, select: { payload: true } });
      let payload: unknown = null;
      if (row?.payload) {
        try { payload = JSON.parse(row.payload); } catch { payload = null; }
      }
      return json({ payload });
    }

    if (req.method === 'POST') {
      const { token, payload } = await readJson<{ token: string; payload: unknown }>(req);
      if (!token) return json({ error: 'bad_request' }, 400);
      const data = JSON.stringify(payload);
      await prisma.artistSignup.upsert({
        where: { token },
        create: { token, payload: data },
        update: { payload: data, updatedAt: new Date().toISOString() },
      });
      return json({ ok: true });
    }

    return json({ error: 'method_not_allowed' }, 405);
  } catch (err) {
    return handleError(err);
  }
}
