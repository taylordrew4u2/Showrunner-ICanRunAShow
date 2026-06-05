// Authorizes a request by matching the `x-user-id` + `x-auth` headers against
// the stored password hash. The browser computes both client-side (the raw
// password / encryption key never leave the device). Returns the userId when
// authorized, or null. Not a route (underscore-prefixed).
import { ensureSchema, getPrisma } from './db';

export async function authorize(req: Request): Promise<string | null> {
  const userId = req.headers.get('x-user-id');
  const auth = req.headers.get('x-auth');
  if (!userId || !auth) return null;
  await ensureSchema();
  const prisma = getPrisma();
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.passwordHash !== auth) return null;
  return userId;
}
