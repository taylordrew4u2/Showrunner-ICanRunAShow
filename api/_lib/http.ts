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

/**
 * True when a value serializes to more than `maxBytes` of JSON. Used to cap the
 * size of public, unauthenticated upserts so a single request can't bloat a row.
 */
export function exceedsSize(value: unknown, maxBytes: number): boolean {
  try {
    return JSON.stringify(value ?? null).length > maxBytes;
  } catch {
    return true; // unserializable (e.g. circular) — reject
  }
}

/** 413 Payload Too Large. */
export function tooLarge(): Response {
  return json({ error: 'payload_too_large' }, 413);
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
