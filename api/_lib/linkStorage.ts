// How much one account may keep stored under the links it hands out.
//
// The chunked routes behind a link — the contract document (/api/sign-doc),
// a board's audio for the viewer (/api/live-media) and the headshot a
// performer sends back (/api/profile-photo) — each cap what one token can
// hold. On their own those caps added up to nothing: a token is a string the
// producer's browser makes up, a fresh one comes with a fresh cap, and the
// document and audio routes are readable by anyone holding the URL. So one
// free account could keep as much as it liked, for anyone to download, by
// minting tokens. Every chunk now names the account it counts against, and
// an account's chunks share one allowance across all three routes.
//
// The allowance is sized from what the app itself lets a producer store, so
// that nobody using it for what it is for comes near it:
//
// - A contract is a PDF of up to 20 MB (Contracts.tsx), stored as a data URL
//   encrypted and encoded again, so about 1.8 times the file: 36 MB at most,
//   and well under a megabyte for an ordinary agreement. Each one keeps its
//   token until it is withdrawn — and a signed one is kept as the record — so
//   a weekly show of six acts files around 300 a year. 300 tokens would have
//   been a year of real use; 5,000 is the number account deletion already
//   treats as far past what a producer sends in years (MAX_NAMED_TOKENS in
//   api/account.ts).
// - A board sends the viewer up to 60 songs (MAX_TRACKS_PER_TOKEN in
//   api/live-media.ts), and the DJ bank alone fills that. A 4–5 MB song is
//   about 8 MB stored, so a full board of ordinary songs is about half a
//   gigabyte, and one of the largest files the app takes (25 MB, utils/
//   media.ts) is 2.7 GB. It stays until the operator turns it off or deletes
//   the show — closing the board leaves it published.
// - A headshot is a chunk or two, and is removed once it is filed.
//
// 10 GB holds a dozen full boards of ordinary songs with years of contracts
// beside them, or three boards of the largest files the app takes. 2 GB would
// not hold even one of those, and four ordinary boards left published would
// have filled it.
//
// The links themselves count too. A signing or profile link's request
// (/api/sign) and a viewer link's live state (/api/live) are rows rather than
// chunks, but a fresh token makes a fresh one of either, and anyone holding
// the link can read it back — a signature as large as 3 MB, sent in by whoever
// holds the link, included. So each link row takes its place in the count of
// links, beside any chunks under the same token, and a signature's size counts
// against the producer who made the link, as a headshot does. What else those
// rows hold is not counted in bytes: a request's terms (32 KB at most) and a
// viewer link's live state (64 KB) are held to a few hundred megabytes by the
// count of links, and the live state is written on every cue the board sends,
// which is no place to add up an account.
//
// The count is of what is there now, so withdrawing a contract, turning a
// board's viewer audio off, deleting a show for good or deleting the account
// gives the space back. Chunks stored before chunks named an account, and
// signatures stored before signatures were sized, count against nobody. Not a
// route (underscore-prefixed).
import type { Client } from '@libsql/client';
import { json } from './http';

/** Distinct links one account may hold anything under: a link row, chunks, or both. */
export const MAX_LINK_TOKENS = 5_000;
/** What all of one account's link chunks and signatures may add up to, in characters of ciphertext. */
export const MAX_LINK_BYTES = 10 * 1024 ** 3;

/** One chunk about to be written under a link. */
export interface LinkChunk {
  table: 'sign_doc' | 'live_media' | 'profile_photo';
  token: string;
  /** live_media's track id. The other two hold one file per token. */
  id?: string;
  seq: number;
  total: number;
  /** The chunk's own size: `data.length`, which is what `bytes` stores. */
  bytes: number;
}

/** A write to a link's own row: a signing or profile request, or a viewer link's live state. */
export interface LinkRow {
  table: 'sign_request' | 'live_view';
  token: string;
  /**
   * What the write adds: a signature's `length`, which is what
   * sign_request's `bytes` stores. Nothing for anything else on either row.
   */
  bytes: number;
}

/**
 * The answer when there is no room. 413 like the per-token caps, with its own
 * code so the app can say what to do about it: free space, not a smaller file.
 */
export function linkStorageFull(): Response {
  return json({ error: 'link_storage_full' }, 413);
}

/**
 * Whether `userId` has room for this write.
 *
 * A link the account holds nothing under yet needs room under the count of
 * links. Bytes are counted as they would stand after the write, so a chunk
 * sent again replaces its own size rather than adding to it.
 *
 * The first chunk of a file is checked for the whole file, as `total` chunks
 * the size of this one — a file is no use half-stored, and one refused at its
 * first chunk leaves nothing behind that the producer would have to find and
 * remove. Every later chunk is still checked for itself, which is the real
 * limit: `total` is the client's word, and a client can say anything.
 *
 * A link row replaces nothing: a signature is written once, and nothing else
 * on either row is counted.
 */
export async function hasLinkRoom(db: Client, userId: string, write: LinkChunk | LinkRow): Promise<boolean> {
  const chunk = 'seq' in write ? write : null;
  let replaced: { sql: string; args: (string | number)[] } = { sql: '0', args: [] };
  if (chunk) {
    const file = chunk.table === 'live_media' ? 'token = ? AND id = ?' : 'token = ?';
    const fileArgs = chunk.table === 'live_media' ? [chunk.token, chunk.id ?? ''] : [chunk.token];
    replaced = {
      sql: `(SELECT COALESCE(SUM(bytes), 0) FROM ${chunk.table}
              WHERE user_id = ? AND ${file} AND (seq = ? OR ? = 0))`,
      args: [userId, ...fileArgs, chunk.seq, chunk.seq],
    };
  }
  const result = await db.execute({
    sql: `SELECT COUNT(DISTINCT token),
                 COALESCE(SUM(bytes), 0),
                 COALESCE(SUM(token = ?), 0),
                 ${replaced.sql}
            FROM (SELECT token, bytes FROM sign_doc WHERE user_id = ?
                  UNION ALL SELECT token, bytes FROM live_media WHERE user_id = ?
                  UNION ALL SELECT token, bytes FROM profile_photo WHERE user_id = ?
                  UNION ALL SELECT token, bytes FROM sign_request WHERE user_id = ?
                  UNION ALL SELECT token, NULL FROM live_view WHERE user_id = ?)`,
    args: [write.token, ...replaced.args, userId, userId, userId, userId, userId],
  });
  const [tokens, bytes, here, replacedBytes] = Array.from(result.rows[0]).map(Number);
  if (here === 0 && tokens >= MAX_LINK_TOKENS) return false;
  const adding = chunk?.seq === 0 ? chunk.bytes * chunk.total : write.bytes;
  return bytes - replacedBytes + adding <= MAX_LINK_BYTES;
}
