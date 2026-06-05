// /api/settings — a single encrypted settings blob per user.
//   GET → load (headers: x-user-id, x-auth)
//   PUT → save (body: { encryptedData })
import { authorize } from './_lib/auth';
import { ensureSchema, getPrisma } from './_lib/db';
import { handleError, json, readJson } from './_lib/http';

export default async function handler(req: Request): Promise<Response> {
  try {
    await ensureSchema();
    const prisma = getPrisma();
    const userId = await authorize(req);
    if (!userId) return json({ error: 'unauthorized' }, 401);

    if (req.method === 'GET') {
      const row = await prisma.userSettings.findUnique({
        where: { userId },
        select: { encryptedData: true },
      });
      return json({ encryptedData: row?.encryptedData ?? null });
    }

    if (req.method === 'PUT') {
      const { encryptedData } = await readJson<{ encryptedData: string }>(req);
      if (typeof encryptedData !== 'string') return json({ error: 'bad_request' }, 400);
      await prisma.userSettings.upsert({
        where: { userId },
        create: { userId, encryptedData },
        update: { encryptedData },
      });
      return json({ ok: true });
    }

    return json({ error: 'method_not_allowed' }, 405);
  } catch (err) {
    return handleError(err);
  }
}
