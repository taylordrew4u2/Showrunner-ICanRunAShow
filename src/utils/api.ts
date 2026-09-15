// Thin fetch wrapper for the server API. All database access goes through these
// routes now — the browser never holds a DB connection or token.

/** Thrown when the server reports it has no database connection configured (503). */
export class ServerNotConfiguredError extends Error {
  constructor(message = 'The server is not configured to reach the database yet.') {
    super(message);
    this.name = 'ServerNotConfiguredError';
  }
}

export interface ApiError extends Error {
  status?: number;
  code?: string;
}

interface Opts {
  body?: unknown;
  /** Sent as the x-user-id header for authorized routes. */
  authUserId?: string;
  /** Sent as the x-auth header (client-computed password hash). */
  authHash?: string;
  /**
   * How long to wait before giving up, in milliseconds.
   *
   * The default suits a small request on a bad connection. A signature
   * carrying a headshot is a megabyte of ciphertext, and a megabyte uphill
   * from a basement does not finish in twenty seconds — it was aborted every
   * time, including on every retry, so that signer could never get through at
   * all. Those calls ask for longer.
   */
  timeoutMs?: number;
}

async function request<T>(method: string, path: string, opts: Opts = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.authUserId) headers['x-user-id'] = opts.authUserId;
  if (opts.authHash) headers['x-auth'] = opts.authHash;
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
  try {
    const res = await fetch(path, { method, headers, body, signal: controller.signal });

    if (res.status === 503) {
      let message: string | undefined;
      try {
        message = (await res.json())?.message;
      } catch {
        /* ignore */
      }
      throw new ServerNotConfiguredError(message);
    }

    if (!res.ok) {
      let parsed: { error?: string } | null = null;
      try {
        parsed = await res.json();
      } catch {
        /* ignore */
      }
      const err: ApiError = new Error(parsed?.error || `Request failed (${res.status})`);
      err.status = res.status;
      err.code = parsed?.error;
      throw err;
    }

    return (await res.json()) as T;
  } finally { clearTimeout(timeout); }
}

/**
 * How long an anonymous submission gets to reach the server.
 *
 * Generous on purpose. A signature with a headshot is around a megabyte of
 * ciphertext and the uplink in a basement is not fast; the alternative to
 * waiting is a performer who cannot sign at all.
 */
export const SUBMIT_TIMEOUT_MS = 120_000;

/**
 * Retry a write that failed before the server could answer.
 *
 * On venue wifi a request can die after the server has already done the work:
 * the connection drops, or the 20s abort above fires, and the answer never
 * gets back. The caller cannot tell that from a request that never arrived.
 *
 * Only safe for writes that can be repeated without doing anything twice —
 * which the signing and profile submissions are, because the server accepts
 * each of them exactly once (`WHERE signed_at IS NULL`) and refuses a second
 * with 409. A repeat therefore either lands or reports that the first one did.
 *
 * Retries only when the failure has no status: the server never spoke, so it
 * is worth asking again. A 4xx is an answer, and asking again will not change
 * it.
 */
export async function withNetworkRetry<T>(send: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await send();
    } catch (err) {
      if ((err as ApiError).status !== undefined) throw err;
      last = err;
      // Short, and growing: a dropped connection is often back in a second,
      // and someone holding a phone in a basement is watching this happen.
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
      }
    }
  }
  throw last;
}

export const api = {
  get: <T>(path: string, opts?: Opts) => request<T>('GET', path, opts),
  post: <T>(path: string, body: unknown, opts?: Opts) => request<T>('POST', path, { ...opts, body }),
  put: <T>(path: string, body: unknown, opts?: Opts) => request<T>('PUT', path, { ...opts, body }),
  patch: <T>(path: string, body: unknown, opts?: Opts) => request<T>('PATCH', path, { ...opts, body }),
  del: <T>(path: string, opts?: Opts) => request<T>('DELETE', path, opts),
};
