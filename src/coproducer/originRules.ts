/**
 * Where co-producer links open, worked out from addresses alone.
 *
 * A co-producer's view runs on its own origin, the review origin, so its
 * browser storage is never the storage of either producer's own account. For
 * a main origin https://<host> that is https://coproduce.<host>: a second
 * domain on the same deployment, serving the same app and the same /api.
 * Production is https://icanrunashow.com, so co-producers work on
 * https://coproduce.icanrunashow.com.
 *
 * Nothing here reads the page or the environment, so the server (from
 * APP_URL), the app (from its own address, origins.ts) and the link page's
 * inline script all use the same rules. A deployment whose address has no
 * coproduce.* sibling, a Vercel preview for instance, has no review origin,
 * and links are not made there; localhost and 127.0.0.1 are the exception,
 * for development and the end-to-end tests, where review mode runs on the
 * app's own origin unless an explicit override names another.
 */

/** The label in front of the main host that names the review origin. */
export const REVIEW_SUBDOMAIN = 'coproduce';

/**
 * Hosts known to answer on coproduce.<host> as well. The app cannot see the
 * server's APP_URL, so it only offers co-producer links on these.
 */
export const HOSTS_WITH_REVIEW_ORIGIN: readonly string[] = ['icanrunashow.com'];

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

function isIpAddress(hostname: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':') || hostname.startsWith('[');
}

/**
 * The review origin for a main origin: https://<host> gives
 * https://coproduce.<host>. Null for anything that cannot have one: not
 * https, an IP address, a single-label host, or an address that is already a
 * review origin.
 */
export function reviewOriginFor(mainOrigin: string): string | null {
  let url: URL;
  try {
    url = new URL(mainOrigin);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || isIpAddress(host) || !host.includes('.')) return null;
  if (host.startsWith(`${REVIEW_SUBDOMAIN}.`)) return null;
  return `https://${REVIEW_SUBDOMAIN}.${url.host.toLowerCase()}`;
}

/** The main origin a review origin belongs to: https://coproduce.<host> gives https://<host>. */
export function mainOriginFor(reviewOrigin: string): string | null {
  let url: URL;
  try {
    url = new URL(reviewOrigin);
  } catch {
    return null;
  }
  const host = url.host.toLowerCase();
  const prefix = `${REVIEW_SUBDOMAIN}.`;
  if (url.protocol !== 'https:' || !host.startsWith(prefix) || !host.slice(prefix.length).includes('.')) return null;
  return `https://${host.slice(prefix.length)}`;
}

/**
 * The review origin for a page at `here`, or '' when there is none and
 * review mode runs on the page's own origin. `configured` (an override,
 * already through parseOriginSetting) wins. Otherwise a page on a listed
 * host, or on that host's coproduce.* sibling, has one.
 */
export function reviewOriginAt(here: OriginLocation, configured?: string | null): string {
  if (configured) return configured;
  if (here.protocol !== 'https:') return '';
  const host = here.hostname.toLowerCase();
  if (HOSTS_WITH_REVIEW_ORIGIN.includes(host)) return reviewOriginFor(here.origin) ?? '';
  const main = mainOriginFor(here.origin);
  if (main && HOSTS_WITH_REVIEW_ORIGIN.includes(new URL(main).hostname)) return here.origin;
  return '';
}

/** The main origin for a page at `here`: the override, else the listed host a review origin belongs to, else the page's own. */
export function mainOriginAt(here: OriginLocation, configured?: string | null): string {
  if (configured) return configured;
  if (here.protocol === 'https:') {
    const main = mainOriginFor(here.origin);
    if (main && HOSTS_WITH_REVIEW_ORIGIN.includes(new URL(main).hostname)) return main;
  }
  return here.origin;
}

/** Links can be made from a page at `here`: it has a review origin, or it is a local development address. */
export function coproduceConfiguredAt(here: OriginLocation, configured?: string | null): boolean {
  return reviewOriginAt(here, configured) !== '' || LOCAL_HOSTS.has(here.hostname.toLowerCase());
}
