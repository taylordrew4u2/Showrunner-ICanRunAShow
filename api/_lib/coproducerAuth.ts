// Who is calling /api/coproducer, and from where. Not a route
// (underscore-prefixed).
//
// Two kinds of caller, never mixed. The owner signs in as for every other
// route (x-user-id and x-auth, authorize in auth.ts). A co-producer holds
// only a link token, sent as `Authorization: Bearer <token>`, and is never
// asked for or given the owner's credential. The token is stored as its bare
// SHA-256; the account's data keys it opens are sealed under it (seal.ts),
// bound to the link's own row, so a copy of the database alone opens
// nothing and a sealed blob moved to another row opens nothing either.
//
// The co-producer's app runs on its own origin, the review origin, so its
// browser storage is never that of either producer's own account. For the
// main origin https://<host> it is https://coproduce.<host>, worked out from
// APP_URL by the same rules the app uses (src/coproducer/originRules.ts).
// COPRODUCE_ORIGIN, when set, overrides it. A deployment whose address has
// no coproduce.* sibling (a Vercel preview) has none, and makes no links:
// localhost and 127.0.0.1 are the exception, for development and tests,
// where the co-producer's app runs on the app's own origin.
import type { Client } from '@libsql/client';
import { coproduceConfiguredAt, parseOriginSetting, reviewOriginAt, type OriginLocation } from '../../src/coproducer/originRules';
import { issuer } from './chatgptAuth';
import { ServerNotConfiguredError } from './db';
import { clientAddress, rateLimit, rateLimitPeek } from './ratelimit';
import { unsealKeys } from './seal';
import { cipherHash } from './showWrites';

/** The seal's HKDF label: a co-producer seal never opens as an assistant's, nor the reverse. */
export const COPRODUCER_SEAL_INFO = 'icanrunashow coproducer delegated keys v1';
export const COPRODUCER_SEAL_VERSION = 'v1';

/** What a co-producer seal is bound to: the link's row. */
export function sealBinding(linkId: string, userId: string): string {
  return `${linkId}:${userId}:v1`;
}

/** A refusal with its status and error code, and anything else the body carries. */
export class CoproducerError extends Error {
  constructor(public code: string, public status: number, public extra: Record<string, unknown> = {}) {
    super(code);
    this.name = 'CoproducerError';
  }
}

/** The app's own origin: APP_URL, or the request's. An address that cannot serve the app is a configuration fault. */
export function appOrigin(req: Request): string {
  try {
    return issuer(req);
  } catch {
    throw new ServerNotConfiguredError();
  }
}

function at(origin: string): OriginLocation {
  const url = new URL(origin);
  return { origin: url.origin, protocol: url.protocol, hostname: url.hostname };
}

function override(): string | null {
  try {
    return parseOriginSetting(process.env.COPRODUCE_ORIGIN);
  } catch {
    // A mistyped override must never open links somewhere unintended.
    throw new ServerNotConfiguredError();
  }
}

/**
 * Where co-producers' calls come from: COPRODUCE_ORIGIN when set, else the
 * coproduce.* sibling of the app's origin when it has one, else the app's
 * own origin (development and tests). Throws ServerNotConfiguredError on a
 * malformed override.
 */
export function reviewOrigin(req: Request): string {
  const main = appOrigin(req);
  return reviewOriginAt(at(main), override()) || main;
}

/** Links can be made here: there is a review origin, or the app runs on localhost or 127.0.0.1. */
export function coproduceConfigured(req: Request): boolean {
  return coproduceConfiguredAt(at(appOrigin(req)), override());
}

/** What a valid link token opens. */
export interface BearerLink {
  linkId: string;
  userId: string;
  key: string;
  legacyKey?: string;
  labelCipher: string;
  /** Epoch seconds. */
  expiresAt: number;
  firstUsedAt: number | null;
}

const BEARER = /^Bearer ([A-Za-z0-9_-]{43})$/i;
// Unknown tokens per address before the rest are refused unread. A token is
// 256 random bits and cannot be guessed; this only bounds database work.
const MAX_FAILURES = 30;
const FAILURE_WINDOW_SECONDS = 300;
// last_used_at is a record for the owner, not a lock: once a minute is plenty.
const LAST_USED_EVERY_SECONDS = 60;

/**
 * The link a request's bearer token opens, its keys unsealed. A found token
 * never consults the failure bucket, so bogus traffic from a shared venue or
 * carrier address cannot lock a real co-producer out. Refuses with 410
 * link_ended (unknown, malformed, expired or withdrawn), or 429 once one
 * address has sent too many unknown tokens. Never 401: in the app that
 * means "sign in again".
 */
export async function bearerLink(db: Client, req: Request): Promise<BearerLink> {
  const match = BEARER.exec(req.headers.get('authorization') || '');
  const now = Math.floor(Date.now() / 1000);
  if (match) {
    const rows = (await db.execute({
      sql: `SELECT l.id, l.user_id, l.sealed_keys, l.label_cipher, l.expires_at, l.first_used_at, l.last_used_at
              FROM coproducer_links l JOIN users u ON u.id = l.user_id
             WHERE l.token_hash = ? AND l.expires_at > ?`,
      args: [await cipherHash(match[1]), now],
    })).rows;
    const row = rows[0];
    if (row) {
      const linkId = String(row[0]);
      const userId = String(row[1]);
      let keys;
      try {
        keys = await unsealKeys(String(row[2]), match[1], COPRODUCER_SEAL_INFO, COPRODUCER_SEAL_VERSION, sealBinding(linkId, userId));
      } catch {
        // The token was real, so this is no failure to count.
        throw new CoproducerError('link_ended', 410);
      }
      const lastUsed = row[6] == null ? null : Number(row[6]);
      if (lastUsed === null || now - lastUsed > LAST_USED_EVERY_SECONDS) {
        await db.execute({ sql: 'UPDATE coproducer_links SET last_used_at = ? WHERE id = ? AND user_id = ?', args: [now, linkId, userId] });
      }
      return {
        linkId,
        userId,
        key: keys.key,
        ...(keys.legacyKey ? { legacyKey: keys.legacyKey } : {}),
        labelCipher: String(row[3]),
        expiresAt: Number(row[4]),
        firstUsedAt: row[5] == null ? null : Number(row[5]),
      };
    }
  }
  const failures = `coprod:fail:${clientAddress(req)}`;
  if (!(await rateLimitPeek(db, failures, MAX_FAILURES, FAILURE_WINDOW_SECONDS)).allowed) {
    throw new CoproducerError('too_many_requests', 429);
  }
  await rateLimit(db, failures, MAX_FAILURES, FAILURE_WINDOW_SECONDS);
  throw new CoproducerError('link_ended', 410);
}
