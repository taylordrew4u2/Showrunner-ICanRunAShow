// Media uploads are embedded as base64 inside the encrypted show payload that
// gets written to the backend in a single request. Large files (especially
// video) blow past the request/row size limit and make the whole save fail, so
// we cap the size of anything embedded and steer large videos to a link field.
export const MAX_EMBED_BYTES = 8 * 1024 * 1024; // 8 MB — images / generic / video (steer big video to links)
export const MAX_AUDIO_EMBED_BYTES = 30 * 1024 * 1024; // 30 MB — music tracks run larger

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Returns a human-readable error if the file is too large to embed, else null.
// Audio gets a more generous limit since songs/walk-on tracks are bigger.
export function embedSizeError(file: File, kind = 'file'): string | null {
  const isAudio = /audio|music|song|track/i.test(kind);
  const max = isAudio ? MAX_AUDIO_EMBED_BYTES : MAX_EMBED_BYTES;
  if (file.size > max) {
    const tip =
      kind === 'video'
        ? ' For large videos, paste a hosted link (YouTube, Vimeo, Drive) instead.'
        : '';
    return `That ${kind} is ${formatBytes(file.size)} — over the ${formatBytes(
      max,
    )} limit for uploaded files.${tip}`;
  }
  return null;
}

export function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Downscale and recompress an image file via canvas so a typical phone photo
 * (often 5–10+ MB) ends up well under a megabyte. Returns a JPEG data URL.
 */
export async function compressImage(
  file: File,
  opts: { maxDim?: number; quality?: number } = {},
): Promise<string> {
  const maxDim = opts.maxDim ?? 1600;
  const quality = opts.quality ?? 0.85;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not decode image'));
      el.src = url;
    });
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not supported');
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Open a native file picker and resolve with the chosen file (or null if
 * cancelled). The input is attached to the DOM before clicking — a detached
 * input.click() silently does nothing on iOS Safari and some mobile browsers,
 * which is why uploads could appear to "do nothing."
 */
export function pickFile(accept: string): Promise<File | null> {
  return pickFiles(accept, false).then((files) => files[0] ?? null);
}

/**
 * Multi-select variant of {@link pickFile}. Resolves with all chosen files
 * (empty array if the dialog is dismissed). Shares the mobile-safe pattern:
 * the input is attached to the DOM before clicking, and cleaned up on refocus
 * if `change` never fires.
 */
export function pickFiles(accept: string, multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.style.opacity = '0';
    let settled = false;

    const cleanup = () => {
      if (input.parentNode) input.parentNode.removeChild(input);
    };

    input.addEventListener('change', () => {
      settled = true;
      const files = input.files ? Array.from(input.files) : [];
      cleanup();
      resolve(files);
    });

    // If the dialog is dismissed without choosing, clean up on refocus.
    const onFocus = () => {
      window.removeEventListener('focus', onFocus);
      window.setTimeout(() => {
        if (!settled) {
          cleanup();
          resolve([]);
        }
      }, 500);
    };
    window.addEventListener('focus', onFocus);

    document.body.appendChild(input);
    input.click();
  });
}

