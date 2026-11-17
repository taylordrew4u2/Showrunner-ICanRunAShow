/**
 * The co-producer's open requests, laid over the screens they apply to.
 *
 * Each screen asks for the marks under its own place (a show, a section, a
 * row) and shows the proposed value in red beside what is there now, so a
 * co-producer sees what they asked for where they asked for it and does not
 * ask twice. Outside co-producer view there is no provider, and every lookup
 * finds nothing.
 */
import { createContext, useContext } from 'react';
import type { FieldChange } from './types';

/** One proposed change from one open request, as the screen it lands on shows it. */
export interface PendingMark {
  requestId: string;
  status: 'pending' | 'stale';
  createdAt: string;
  groupKey: string;
  change: FieldChange;
}

export interface PendingOverlayValue {
  /** Marks in a group; with `prefix`, only changes whose key is under it (paths.ts underPath). */
  marks(groupKey: string, prefix?: string): PendingMark[];
  /** Shows that open requests would create, for ghost cards. */
  newShows: { requestId: string; showId: string; name: string }[];
}

const NO_MARKS: PendingMark[] = [];

const EMPTY: PendingOverlayValue = {
  marks: () => NO_MARKS,
  newShows: [],
};

const PendingOverlayContext = createContext<PendingOverlayValue>(EMPTY);

export const PendingOverlayProvider = PendingOverlayContext.Provider;

/** [] outside co-producer view. */
// eslint-disable-next-line react-refresh/only-export-components
export function usePendingMarks(groupKey: string, prefix?: string): PendingMark[] {
  return useContext(PendingOverlayContext).marks(groupKey, prefix);
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePendingNewShows(): PendingOverlayValue['newShows'] {
  return useContext(PendingOverlayContext).newShows;
}
