import type { ApiError } from './api';

/**
 * What a producer is told when their links hold all the storage an account
 * may keep under them (api/_lib/linkStorage.ts).
 *
 * Its own words rather than "check your connection": sending again cannot
 * fit, and only the producer can make room. Withdrawing a contract or turning
 * a show's viewer audio off gives the space back.
 */
export const LINK_STORAGE_FULL_MESSAGE =
  "You've reached the storage limit for links — withdraw old contracts or viewer links to free space.";

/** Whether a failed upload was refused because the account's links are full. */
export function isLinkStorageFull(err: unknown): boolean {
  return (err as ApiError | null | undefined)?.code === 'link_storage_full';
}
