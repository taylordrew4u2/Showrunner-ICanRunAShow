// What co-producers store, and how much of it. Not a route
// (underscore-prefixed).
//
// A co-producer writes only two things: requests (coproducer_requests) and
// the files a requested change carries (coproducer_media). Neither counts
// toward the allowance contracts, viewer audio, profile photos and
// performers' signatures share (linkStorage.ts): a co-producer filling their
// own space can never stop a contract going out or a signature landing. They
// have an allowance of their own instead, per link and per account.
import type { InStatement, Row, Transaction } from '@libsql/client';
import { COPRODUCER_LIMITS, type OwnerRequestDetail, type OwnerRequestRow, type RequestKind, type RequestStatus } from '../../src/coproducer/types';

/** A client or an open transaction: whatever runs one statement. */
export type Executor = Pick<Transaction, 'execute'>;

const OPEN = `('pending', 'stale')`;
const DAY = 24 * 60 * 60;
/** Decided requests stay this long, so both producers can see how each went. */
const REJECTED_KEEP_SECONDS = 7 * DAY;
const APPROVED_KEEP_SECONDS = 30 * DAY;
/** A staged file no request carries is dropped after this long. */
const STAGED_KEEP_SECONDS = DAY;

export type CoproducerWrite =
  | { kind: 'stage'; mediaId: string; seq: number; total: number; bytes: number }
  | { kind: 'request'; bytes: number };

export type RoomAnswer = 'ok' | 'link_full' | 'account_full' | 'too_many_files';

/**
 * Room for one co-producer write. Bytes are counted as they would stand after
 * the write: a chunk sent again replaces its own size, and a file's first
 * chunk is counted as bytes * total (as hasLinkRoom does). Checks, in order:
 * - stage, seq 0, a media id this link has no rows for: the link's staged
 *   files with request_id IS NULL must be fewer than 20 → else too_many_files;
 * - stage: the link's staged bytes ≤ 200,000,000 → else link_full;
 * - request: the link's open request bytes ≤ 50,000,000 → else link_full;
 * - either: the account's co-producer bytes (all coproducer_media plus open
 *   coproducer_requests) ≤ 1,000,000,000 → else account_full.
 */
export async function coproducerRoom(db: Executor, userId: string, linkId: string, write: CoproducerWrite): Promise<RoomAnswer> {
  const stage = write.kind === 'stage' ? write : null;
  const result = await db.execute({
    sql: `SELECT
            (SELECT COALESCE(SUM(bytes), 0) FROM coproducer_media WHERE user_id = ? AND link_id = ?),
            (SELECT COALESCE(SUM(bytes), 0) FROM coproducer_requests WHERE user_id = ? AND link_id = ? AND status IN ${OPEN}),
            (SELECT COALESCE(SUM(bytes), 0) FROM coproducer_media WHERE user_id = ?)
              + (SELECT COALESCE(SUM(bytes), 0) FROM coproducer_requests WHERE user_id = ? AND status IN ${OPEN}),
            (SELECT COALESCE(SUM(bytes), 0) FROM coproducer_media WHERE user_id = ? AND link_id = ? AND id = ? AND (seq = ? OR ? = 0)),
            (SELECT COUNT(*) FROM coproducer_media WHERE user_id = ? AND link_id = ? AND id = ?),
            (SELECT COUNT(DISTINCT id) FROM coproducer_media WHERE user_id = ? AND link_id = ? AND request_id IS NULL)`,
    args: [
      userId, linkId,
      userId, linkId,
      userId, userId,
      userId, linkId, stage?.mediaId ?? '', stage?.seq ?? -1, stage?.seq ?? -1,
      userId, linkId, stage?.mediaId ?? '',
      userId, linkId,
    ],
  });
  const [staged, open, account, replaced, rowsForFile, unattachedFiles] = Array.from(result.rows[0]).map(Number);
  if (stage) {
    if (stage.seq === 0 && rowsForFile === 0 && unattachedFiles >= COPRODUCER_LIMITS.maxUnattachedStagedFilesPerLink) return 'too_many_files';
    const adding = stage.seq === 0 ? stage.bytes * stage.total : stage.bytes;
    if (staged - replaced + adding > COPRODUCER_LIMITS.maxStagedBytesPerLink) return 'link_full';
    if (account - replaced + adding > COPRODUCER_LIMITS.maxCoproducerBytesPerAccount) return 'account_full';
    return 'ok';
  }
  if (open + write.bytes > COPRODUCER_LIMITS.maxOpenRequestBytesPerLink) return 'link_full';
  if (account + write.bytes > COPRODUCER_LIMITS.maxCoproducerBytesPerAccount) return 'account_full';
  return 'ok';
}

const EXPIRED_LINKS = 'SELECT id FROM coproducer_links WHERE expires_at <= ?';

