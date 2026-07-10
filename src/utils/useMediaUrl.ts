import { useEffect, useState } from 'react';
import { isMediaRef, resolveMediaUrl } from './mediaStore';

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
    resolveMediaUrl(src).then((url) => {
      if (!cancelled) setResolved({ src, url });
    });
    return () => {
      cancelled = true;
    };
  }, [src]);

  if (!src) return null;
  if (!isMediaRef(src)) return src;
  return resolved?.src === src ? resolved.url : null;
}
