import type { Client } from '@libsql/client';
import { cipherHash } from './showWrites';
import { snapshotSettings } from './snapshots';
import { json } from './http';

export async function applySettingsWrite(db: Client, userId: string, encryptedData: string, expectedHash: unknown): Promise<Response> {
  if (expectedHash !== null && (typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedHash))) {
    return json({ error: 'client_update_required' }, 428);
  }
  const tx = await db.transaction('write');
  try {
    const rows = await tx.execute({ sql: 'SELECT encrypted_data FROM user_settings WHERE user_id = ?', args: [userId] });
    const current = rows.rows.length ? String(rows.rows[0][0]) : null;
    if (current !== encryptedData) {
      if ((current === null ? null : await cipherHash(current)) !== expectedHash) return json({ error: 'save_conflict' }, 409);
      await snapshotSettings(tx, userId);
      await tx.execute({
        sql: `INSERT INTO user_settings (user_id, encrypted_data, updated_at) VALUES (?, ?, datetime('now'))
              ON CONFLICT(user_id) DO UPDATE SET encrypted_data = excluded.encrypted_data, updated_at = excluded.updated_at`,
        args: [userId, encryptedData],
      });
    }
    await tx.commit();
    return json({ ok: true });
  } finally { tx.close(); }
}
