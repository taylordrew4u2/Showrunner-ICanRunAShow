import type { Client } from '@libsql/client';
import { json } from './http';
import { snapshotShows } from './snapshots';
import { parseWebsiteShow, type WebsiteShow } from '../../src/utils/websiteLineups';
import { syncWebsiteLineupWrites, websiteLineupsConfig } from './websiteLineups';

interface Change { id: string; expectedHash: string | null; encryptedData: string | null; websiteLineup?: WebsiteShow }

export async function cipherHash(value: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}

/** Compare and write under one lock: another tab cannot slip between them. */
export async function applyShowChanges(db: Client, userId: string, input: unknown[]): Promise<Response> {
  if (input.some(value => {
    if (!value || typeof value !== 'object') return true;
    const c = value as Record<string, unknown>;
    return typeof c.id !== 'string' || !c.id ||
      !(c.expectedHash === null || (typeof c.expectedHash === 'string' && /^[a-f0-9]{64}$/.test(c.expectedHash))) ||
      !(c.encryptedData === null || (typeof c.encryptedData === 'string' && c.encryptedData.length > 0));
  })) {
    return json({ error: 'bad_request' }, 400);
  }
  const approved = new Set(websiteLineupsConfig()?.ids ?? []);
  let changes: Change[];
  try {
    changes = input.map(value => {
      const c = value as Record<string, unknown>;
      const change: Change = { id: c.id as string, expectedHash: c.expectedHash as string | null, encryptedData: c.encryptedData as string | null };
      if (approved.has(change.id) && c.websiteLineup !== undefined && change.encryptedData !== null) {
        change.websiteLineup = parseWebsiteShow(c.websiteLineup);
        if (change.websiteLineup.id !== change.id) throw new Error('Mismatched website show.');
      }
      return change;
    });
  } catch { return json({ error: 'invalid_website_lineup' }, 400); }
  if (new Set(changes.map(c => c.id)).size !== changes.length) return json({ error: 'duplicate_id' }, 400);
  const tx = await db.transaction('write');
  try {
    const effective: Change[] = [];
    for (const change of changes) {
      const result = await tx.execute({ sql: 'SELECT user_id, encrypted_data FROM user_shows WHERE id = ?', args: [change.id] });
      const row = result.rows[0];
      if (row && String(row[0]) !== userId) return json({ error: 'save_conflict' }, 409);
      const current = row ? String(row[1]) : null;
      // A response may have been lost after commit. Replaying the same
      // ciphertext or deletion is success, never a false conflict.
      if (current === change.encryptedData) continue;
      const actualHash = current === null ? null : await cipherHash(current);
      if (actualHash !== change.expectedHash) return json({ error: 'save_conflict' }, 409);
      effective.push(change);
    }
    if (effective.length) {
      await snapshotShows(tx, userId);
      await tx.batch(effective.map(c => c.encryptedData === null ? {
        sql: 'DELETE FROM user_shows WHERE id = ? AND user_id = ?', args: [c.id, userId],
      } : {
        sql: `INSERT INTO user_shows (id, user_id, encrypted_data) VALUES (?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET encrypted_data = excluded.encrypted_data, updated_at = datetime('now')
              WHERE user_shows.user_id = excluded.user_id`,
        args: [c.id, userId, c.encryptedData],
      }));
      await syncWebsiteLineupWrites(tx, userId, effective);
    }
    await tx.commit();
    return json({ ok: true });
  } finally { tx.close(); }
}
