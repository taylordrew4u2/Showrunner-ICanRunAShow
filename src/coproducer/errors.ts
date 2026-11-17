/**
 * Thrown by anything that would write to the account, or hand something out,
 * while the app is showing a co-producer the owner's account.
 *
 * In a module of its own so the delivery gate (gates.ts) and the helpers it
 * guards can throw it without importing review mode itself, which imports
 * them: reviewMode.ts re-exports it.
 */
export class ReviewModeBlockedError extends Error {
  readonly code = 'review_mode';
  readonly reason?: 'unsupported_media';

  constructor(reason?: 'unsupported_media') {
    super(reason === 'unsupported_media' ? 'That kind of file cannot be sent for approval.' : 'Not available in co-producer view.');
    this.name = 'ReviewModeBlockedError';
    this.reason = reason;
  }
}
