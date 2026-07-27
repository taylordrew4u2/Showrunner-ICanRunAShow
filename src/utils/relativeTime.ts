/**
 * Human-readable "how long ago" labels for the sync status.
 *
 * The status pill's whole job is to be believed, so the wording has to stay
 * honest at the edges: never round a stale timestamp down to "just now", and
 * never claim precision for something that happened days ago — fall back to a
 * date once "hours ago" stops meaning anything.
 */
export function timeAgo(timestamp: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 15) return 'just now';
  if (seconds < 60) return `${seconds} sec ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * The sentence the status panel uses for the last confirmed save. Kept next to
 * timeAgo so the "nothing yet" wording can't drift into something that reads
 * like a failure — a brand-new account with nothing to save isn't a problem.
 */
export function lastSavedSentence(lastSavedAt: number | null, now: number = Date.now()): string {
  if (!lastSavedAt) return 'Nothing has needed saving yet.';
  return `Last confirmed save ${timeAgo(lastSavedAt, now)}.`;
}
