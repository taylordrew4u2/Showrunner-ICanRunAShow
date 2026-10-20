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

/**
 * Thrown when a caller has used up its failed attempts, and answered 429. A
 * 401 tells the app its credential is wrong and it signs out; a valid session
 * that merely shares an address with someone else's failures must not hear
 * that.
 */
export class TooManyRequestsError extends Error {
  constructor() {
    super('Too many failed attempts');
    this.name = 'TooManyRequestsError';
  }
}

export function handleError(err: unknown): Response {
  if (err instanceof ServerNotConfiguredError) {
    return json({ error: 'server_not_configured', message: err.message }, 503);
  }
  if (err instanceof TooManyRequestsError) return json({ error: 'too_many_requests' }, 429);
  console.error('API error:', err);
  // Surface the real error off production so previews are debuggable.
  const detail =
    process.env.VERCEL_ENV !== 'production' && err instanceof Error
      ? { name: err.name, message: err.message }
      : undefined;
  return json({ error: 'internal_error', detail }, 500);
}
