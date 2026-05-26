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
