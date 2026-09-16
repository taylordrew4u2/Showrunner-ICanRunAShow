import { useEffect, useState } from 'react';
import { isMediaRef, resolveMediaUrl } from './mediaStore';

/**
 * A fetch that failed is tried again, a few times, spaced out.
 *
 * Venue wifi drops requests. Before this, one dropped chunk meant the headshot
 * stayed a blank initial until the profile was closed and reopened — which
 * read as "the photo didn't save", when it had. The reference is fine; only
 * the download needs another go. Bounded, so a photo that is genuinely gone
 * does not keep a phone polling all night.
 */
export const MEDIA_RETRY_DELAYS_MS = [2_000, 6_000, 15_000] as const;

/**
 * Resolve an audio/media source for `<audio src>` previews. Plain data URLs
 * and http links return immediately; `media:` references resolve async from
 * the chunked media store (null while loading or on failure).
 */
export function useMediaUrl(src?: string): string | null {
  // Track which src the resolved URL belongs to, so switching sources never
  // shows a stale resolution.
  const [resolved, setResolved] = useState<{ src: string; url: string | null } | null>(null);

  useEffect(() => {
    if (!src || !isMediaRef(src)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    const load = () => {
      resolveMediaUrl(src).then((url) => {
        if (cancelled) return;
        setResolved({ src, url });
        if (url === null && attempt < MEDIA_RETRY_DELAYS_MS.length) {
          timer = setTimeout(load, MEDIA_RETRY_DELAYS_MS[attempt++]);
        }
      });
    };
    // Coming back online is the best moment to try again, whatever the timer says.
    const onOnline = () => { if (timer) { clearTimeout(timer); timer = undefined; } load(); };
    window.addEventListener('online', onOnline);
    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener('online', onOnline);
    };
  }, [src]);

  if (!src) return null;
  if (!isMediaRef(src)) return src;
  return resolved?.src === src ? resolved.url : null;
}
