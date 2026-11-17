/**
 * Helpers for turning free-text social handles into clickable profile links and
 * for composing bulk emails to a lineup.
 */

/**
 * Build a clickable profile URL from a social handle or URL. A bare handle
 * (e.g. "@jane" or "jane") is treated as Instagram; a full URL or a
 * "domain.com/…" string is used as-is.
 */
export function socialLink(value?: string): string | null {
  if (!value) return null;
  const v = value.trim();
  if (!v) return null;
  // Already a full URL.
  if (/^https?:\/\//i.test(v)) return v;
  // Domain typed without a protocol, e.g. "instagram.com/jane" or "tiktok.com/@jane".
  if (/^(www\.)?[a-z0-9-]+\.[a-z]{2,}\//i.test(v)) {
    return `https://${v.replace(/^www\./i, '')}`;
  }
  // Bare handle → Instagram profile.
  const handle = v.replace(/^@/, '').replace(/\s+/g, '');
  if (!handle) return null;
  return `https://instagram.com/${encodeURIComponent(handle)}`;
}

/**
 * Sites whose profile links start with the handle: instagram.com/name.
 *
 * Not TikTok or Threads: a profile there is always tiktok.com/@name, found by
 * its @, and what else comes first is a share link — tiktok.com/t/ZT8abc,
 * the one the app's Share button copies — which was tagged "@t".
 */
const HANDLE_FIRST = new Set(['instagram.com', 'x.com', 'twitter.com']);

/** Pages on those sites that are not anybody's profile: a post, a reel, a story. */
const NOT_A_PROFILE = new Set([
  'p', 'reel', 'reels', 'stories', 'explore', 'tv', 'accounts', 'share', 's', 'i', 'intent', 'hashtag', 'search', 'home',
]);

/**
 * The handle in a pasted profile link, if it has one.
 *
 * An "@name" anywhere in the path is one (youtube.com/@name,
 * tiktok.com/@name). Otherwise only the sites that put the handle first are
 * read that way. Everywhere else the first part of the path is a page —
 * youtube.com/channel/…, facebook.com/profile.php — and tagging "@channel"
 * tags a stranger, so the person is named untagged instead.
 */
function handleInLink(host: string, path: string): string | null {
  const site = host.toLowerCase().replace(/^(?:www|m|mobile)\./, '');
  const parts = path.split(/[?#]/)[0].split('/').filter(Boolean);
  const first = parts[0];
  const candidate = parts.find((part) => part.startsWith('@'))
    ?? (HANDLE_FIRST.has(site) && first && !NOT_A_PROFILE.has(first.toLowerCase()) ? first : null);
  const handle = candidate?.replace(/^@+/, '');
  return handle && /^[\w.-]+$/.test(handle) ? `@${handle}` : null;
}

/**
 * Normalise whatever the producer typed into a handle.
 *
 * The field is free text and gets filled in from wherever the booking came
 * from, so it arrives as "@name", "name", or a pasted profile URL.
 */
export function toHandle(input: string | undefined): string | null {
  const text = input?.trim();
  if (!text) return null;

  // A pasted link has a scheme or a path. "mona.sable" with neither is a
  // handle with a dot in it, not a web address.
  const url = /^(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(\/\S*)?$/i.exec(text);
  if (url && (url[2] !== undefined || /^https?:\/\//i.test(text))) return handleInLink(url[1], url[2] ?? '');

  const cleaned = text.replace(/^@+/, '').replace(/\/+$/, '').trim();
  // A slash left over is a link that could not be read, not a handle.
  if (!cleaned || /[\s/]/.test(cleaned)) return null;
  return `@${cleaned}`;
}

/** Loose email validation — enough to decide whether to offer a mail action. */
export function isEmail(value?: string): boolean {
  if (!value) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/**
 * Compose a `mailto:` link that BCCs everyone (so recipients don't see each
 * other's addresses) with an optional subject and body. Returns null when there
 * are no valid addresses.
 */
export function bulkMailto(
  emails: (string | undefined)[],
  opts: { subject?: string; body?: string } = {},
): string | null {
  const valid = Array.from(
    new Set(emails.map((e) => (e ?? '').trim()).filter((e) => isEmail(e))),
  );
  if (valid.length === 0) return null;
  const params = [`bcc=${encodeURIComponent(valid.join(','))}`];
  if (opts.subject) params.push(`subject=${encodeURIComponent(opts.subject)}`);
  if (opts.body) params.push(`body=${encodeURIComponent(opts.body)}`);
  return `mailto:?${params.join('&')}`;
}
