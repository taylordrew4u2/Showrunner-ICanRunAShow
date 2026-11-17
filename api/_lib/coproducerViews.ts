// What a co-producer is served of the owner's account. Not a route
// (underscore-prefixed).
//
// A co-producer may see everything the owner sees except the secrets that
// would let them act without asking: the tokens and keys of the links the
// owner has sent (signing, details and viewer links) and a show's viewer
// audio key. So, unlike the assistant's views (assistantViews.ts), which are
// built field by field, a view here is a copy of everything with those
// secrets taken out, then passed through the strict schema in drop mode, so
// the co-producer's screens only ever render values of the types they
// expect. A secret field added to the data later fails the redaction test
// (serverCoproducerViews.test.ts) rather than leaking quietly.
//
// A token becomes a pseudonym rather than disappearing: "this show has a
// viewer link" stays true for the co-producer's screens, a request can name
// the link it wants withdrawn, and the owner's app (src/coproducer/
// redaction.ts) maps the pseudonym back to the real row. The same rule, the
// same vectors, on both sides.
import { sanitizeSettings, sanitizeShow } from '../../src/coproducer/schema';
import { PSEUDONYM_LABEL, REDACTED_TOKEN_PREFIX } from '../../src/coproducer/types';
import type { AppSettings, Show } from '../../src/types';

const encoder = new TextEncoder();

/** 'redacted-' + first 32 hex chars of SHA-256(PSEUDONYM_LABEL + token). Deterministic, one-way, unique per token. */
export async function pseudonym(token: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(PSEUDONYM_LABEL + token)));
  const hex = Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
  return REDACTED_TOKEN_PREFIX + hex.slice(0, 32);
}

type Bag = Record<string, unknown>;

function isBag(value: unknown): value is Bag {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** A deep copy through JSON: what was decrypted was JSON, so nothing is lost. */
function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** A link token as its pseudonym, when it is a non-empty string; anything else is no token at all. */
async function redactToken(holder: Bag, field: string): Promise<void> {
  if (!Object.hasOwn(holder, field)) return;
  const value = holder[field];
  if (typeof value === 'string' && value !== '') holder[field] = await pseudonym(value);
  else if (value !== '') delete holder[field];
}

async function redactShowInPlace(show: Bag): Promise<void> {
  await redactToken(show, 'viewToken');
  delete show.viewerKey;
}

async function redactLinkRows(settings: Bag, field: 'signatureRequests' | 'profileRequests'): Promise<void> {
  const rows = settings[field];
  if (!Array.isArray(rows)) return;
  for (const row of rows) {
    if (!isBag(row)) continue;
    await redactToken(row, 'token');
    // The row keeps its key field, empty, so it still reads as a link row.
    row.key = '';
  }
}

/** A show without its viewer link's token (pseudonymised) or audio key (removed). */
export async function redactShow(show: Show): Promise<Show> {
  const out = copy(show) as unknown;
  if (isBag(out)) await redactShowInPlace(out);
  return out as Show;
}

/** Settings without any link's token (pseudonymised) or key (emptied), the shows in the trash included. */
export async function redactSettings(settings: AppSettings): Promise<AppSettings> {
  const out = copy(settings) as unknown;
  if (!isBag(out)) return out as AppSettings;
  if (Array.isArray(out.trash)) {
    for (const item of out.trash) {
      if (isBag(item) && isBag(item.data)) await redactShowInPlace(item.data);
    }
  }
  await redactLinkRows(out, 'signatureRequests');
  await redactLinkRows(out, 'profileRequests');
  return out as unknown as AppSettings;
}

/** Redacted, then sanitised: what C2 serves. Null for a show the schema cannot read (no string id). */
export async function coproducerShowView(show: Show): Promise<Show | null> {
  return sanitizeShow(await redactShow(show));
}

/** Redacted, then sanitised: what C4 serves. */
export async function coproducerSettingsView(settings: AppSettings): Promise<AppSettings | null> {
  if (!isBag(settings)) return null;
  return sanitizeSettings(await redactSettings(settings));
}
