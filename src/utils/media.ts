// Audio and performer photos are the only media the app uploads — video and
// generic files were removed to keep stored payloads small. Neither embeds in
// the show payload; both upload to the chunked media store (see mediaStore.ts),
// so audio gets a real-world song-sized cap.
const MAX_AUDIO_UPLOAD_BYTES = 25 * 1024 * 1024;
// Photos are resized in the browser before upload, so this cap only has to
// stop a file too big to decode without trouble in the first place.
const MAX_IMAGE_UPLOAD_BYTES = 20 * 1024 * 1024;

/** Size check for audio going to the media store (not embedded). */
export function audioUploadSizeError(file: File): string | null {
  if (file.size > MAX_AUDIO_UPLOAD_BYTES) {
    return `That audio file is ${formatBytes(file.size)} — over the ${formatBytes(
      MAX_AUDIO_UPLOAD_BYTES,
    )} limit. Try a compressed format (MP3/AAC) or trim the track.`;
  }
  return null;
}

/** Size check for a photo before it's resized and uploaded. */
export function imageUploadSizeError(file: File): string | null {
  if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
    return `That image is ${formatBytes(file.size)} — over the ${formatBytes(
      MAX_IMAGE_UPLOAD_BYTES,
    )} limit. Try a smaller photo or a screenshot of it.`;
  }
  return null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Decode a `data:` URL to its raw bytes, in-process.
 *
 * Web Audio needs an ArrayBuffer, and the obvious way to get one out of a data
 * URL is `fetch(dataUrl).arrayBuffer()`. But a fetch — of any scheme, data:
 * included — is governed by the CSP `connect-src` directive, and ours lists
 * only 'self' and https:. So every soundboard press was blocked at the fetch
 * and the track never played, while the same performer's photo rendered fine
 * because images go through `img-src`, which does allow data:. Decoding here
 * keeps the bytes in-process, where no CSP directive applies.
 *
 * Returns null for anything that isn't a data URL this can decode.
 */
export function dataUrlToBytes(dataUrl: string): Uint8Array | null {
  if (!dataUrl.startsWith('data:')) return null;
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;
  const meta = dataUrl.slice('data:'.length, comma);
  const body = dataUrl.slice(comma + 1);

  if (!/;base64$/i.test(meta)) {
    // Percent-encoded payload. Never what an upload produces — FileReader
    // always gives us base64 — but it is a valid data URL, so decode it.
    try {
      const text = decodeURIComponent(body);
      const out = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
      return out;
    } catch {
      return null;
    }
  }

  let binary: string;
  try {
    binary = atob(body);
  } catch {
    // Some encoders wrap base64 at a fixed column. Retry without the padding
    // whitespace rather than copying a multi-megabyte string on every track.
    try {
      binary = atob(body.replace(/\s+/g, ''));
    } catch {
      return null;
    }
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
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
 * Open a native file picker and resolve with the chosen file (or null if
 * cancelled). The input is attached to the DOM before clicking — a detached
 * input.click() silently does nothing on iOS Safari and some mobile browsers,
 * which is why uploads could appear to "do nothing."
 */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.style.opacity = '0';
    let settled = false;

    const cleanup = () => {
      if (input.parentNode) input.parentNode.removeChild(input);
    };

    input.addEventListener('change', () => {
      settled = true;
      const file = input.files?.[0] ?? null;
      cleanup();
      resolve(file);
    });

    // If the dialog is dismissed without choosing, clean up on refocus.
    const onFocus = () => {
      window.removeEventListener('focus', onFocus);
      window.setTimeout(() => {
        if (!settled) {
          cleanup();
          resolve(null);
        }
      }, 500);
    };
    window.addEventListener('focus', onFocus);

    document.body.appendChild(input);
    input.click();
  });
}

