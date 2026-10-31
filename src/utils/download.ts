import { isNativeShell } from './nativeShell';

/**
 * Handing a file to the person: a backup, a flyer, a headshot, a DJ list, a
 * signed contract.
 *
 * In a browser that is the browser's own download, a link with `download`
 * clicked in the page. The iOS app cannot do that. Capacitor's navigation
 * delegate cancels every top-level load that is not the live site, and a
 * blob: or data: URL is not, so the click went nowhere: no file, no error,
 * and then a backup the app said had been taken. In the app the file goes to
 * the share sheet instead, which offers Save to Files, AirDrop and Mail.
 */

/** What became of a file. */
export type FileDelivery =
  /** Handed to the browser's download. Browsers don't say whether it was saved. */
  | 'downloaded'
  /** The share sheet took it: saved to Files, sent, AirDropped. */
  | 'shared'
  /** The share sheet was closed. An answer, not a failure. */
  | 'cancelled'
  /** The tap that asked had gone stale by the time the file was ready. */
  | 'needs-tap'
  /** The app could not hand it over on this device. */
  | 'failed';

/**
 * Save a file, in the way this page can.
 *
 * Nothing is awaited before the share sheet is asked for, so a call made
 * straight from a click handler is still inside that click.
 */
export async function deliverFile(blob: Blob, fileName: string): Promise<FileDelivery> {
  if (!isNativeShell()) {
    downloadFile(blob, fileName);
    return 'downloaded';
  }
  // Never the download link as a fallback here: it is cancelled just the same.
  const files = [new File([blob], fileName, { type: blob.type })];
  if (!canShareFiles(files)) return 'failed';
  try {
    // Nothing but the file, so the sheet treats it as a file to save.
    await navigator.share({ files });
    return 'shared';
  } catch (error) {
    const name = (error as { name?: unknown } | null)?.name;
    if (name === 'AbortError') return 'cancelled';
    // Safari saying a share has to start from a fresh tap, and fetching the
    // file outlasted the one that asked.
    if (name === 'NotAllowedError') return 'needs-tap';
    return 'failed';
  }
}

/** Whether the file reached the person. */
export function isDelivered(outcome: FileDelivery): boolean {
  return outcome === 'downloaded' || outcome === 'shared';
}

/** What to tell the person when the file did not reach them, or null when there is nothing to say. */
export function deliveryProblem(outcome: FileDelivery): string | null {
  if (outcome === 'needs-tap') return 'The file took a moment too long to get ready. Tap again to save it.';
  if (outcome === 'failed') {
    return "Couldn't open the share sheet to save the file. Try again, or open icanrunashow.com in Safari and download it there.";
  }
  return null;
}

/**
 * The browser's own download.
 *
 * In the page, and the URL left alive for a minute: Firefox and iOS Safari
 * start the download after click() returns, and a URL revoked before then
 * gives no file at all.
 */
function downloadFile(blob: Blob, fileName: string): void {
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}

function canShareFiles(files: File[]): boolean {
  try {
    return typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' && navigator.canShare({ files });
  } catch {
    return false;
  }
}
