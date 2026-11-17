/**
 * The page a co-producer link opens: /coproduce#t=<token>.
 *
 * Served from its own file, link-coproduce.html, never index.html, for the
 * reason every sent link is (see sharedLinkPage): index.html names the
 * homepage as its canonical and og:url, and the apps producers send links
 * through build their tappable card from og:url, so the co-producer would
 * land on / without the token.
 *
 * Its first script runs before any module and before anything else reads
 * the address. On the main origin it moves the page, fragment and all, to
 * the review origin, where the co-producer's view runs with browser storage
 * of its own, so it can reach neither producer's own account. On the review
 * origin (or where there is none) it takes the token out of the fragment
 * into memory and strips the address at once, so the token never waits in
 * the address bar for anything else to load.
 *
 * The review origin is worked out in the page from its own address, by the
 * rules in coproducer/originRules.ts: on icanrunashow.com it is
 * coproduce.icanrunashow.com. A build-time override (VITE_COPRODUCE_ORIGIN,
 * for the end-to-end tests) wins when set.
 */
import {
  HOSTS_WITH_REVIEW_ORIGIN,
  parseOriginSetting,
  REVIEW_SUBDOMAIN,
} from '../coproducer/originRules';
import { COPRODUCE_PATH, COPRODUCER_FRAGMENT, COPRODUCER_TOKEN_GLOBAL } from '../coproducer/types';
import { linkPageWithCopy } from './sharedLink';

/** What the link's preview card says. Nothing about the account: nothing that fetches the page can know it. */
export const COPRODUCE_COPY = {
  title: 'A shared show account — I Can Run A Show',
  card: 'A producer shared their account with you',
  description: 'Open it to see their shows. Anything you change goes to them for approval first.',
};

/** The file /coproduce is served from. See the rewrite in vercel.json. */
export const COPRODUCE_PAGE_NAME = 'link-coproduce.html';

/** A value written into the script as a JavaScript literal that cannot close the script element. */
function literal(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/**
 * The inline boot script's source, for the page and for tests (run with a
 * fake location, history and window). `reviewOverride` is the build-time
 * override of the review origin, '' for none.
 */
export function coproduceBootScript(reviewOverride: string): string {
  return `(function () {
  var review = ${literal(reviewOverride)};
  var hosts = ${literal(HOSTS_WITH_REVIEW_ORIGIN)};
  var prefix = ${literal(`${REVIEW_SUBDOMAIN}.`)};
  if (!review && location.protocol === 'https:') {
    var host = location.hostname.toLowerCase();
    if (hosts.indexOf(host) >= 0) review = 'https://' + prefix + location.host.toLowerCase();
    else if (host.indexOf(prefix) === 0 && hosts.indexOf(host.slice(prefix.length)) >= 0) review = location.origin;
  }
  if (review && location.origin !== review) {
    location.replace(review + ${literal(COPRODUCE_PATH)} + location.hash);
    return;
  }
  var match = ${String(COPRODUCER_FRAGMENT)}.exec(location.hash);
  if (match) window[${literal(COPRODUCER_TOKEN_GLOBAL)}] = match[1];
  if (location.hash || location.search) history.replaceState(null, '', ${literal(COPRODUCE_PATH)});
})();`;
}

/** linkPageWithCopy(indexHtml, COPRODUCE_COPY) with the boot script as the first child of <head>. */
export function coproduceLinkPage(indexHtml: string, reviewOverride: string): string {
  const page = linkPageWithCopy(indexHtml, COPRODUCE_COPY);
  const script = `<script>${coproduceBootScript(reviewOverride)}</script>`;
  return page.replace(/<head(\s[^>]*)?>/i, (head) => `${head}\n    ${script}`);
}

/**
 * The build's origin overrides, each normalised: an https origin, or http on
 * localhost or 127.0.0.1 with a port, or '' when unset. Throws on anything
 * else, so vite.config.ts refuses to build a page that would send
 * co-producers somewhere unintended.
 */
export function coproduceOriginSettings(env: Record<string, string | undefined>): { review: string; main: string } {
  const read = (name: string): string => {
    try {
      return parseOriginSetting(env[name]) ?? '';
    } catch (err) {
      throw new Error(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  return { review: read('VITE_COPRODUCE_ORIGIN'), main: read('VITE_MAIN_ORIGIN') };
}
