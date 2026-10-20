/**
 * Navigations the service worker leaves to the host.
 *
 * The worker answers any navigation it keeps no file for with the app shell,
 * so that every address the app answers opens offline. That also caught the
 * addresses the host answers itself: an installed producer who followed a
 * link to /pricing landed on their shows, because the redirect in vercel.json
 * never ran. These go to the network instead.
 *
 * Workbox matches them against the path and query string.
 */
export const NAVIGATE_FALLBACK_DENYLIST: RegExp[] = [
  // The sales page and guides, and the short addresses vercel.json redirects
  // or rewrites to them. /tour/ and the guides themselves are precached, and
  // still open offline.
  /^\/(?:pricing|features|tour|guides)(?:[/?]|$)/,
  /^\/api\//,
  // Files the worker does not keep: robots.txt, sitemap.xml, llms.txt.
  /^[^?]*\.(?:txt|xml)(?:\?|$)/,
];