/** What has outlived its time, everywhere but the ended links themselves. */
function retention(now: number): InStatement[] {
  return [
    { sql: `DELETE FROM coproducer_media WHERE link_id IN (${EXPIRED_LINKS})`, args: [now] },
    { sql: `DELETE FROM coproducer_requests WHERE link_id IN (${EXPIRED_LINKS})`, args: [now] },
    { sql: `DELETE FROM coproducer_requests WHERE status IN ('rejected', 'withdrawn') AND decided_at <= ?`, args: [now - REJECTED_KEEP_SECONDS] },
    { sql: `DELETE FROM coproducer_requests WHERE status = 'approved' AND decided_at <= ?`, args: [now - APPROVED_KEEP_SECONDS] },
    { sql: `DELETE FROM coproducer_media WHERE request_id IS NULL AND created_at <= ?`, args: [now - STAGED_KEEP_SECONDS] },
    { sql: `DELETE FROM coproducer_media WHERE request_id IS NOT NULL AND request_id NOT IN (SELECT id FROM coproducer_requests WHERE status IN ${OPEN})`, args: [] },
  ];
}

/**
 * The clean-up the owner's routes run first, as one write batch: ended links
 * go, with everything of theirs but the record of what they were handed
 * (their handouts are marked ended and kept); decided requests go once they
 * are old enough; staged files go once nothing waiting carries them, or a
 * day after they were sent with no request.
 */
export function COPRODUCER_SWEEP(now: number): InStatement[] {
  return [
    { sql: `UPDATE coproducer_handouts SET link_ended_at = ? WHERE link_ended_at IS NULL AND link_id IN (${EXPIRED_LINKS})`, args: [now, now] },
    ...retention(now),
    { sql: 'DELETE FROM coproducer_links WHERE expires_at <= ?', args: [now] },
  ];
}

/**
 * The same clean-up for a co-producer's own writes, less the two statements
 * that touch the owner's records: handed-out links are written only by the
 * owner's routes, and an ended link's row stays until one of them marks its
 * handouts and removes it. An ended link opens nothing in the meantime.
 */
export function COPRODUCER_HOLDER_SWEEP(now: number): InStatement[] {
  return retention(now);
}

/**
 * One link's staged files that no request carries and that are a day old.
 * C7 runs it at the first chunk of every file, so a holder who only ever
 * uploads is still swept.
 */
export function linkStagedSweep(userId: string, linkId: string, now: number): InStatement {
  return {
    sql: 'DELETE FROM coproducer_media WHERE user_id = ? AND link_id = ? AND request_id IS NULL AND created_at <= ?',
    args: [userId, linkId, now - STAGED_KEEP_SECONDS],
  };
}

/**
 * The batch that withdraws links, scoped to their owner: what they were
 * handed is marked ended and kept, and their staged files, their requests and
 * the links themselves go. With no id, every link the owner has.
 */
export function withdrawLinks(userId: string, linkId: string | null, now: number): InStatement[] {
  if (linkId !== null) {
    return [
      { sql: 'UPDATE coproducer_handouts SET link_ended_at = ? WHERE link_id = ? AND user_id = ? AND link_ended_at IS NULL', args: [now, linkId, userId] },
      { sql: 'DELETE FROM coproducer_media WHERE link_id = ? AND user_id = ?', args: [linkId, userId] },
      { sql: 'DELETE FROM coproducer_requests WHERE link_id = ? AND user_id = ?', args: [linkId, userId] },
      { sql: 'DELETE FROM coproducer_links WHERE id = ? AND user_id = ?', args: [linkId, userId] },
    ];
  }
  const links = 'SELECT id FROM coproducer_links WHERE user_id = ?';
  return [
    { sql: `UPDATE coproducer_handouts SET link_ended_at = ? WHERE user_id = ? AND link_ended_at IS NULL AND link_id IN (${links})`, args: [now, userId, userId] },
    { sql: `DELETE FROM coproducer_media WHERE user_id = ? AND link_id IN (${links})`, args: [userId, userId] },
    { sql: `DELETE FROM coproducer_requests WHERE user_id = ? AND link_id IN (${links})`, args: [userId, userId] },
    { sql: 'DELETE FROM coproducer_links WHERE user_id = ?', args: [userId] },
  ];
}

/** An epoch-seconds column as ISO time, or null. */
export function isoTime(value: unknown): string | null {
  return value == null ? null : new Date(Number(value) * 1000).toISOString();
}

/** The columns the owner's lists read, in the order rowFromColumns expects. */
export const REQUEST_ROW_COLUMNS = 'id, link_id, kind, status, created_at, decided_at, used_at, outline, media_ids, bytes';

function mediaIdsOf(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value)) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/** A coproducer_requests row (REQUEST_ROW_COLUMNS) as the owner's inbox sees it: ciphertext outline, never the payload. */
export function ownerRow(row: Row): OwnerRequestRow {
  return {
    id: String(row[0]),
    linkId: String(row[1]),
    kind: String(row[2]) as RequestKind,
    status: String(row[3]) as RequestStatus,
    createdAt: isoTime(row[4])!,
    decidedAt: isoTime(row[5]),
    usedAt: isoTime(row[6]),
    outline: String(row[7]),
    mediaIds: mediaIdsOf(row[8]),
    bytes: Number(row[9]),
  };
}

/** REQUEST_ROW_COLUMNS then payload and result: the one request the owner opens. */
export function ownerDetail(row: Row): OwnerRequestDetail {
  return { ...ownerRow(row), payload: String(row[10]), result: row[11] == null ? null : String(row[11]) };
}
