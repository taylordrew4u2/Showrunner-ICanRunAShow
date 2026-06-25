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
