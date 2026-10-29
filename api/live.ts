// /api/live — the live-viewer state an audience reads, keyed by a token.
//
//   GET    ?token=…           → { payload | null }   (public)
//   POST   { token, payload } → upsert                (producer, authed)
//   DELETE ?token=…           → drop the link and its audio (producer, authed)
//
// The token is public by design: it is the link handed to the room. That is
// exactly why it cannot also be the permission to write. Publishing used to be
// anonymous, so anyone holding a viewer link — an audience member, anyone they
// forwarded it to — could overwrite what the room's screen showed mid-show:
// the wrong performer on stage, or any text they liked.
//
// So writing is authenticated and scoped to the account that owns the token,
// while reading stays open to anyone with the link. /api/live-media, which
// carries the audio for the same viewer, reads the owner from this table.
//
// Each viewer link is a row anyone holding it can read, and a fresh token
// makes a fresh row, so the first publish under a link takes a place among
// the links its account may hold (see _lib/linkStorage.ts). DELETE gives the
// place back: the app drops a show's link when the show is deleted for good.
import { authorize } from './_lib/auth';
import { ensureSchema, getDb } from './_lib/db';
import { exceedsSize, handleError, json, readJson, tooLarge } from './_lib/http';
import { hasLinkRoom, linkStorageFull } from './_lib/linkStorage';
import { liveTokenOwnership } from './_lib/tokenOwnership';

// The live payload is a small on-stage/up-next snapshot — cap it well clear of
// any legitimate size.
const MAX_PAYLOAD_BYTES = 64 * 1024;

/**
 * How far behind the stored state a publish may be and still count as a late
 * arrival rather than a new board.
 *
 * The board writes on every cue change and every pad press, and does not wait
 * for one request to finish before sending the next. On venue wifi the earlier
 * request can land second, and it used to overwrite the later one: the viewer
 * screen carrying the sound would restart a walk-on the operator had just
 * stopped, or show the previous act as on stage. The payload's `lastUpdateMs`
 * is the board's own clock when it wrote, so an older one arriving on top of a
 * newer one is refused.
 *
 * Only by a minute, though. The clock is the producer's device, and a producer
 * who moves from a phone to a laptop moves to a different clock. Refusing
 * every write from a clock that is minutes behind would freeze the room's
 * screen for exactly that long with nothing on either device to say why. A
 * request is seconds late, never minutes, so past this gap the newer clock is
 * simply the one the room follows now.
 */
export const STALE_PUBLISH_WINDOW_MS = 60_000;

export default async function handler(req: Request): Promise<Response> {
  try {
    await ensureSchema();
    const db = getDb();

    if (req.method === 'GET') {
      const token = new URL(req.url).searchParams.get('token');
      if (!token) return json({ error: 'bad_request' }, 400);
      const result = await db.execute({
        sql: `SELECT payload FROM live_view WHERE token = ?`,
        args: [token],
      });
      let payload: unknown = null;
      if (result.rows.length > 0) {
        try { payload = JSON.parse(String(result.rows[0][0])); } catch { payload = null; }
      }
      return json({ payload });
    }

    if (req.method === 'POST') {
      const userId = await authorize(req);
      if (!userId) return json({ error: 'unauthorized' }, 401);

      const { token, payload } = await readJson<{ token: string; payload: unknown }>(req);
      if (!token) return json({ error: 'bad_request' }, 400);
      if (exceedsSize(payload, MAX_PAYLOAD_BYTES)) return tooLarge();

      // A link the account already publishes to is the board's every cue, and
      // asks nothing more. Only a link it does not hold yet is checked for
      // room among its links. `+token` keeps the lookup in the account's index
      // rather than the row the token's primary key would read, whose owner
      // can sit after the payload.
      const held = await db.execute({
        sql: `SELECT 1 FROM live_view WHERE user_id = ? AND +token = ?`,
        args: [userId, token],
      });
      if (held.rows.length === 0 && !(await hasLinkRoom(db, userId, { table: 'live_view', token, bytes: 0 }))) {
        return linkStorageFull();
      }

      // The WHERE clause on the conflict is the ownership check: a token
      // already published by another account is left alone. `user_id IS NULL`
      // claims a row published before publishing required auth — only the
      // producer whose show it is can be publishing to that token. Audio
      // another account sent under the token first makes it theirs, and
      // stops both the insert and the claim (see _lib/tokenOwnership.ts);
      // `user_id != ?` is never true of audio stored before audio named
      // anyone.
      //
      // The second condition is the late-arrival check — see
      // STALE_PUBLISH_WINDOW_MS. Either side missing a time makes the
      // subtraction NULL, and COALESCE turns that into "write it": a row from
      // before payloads carried a clock must not block the board for good.
      const result = await db.execute({
        sql: `INSERT INTO live_view (token, user_id, payload, updated_at)
              SELECT ?, ?, ?, datetime('now')
               WHERE NOT EXISTS (SELECT 1 FROM live_media WHERE token = ? AND user_id != ?)
              ON CONFLICT(token) DO UPDATE SET
                user_id = excluded.user_id,
                payload = excluded.payload,
                updated_at = excluded.updated_at
              WHERE (live_view.user_id IS NULL OR live_view.user_id = excluded.user_id)
                AND COALESCE(
                  json_extract(live_view.payload, '$.lastUpdateMs')
                    - json_extract(excluded.payload, '$.lastUpdateMs')
                    NOT BETWEEN 1 AND ?,
                  1)`,
        args: [token, userId, JSON.stringify(payload), token, userId, STALE_PUBLISH_WINDOW_MS],
      });
      if (result.rowsAffected === 0) {
        // Nothing written means the row belongs to somebody else, or a newer
        // publish from the same board got there first. Somebody else's is
        // reported as forbidden rather than a silent success, so a caller
        // cannot mistake a refused publish for a live page that is up to date.
        // A late arrival is a success: what the room shows is newer than this.
        if ((await liveTokenOwnership(db, token, userId)) === 'other') return json({ error: 'forbidden' }, 403);
        return json({ ok: true, stale: true });
      }
      return json({ ok: true });
    }

    // Withdrawing the link: the room's page goes blank, the audio under it
    // goes with it, and the link's place among the account's links comes
    // back. Scoped like publishing — the token is in the whole room's hands.
    if (req.method === 'DELETE') {
      const userId = await authorize(req);
      if (!userId) return json({ error: 'unauthorized' }, 401);
      const token = new URL(req.url).searchParams.get('token');
      if (!token) return json({ error: 'bad_request' }, 400);
      if ((await liveTokenOwnership(db, token, userId)) === 'other') return json({ error: 'forbidden' }, 403);
      await db.execute({ sql: `DELETE FROM live_media WHERE token = ?`, args: [token] });
      await db.execute({ sql: `DELETE FROM live_view WHERE token = ?`, args: [token] });
      return json({ ok: true });
    }

    return json({ error: 'method_not_allowed' }, 405);
  } catch (err) {
    return handleError(err);
  }
}

export const config = { runtime: 'edge' };
