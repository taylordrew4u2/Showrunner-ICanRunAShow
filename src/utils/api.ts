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

  const res = await fetch(path, { method, headers, body });

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
}

export const api = {
  get: <T>(path: string, opts?: Opts) => request<T>('GET', path, opts),
  post: <T>(path: string, body: unknown, opts?: Opts) => request<T>('POST', path, { ...opts, body }),
  put: <T>(path: string, body: unknown, opts?: Opts) => request<T>('PUT', path, { ...opts, body }),
  patch: <T>(path: string, body: unknown, opts?: Opts) => request<T>('PATCH', path, { ...opts, body }),
  del: <T>(path: string, opts?: Opts) => request<T>('DELETE', path, opts),
};
