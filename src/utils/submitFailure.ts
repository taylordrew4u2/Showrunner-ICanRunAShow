import { ServerNotConfiguredError, type ApiError } from './api';

/**
 * Why a submission did not go through, in words the person can act on.
 *
 * Every one of these used to read "check your connection and try again",
 * including the ones where the connection was fine and trying again could
 * never work. Someone holding a contract they cannot send needs to know
 * whether to wait, to move nearer the door, or to ask for a new link — and
 * saying the wrong one costs them the evening.
 *
 * Written for a performer, not a developer: no status codes, and each one ends
 * with what to do next.
 */
export function submitFailureMessage(err: unknown, opts: { hasPhoto?: boolean } = {}): string {
  if (err instanceof ServerNotConfiguredError) {
    return 'The service behind this link is not answering right now. Nothing you did caused this — wait a minute and try again, and tell whoever sent it if it keeps happening.';
  }

  const status = (err as ApiError)?.status;

  switch (status) {
    case 413:
      return opts.hasPhoto
        ? 'Even shrunk down, this was too large to send. Choose a smaller headshot and try again. A headshot is required, and your answers are still here.'
        : 'This is too large to send. Shorten the longest answer, then try again. Your answers are still here.';
    case 409:
      return 'This link has already been used, or it was withdrawn and replaced. Trying again will not change that — ask whoever sent it for a fresh link.';
    case 404:
      return 'This link is not there any more. It was withdrawn, or replaced with a newer one — ask whoever sent it for a fresh link.';
    case 400:
      return 'Something in this link is wrong, so the answers cannot be sent. Ask whoever sent it for a fresh link rather than retyping this one.';
    case 401:
    case 403:
      return 'This link is not allowed to send answers. Ask whoever sent it for a fresh link.';
    default:
      break;
  }

  if (typeof status === 'number' && status >= 500) {
    return 'The service behind this link had a problem. That is not your signal and not your fault — your answers are still here, so try again in a minute.';
  }

  // No status at all: the server never answered. Already retried several times
  // by the time anyone reads this, so say so rather than implying one tap.
  return 'Your connection dropped before this could be sent, and it has already been retried. Your answers are saved on this device — move somewhere with better signal and press the button again, or come back to this link later and it will still be filled in.';
}
