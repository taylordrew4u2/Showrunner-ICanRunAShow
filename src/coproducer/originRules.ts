/**
 * Where co-producer links open, worked out from addresses alone.
 *
 * A co-producer's view runs on its own origin, the review origin, so its
 * browser storage is never that of either producer's own account. Each main
 * origin that has one is listed with it in REVIEW_ORIGINS: another domain on
 * the same deployment, serving the same app and the same /api. Production is
 * https://icanrunashow.com, so co-producers work on
 * https://showrunner-theta.vercel.app.
 *
 * Nothing here reads the page or the environment, so the server (from
 * APP_URL), the app (from its own address, origins.ts) and the link page's
 * inline script all use the same rules. A deployment whose address is not
 * listed, a Vercel preview for instance, has no review origin, and links are
 * not made there; localhost and 127.0.0.1 are the exception, for development
 * and the end-to-end tests, where review mode runs on the app's own origin
 * unless an explicit override names another.
 */

/**
 * Each main origin with a review origin, and that review origin. The one
 * place either is named: the app, the server and the link page's script all
 * read this. Both sides are bare https origins, lower case. A review origin
 * must be attached to the same deployment as its main origin and be a
 * different site from it (vercel.app is on the Public Suffix List, so each
 * *.vercel.app name is a site of its own). It opens co-producer links and
 * nothing else, so it must not be an address producers are given for the app.
 *
 * Moving production to https://coproduce.icanrunashow.com, once that domain
 * is attached to the Vercel project, is a change to this one entry.
 */
export const REVIEW_ORIGINS: Readonly<Record<string, string>> = {
  'https://icanrunashow.com': 'https://showrunner-theta.vercel.app',
};

/** The parts of a page's address these rules read. */
export interface OriginLocation {
  origin: string;
  protocol: string;
  hostname: string;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

/** http or https on localhost or 127.0.0.1, any port. */
export function isLocalOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (url.protocol === 'http:' || url.protocol === 'https:') && LOCAL_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

/**
 * An origin setting as given (an environment override), normalised to its
 * origin: an https origin, or http on localhost or 127.0.0.1 with a port.
 * Null when unset or empty; throws on anything else, so a mistyped setting
 * fails loudly rather than quietly opening links somewhere unintended.
 */
export function parseOriginSetting(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`Not an origin: ${trimmed}`);
  }
  const bare = url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password;
  const https = url.protocol === 'https:';
  const localHttp = url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname) && url.port !== '';
  if (!bare || !(https || localHttp)) throw new Error(`Not an https origin, or http on localhost with a port: ${trimmed}`);
  return url.origin;
}

/** An https address as REVIEW_ORIGINS writes one: its origin, lower case. Null for anything else. */
function httpsOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

/** The review origin listed for a main origin. Null when it has none: any address not listed, a review origin included. */
export function reviewOriginFor(mainOrigin: string): string | null {
  const main = httpsOrigin(mainOrigin);
  return main !== null && Object.hasOwn(REVIEW_ORIGINS, main) ? REVIEW_ORIGINS[main] : null;
}

/** The main origin a review origin is listed for. Null for any address that is not a listed review origin. */
export function mainOriginFor(reviewOrigin: string): string | null {
  const review = httpsOrigin(reviewOrigin);
  if (review === null) return null;
  return Object.keys(REVIEW_ORIGINS).find((main) => REVIEW_ORIGINS[main] === review) ?? null;
}

/**
 * The review origin for a page at `here`, or '' when there is none and
 * review mode runs on the page's own origin. `configured` (an override,
 * already through parseOriginSetting) wins. Otherwise a page on a listed
 * main origin, or on a listed review origin, has one.
 */
export function reviewOriginAt(here: OriginLocation, configured?: string | null): string {
  if (configured) return configured;
  const listed = reviewOriginFor(here.origin);
  if (listed) return listed;
  return mainOriginFor(here.origin) ? here.origin : '';
}

/** The main origin for a page at `here`: the override, else the main origin a listed review origin belongs to, else the page's own. */
export function mainOriginAt(here: OriginLocation, configured?: string | null): string {
  if (configured) return configured;
  return mainOriginFor(here.origin) ?? here.origin;
}

/** Links can be made from a page at `here`: it has a review origin, or it is a local development address. */
export function coproduceConfiguredAt(here: OriginLocation, configured?: string | null): boolean {
  return reviewOriginAt(here, configured) !== '' || LOCAL_HOSTS.has(here.hostname.toLowerCase());
}
