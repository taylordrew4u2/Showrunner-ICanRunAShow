// POST /api/auth — signup / login.
// Body: { action: 'signup' | 'login', userId, passwordHash }
// The browser derives userId and passwordHash; the raw password never reaches
// the server.
import { ensureSchema, getPrisma } from './_lib/db';
import { handleError, json, readJson } from './_lib/http';

interface AuthBody {
  action: 'signup' | 'login';
  userId: string;
  passwordHash: string;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  try {
    const { action, userId, passwordHash } = await readJson<AuthBody>(req);
    if (!userId || !passwordHash) return json({ error: 'bad_request' }, 400);

    await ensureSchema();
    const prisma = getPrisma();

    if (action === 'signup') {
      const existing = await prisma.user.findUnique({ where: { id: userId } });
      if (existing) return json({ error: 'account_exists' }, 409);
      await prisma.user.create({ data: { id: userId, passwordHash } });
      return json({ ok: true });
    }

    if (action === 'login') {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      return json({ ok: !!user && user.passwordHash === passwordHash });
    }

    return json({ error: 'bad_request' }, 400);
  } catch (err) {
    return handleError(err);
  }
}
