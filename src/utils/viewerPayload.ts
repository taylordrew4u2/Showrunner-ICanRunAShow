import type { Show } from '../types';
import { publicLineup, type LiveViewPayload } from './liveView';
import { showStartISO } from './showDate';
import { loadColorScheme } from './theme';

/**
 * What the room's screen shows before a show starts: its name, when it
 * starts, the producer's note, the colour scheme and the billed lineup in
 * list order (surprise guests left off, see publicLineup).
 *
 * The show page publishes this whenever its viewer link is made or its
 * details change, and an approved co-producer request for a viewer link
 * publishes the same thing from the owner's app, so the two can never drift
 * into describing the same show differently.
 */
export function scheduledViewerPayload(show: Show, note: string | undefined): LiveViewPayload {
  return {
    showName: show.name,
    status: 'scheduled',
    startsAt: showStartISO(show.date, show.time),
    note: note?.trim() || undefined,
    theme: loadColorScheme(),
    lineup: publicLineup(show.performers),
    lastUpdateMs: Date.now(),
  };
}
