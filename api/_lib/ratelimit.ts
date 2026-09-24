// Fixed-window rate limiter backed by Turso. Not a route (underscore-prefixed).
//
// Edge invocations are stateless and spread across instances, so an in-memory
// counter wouldn't hold. A tiny `rate_limit` row per bucket gives a shared,
// best-effort limit (fine for throttling brute-force / abuse, not for billing).
import type { Client } from '@libsql/client/web';

/**
 * Record one hit against `bucket` and report whether it is still within `max`
 * hits per `windowSeconds`. Fails open (allows) if the limiter query errors, so
 * a limiter hiccup never locks users out.
 */
export async function rateLimit(
  db: Client,
  bucket: string,
  max: number,
  windowSeconds: number,
): Promise<{ allowed: boolean }> {
  const modifier = `-${windowSeconds} seconds`;
  try {
    // Reset the window when the stored start is older than it; otherwise count up.
    await db.execute({
      sql: `INSERT INTO rate_limit (bucket, count, window_start)
            VALUES (?, 1, datetime('now'))
            ON CONFLICT(bucket) DO UPDATE SET
              count = CASE WHEN window_start < datetime('now', ?) THEN 1 ELSE count + 1 END,
              window_start = CASE WHEN window_start < datetime('now', ?) THEN datetime('now') ELSE window_start END`,
      args: [bucket, modifier, modifier],
    });
    const result = await db.execute({
      sql: `SELECT count FROM rate_limit WHERE bucket = ?`,
      args: [bucket],
    });
    const count = result.rows.length > 0 ? Number(result.rows[0][0]) : 0;
    return { allowed: count <= max };
  } catch {
    return { allowed: true };
  }
}

/**
 * Whether `bucket` still has room, without spending a hit on it.
 *
 * For limits that count failures only: look before the attempt, record after
 * it fails. Counting every attempt let anyone who knew a username lock its
 * producer out with ten bogus requests, and counted a producer's own two
 * phones syncing against them. Fails open like `rateLimit`.
 */
export async function rateLimitPeek(
  db: Client,
  bucket: string,
  max: number,
  windowSeconds: number,
): Promise<{ allowed: boolean }> {
  try {
    const result = await db.execute({
      sql: `SELECT count FROM rate_limit WHERE bucket = ? AND window_start >= datetime('now', ?)`,
      args: [bucket, `-${windowSeconds} seconds`],
    });
    const count = result.rows.length > 0 ? Number(result.rows[0][0]) : 0;
    return { allowed: count < max };
  } catch {
    return { allowed: true };
  }
}

/**
 * The caller's address, for limits that should not let one stranger spend a
 * whole account's allowance. Vercel's edge sets the forwarded header; a
 * request with neither shares one bucket, which only ever makes the limit
 * stricter.
 */
export function clientAddress(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}
