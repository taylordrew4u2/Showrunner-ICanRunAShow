/**
 * A link someone was sent — to sign, to fill in, to watch.
 *
 * Two halves of one idea: which route such a link addresses when it arrives
 * (sharedLinkRoute), and the head the page is served with so it survives
 * being sent (sharedLinkPage).
 */

/** Which of the public, no-account routes a link addresses. */
export type SharedLinkKind = 'view' | 'profile' | 'sign';

export interface SharedLinkRoute {
  kind: SharedLinkKind;
  /** The token, which may be empty — see below. */
  token: string;
}

/**
 * Read the route out of a link's query string.
 *
 * Keyed on the parameter being *present*, not on it having a usable value. A
 * link that arrived with its token cut off — trimmed by a messaging app,
 * broken across two lines in a text, retyped by hand — is still someone
 * holding a link, and the one thing they must never be shown is a login for
 * an account they will never have. The pages downstream say what went wrong.
 * `?sign=` alone used to fall through to the app and ask them to sign in.
 */
export function sharedLinkRoute(search: string | URLSearchParams): SharedLinkRoute | null {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  // Order matters only in that one link cannot be two things; a URL carrying
  // more than one of these is malformed either way, so the first wins.
  for (const kind of ['view', 'profile', 'sign'] as const) {
    if (params.has(kind)) return { kind, token: params.get(kind) ?? '' };
  }
  return null;
}

/**
 * The page served for a link someone was sent — to sign, to fill in, to watch.
 *
 * Same app, same bundle, different head. The reason is a bug that made every
 * contract link useless: `index.html` declares the homepage as its canonical
 * and `og:url`, because for the homepage that is true. But Vercel serves that
 * one file for every route, so `/?sign=TOKEN#k=KEY` claimed to be the homepage
 * too — and the clients producers actually send links through (iMessage, Slack,
 * Messenger, WhatsApp) build their tappable preview card from `og:url`. The
 * performer tapped the card, arrived at `/`, and was shown a login for an
 * account they will never have. The contract was never the problem; the card
 * pointed somewhere else.
 *
 * So this variant states no URL of its own. With `og:url` and the canonical
 * link gone, a previewer has nothing to prefer over the address it was given,
 * which is the address that carries the token.
 */
export function sharedLinkPage(indexHtml: string): string {
  return (
    indexHtml
      // The two claims that sent people to the homepage.
      .replace(/[ \t]*<link rel="canonical"[^>]*>\r?\n?/g, '')
      .replace(/[ \t]*<meta property="og:url"[^>]*>\r?\n?/g, '')
      // A private link is not a page to index. It is also unguessable, so this
      // is politeness to crawlers rather than the thing keeping it private.
      .replace(
        /<meta name="robots" content="[^"]*"\s*\/?>/,
        '<meta name="robots" content="noindex, nofollow" />',
      )
      // What the preview card should say. Marketing copy about lineup building
      // is the wrong thing to put in front of someone holding a contract.
      .replace(
        /<title>[^<]*<\/title>/,
        '<title>Your link — I Can Run A Show</title>',
      )
      .replace(
        /(<meta (?:name|property)="(?:og:title|twitter:title)" content=")[^"]*(")/g,
        '$1Open your link$2',
      )
      .replace(
        /(<meta (?:name|property)="(?:description|og:description|twitter:description)" content=")[^"]*(")/g,
        '$1Someone sent you this to read, sign, or fill in. No account needed — just open it.$2',
      )
  );
}
