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
 * What each kind of link should say about itself before it is opened.
 *
 * A messaging client builds its preview card by fetching the URL and reading
 * the head — it does not run the app, so whatever the card says has to be in
 * the file. One neutral page for all three kinds made a contract arrive
 * looking like an unexplained link, which is not what a producer wants to put
 * in front of a comedian they are trying to book.
 *
 * As specific as it can honestly be, and no more. The producer's name and the
 * contract's title are in the payload, which is encrypted under a key that
 * lives in the link's fragment and never reaches a server — so nothing that
 * fetches this page can know them, and the card cannot say them.
 */
const LINK_COPY: Record<SharedLinkKind, { title: string; card: string; description: string }> = {
  sign: {
    title: 'An agreement to sign — I Can Run A Show',
    card: 'An agreement to sign',
    description:
      'A producer has sent you a contract to read and sign. No account, no app, no signing up — open it, read it, and sign at the bottom.',
  },
  profile: {
    title: 'Your performer details — I Can Run A Show',
    card: 'Your performer details',
    description:
      'A producer has asked you for your details for a show. No account needed — fill it in and send it back.',
  },
  view: {
    title: "Tonight's running order — I Can Run A Show",
    card: "Tonight's running order",
    description: 'Follow the running order live as the show runs. No account needed.',
  },
};

/** The file each kind of link is served from. See the rewrites in vercel.json. */
export function sharedLinkPageName(kind: SharedLinkKind): string {
  return `link-${kind}.html`;
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
 * which is the address that carries the token. And it says what the link is,
 * so the card reads as the thing being sent rather than as a bare address.
 */
export function sharedLinkPage(indexHtml: string, kind: SharedLinkKind): string {
  const copy = LINK_COPY[kind];
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
      .replace(/<title>[^<]*<\/title>/, `<title>${copy.title}</title>`)
      .replace(
        /(<meta (?:name|property)="(?:og:title|twitter:title)" content=")[^"]*(")/g,
        `$1${copy.card}$2`,
      )
      .replace(
        /(<meta (?:name|property)="(?:description|og:description|twitter:description)" content=")[^"]*(")/g,
        `$1${copy.description}$2`,
      )
      // The promo screenshot is the app selling itself. Wrong picture for a
      // contract, and it makes the card look like an advert rather than
      // paperwork from someone the performer is talking to.
      .replace(/[ \t]*<meta (?:name|property)="(?:og:image|twitter:image)(?::(?:width|height|alt))?"[^>]*>\r?\n?/g, '')
      .replace(
        /<meta name="twitter:card" content="[^"]*"\s*\/?>/,
        '<meta name="twitter:card" content="summary" />',
      )
      // And the structured data, which is a third claim to be the homepage
      // ("url": "https://icanrunashow.com") wrapped in a product listing —
      // price, feature list, screenshot. None of it describes a contract.
      .replace(/[ \t]*<!--\s*Structured data[^>]*-->\r?\n?/g, '')
      .replace(
        /[ \t]*<script type="application\/ld\+json">[\s\S]*?<\/script>\r?\n?/g,
        '',
      )
  );
}
