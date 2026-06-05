// Small helpers shared by the API routes. Not a route (underscore-prefixed).
import { ServerNotConfiguredError } from './db';

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function readJson<T>(req: Request): Promise<T> {
  return (await req.json()) as T;
}

export function handleError(err: unknown): Response {
  if (err instanceof ServerNotConfiguredError) {
    return json({ error: 'server_not_configured', message: err.message }, 503);
  }
  console.error('API error:', err);
  // Surface the real error off production so previews are debuggable.
  const detail =
    process.env.VERCEL_ENV !== 'production' && err instanceof Error
      ? { name: err.name, message: err.message }
      : undefined;
  return json({ error: 'internal_error', detail }, 500);
}
