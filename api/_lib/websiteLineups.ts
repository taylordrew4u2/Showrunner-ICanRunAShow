import type { Client, Transaction } from '@libsql/client';
import { parseWebsiteShow, type WebsiteShow } from '../../src/utils/websiteLineups';

export interface WebsiteLineupsConfig { ids: string[]; readToken: string; setupToken?: string }

/** Unset or incomplete configuration publishes nothing and changes no saves. */
export function websiteLineupsConfig(): WebsiteLineupsConfig | null {
  const readToken = process.env.WEBSITE_LINEUPS_READ_TOKEN;
  const setupToken = process.env.WEBSITE_LINEUPS_SETUP_TOKEN || undefined;
  try {
    const ids: unknown = JSON.parse(process.env.WEBSITE_LINEUPS_SHOW_IDS ?? 'null');
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100
      || new Set(ids).size !== ids.length
      || ids.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id))
      || !readToken || readToken.length < 32
      || (setupToken !== undefined && (setupToken.length < 32 || setupToken === readToken))) return null;
    return { ids: ids as string[], readToken, ...(setupToken ? { setupToken } : {}) };
  } catch { return null; }
}

export class WebsiteLineupError extends Error {
  constructor(public readonly code: string, public readonly status: number) { super(code); }
}

// Kept independent of showWrites to avoid a cycle in the transaction hook.
export async function websiteSourceRevision(cipher: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(cipher));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** The existing authenticated show load tells only this owner what opted in. */
export async function websiteShowIdsForOwner(db: Client, userId: string): Promise<string[]> {
  const config = websiteLineupsConfig();
  if (!config) return [];
  const rows = await db.execute({
    sql: `SELECT id FROM user_shows WHERE user_id = ? AND id IN (${config.ids.map(() => '?').join(',')})`,
    args: [userId, ...config.ids],
  });
  const held = new Set(rows.rows.map(row => String(row[0])));
  return config.ids.filter(id => held.has(id));
}

interface WebsiteWrite { id: string; encryptedData: string | null; websiteLineup?: WebsiteShow }

/** Runs inside the very same compare-and-swap transaction as the encrypted save. */
export async function syncWebsiteLineupWrites(tx: Transaction, userId: string, changes: WebsiteWrite[]): Promise<void> {
  const config = websiteLineupsConfig();
  const selected = config ? changes.filter(change => config.ids.includes(change.id)) : [];
  if (!selected.length) return;
  const seed = await tx.execute('SELECT owner_id FROM website_lineups_bootstrap WHERE id = 1');
  if (!seed.rows[0] || seed.rows[0][0] !== userId) return;
  for (const change of selected) {
    const revision = change.encryptedData === null ? null : await websiteSourceRevision(change.encryptedData);
    // An old client cannot describe its new ciphertext: withdraw the old public
    // bill instead of leaving a freshly hidden surprise guest on the website.
    const payload = change.encryptedData !== null && change.websiteLineup
      ? JSON.stringify(change.websiteLineup) : null;
    await tx.execute({
      sql: `INSERT INTO website_lineups (show_id, user_id, source_revision, payload, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(show_id) DO UPDATE SET
              source_revision = excluded.source_revision, payload = excluded.payload, updated_at = excluded.updated_at
            WHERE website_lineups.user_id = excluded.user_id`,
      args: [change.id, userId, revision, payload, new Date().toISOString()],
    });
  }
}

export async function seedWebsiteLineups(db: Client, input: unknown): Promise<void> {
  const config = websiteLineupsConfig();
  if (!config) throw new WebsiteLineupError('not_configured', 404);
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => key !== 'shows')
    || !Array.isArray((input as { shows?: unknown }).shows)) throw new WebsiteLineupError('bad_request', 400);
  const entries = (input as { shows: unknown[] }).shows.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new WebsiteLineupError('bad_request', 400);
    const { revision, ...publicFields } = value as Record<string, unknown>;
    if (typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision)) throw new WebsiteLineupError('bad_request', 400);
    let show: WebsiteShow;
    try { show = parseWebsiteShow(publicFields); } catch { throw new WebsiteLineupError('bad_request', 400); }
    return { show, revision };
  });
  if (entries.length !== config.ids.length || new Set(entries.map(entry => entry.show.id)).size !== entries.length
    || entries.some(entry => !config.ids.includes(entry.show.id))) throw new WebsiteLineupError('unapproved_shows', 400);
  const tx = await db.transaction('write');
  try {
    if ((await tx.execute('SELECT 1 FROM website_lineups_bootstrap WHERE id = 1')).rows.length) {
      throw new WebsiteLineupError('already_initialized', 409);
    }
    let owner: string | undefined;
    for (const entry of entries) {
      const result = await tx.execute({ sql: 'SELECT user_id, encrypted_data FROM user_shows WHERE id = ?', args: [entry.show.id] });
      const row = result.rows[0];
      if (!row || await websiteSourceRevision(String(row[1])) !== entry.revision) throw new WebsiteLineupError('stale_revision', 409);
      const userId = String(row[0]);
      if (owner !== undefined && owner !== userId) throw new WebsiteLineupError('owner_mismatch', 409);
      owner = userId;
    }
    const now = new Date().toISOString();
    await tx.execute({ sql: 'INSERT INTO website_lineups_bootstrap (id, owner_id, consumed_at) VALUES (1, ?, ?)', args: [owner!, now] });
    for (const entry of entries) {
      await tx.execute({
        sql: 'INSERT INTO website_lineups (show_id, user_id, source_revision, payload, updated_at) VALUES (?, ?, ?, ?, ?)',
        args: [entry.show.id, owner!, entry.revision, JSON.stringify(entry.show), now],
      });
    }
    await tx.commit();
  } finally { tx.close(); }
}

export async function readWebsiteLineups(db: Client) {
  const config = websiteLineupsConfig();
  if (!config) throw new WebsiteLineupError('not_configured', 404);
  const rows = await db.execute({
    sql: `SELECT p.show_id, p.payload, p.updated_at, p.source_revision, s.encrypted_data
          FROM website_lineups p
          JOIN website_lineups_bootstrap b ON b.id = 1 AND b.owner_id = p.user_id
          LEFT JOIN user_shows s ON s.id = p.show_id AND s.user_id = p.user_id
          WHERE p.show_id IN (${config.ids.map(() => '?').join(',')})`,
    args: config.ids,
  });
  const byId = new Map(rows.rows.map(row => [String(row[0]), row]));
  const shows = await Promise.all(config.ids.map(async id => {
    const row = byId.get(id);
    if (!row?.[1] || !row[4] || row[3] !== await websiteSourceRevision(String(row[4]))) return { id, available: false as const };
    try {
      const show = parseWebsiteShow(JSON.parse(String(row[1])));
      if (show.id !== id) return { id, available: false as const };
      return { ...show, available: true as const };
    } catch { return { id, available: false as const }; }
  }));
  return { version: 1 as const,
    updatedAt: rows.rows.map(row => String(row[2])).sort().at(-1) ?? null, shows };
}
