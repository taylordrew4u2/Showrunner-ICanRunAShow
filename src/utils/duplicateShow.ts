import type { Show } from '../types';
import { generateId } from './id';
import { rolodexKey } from './rolodex';

/** A new night keeps the show setup, but its cast must be booked separately. */
export function duplicateShow(original: Show, options: { name?: string; date?: string } = {}): Show {
  const now = new Date().toISOString();
  const copy = structuredClone(original);
  const castNames = new Set([...original.performers, ...original.artists]
    .map((person) => rolodexKey(person.name)).filter(Boolean));
  let clearedAssignment = false;
  for (const cue of copy.schedule) {
    // Retain cue timing and structure, but never link an empty new bill back
    // to the original cast. Free-text imports have names without IDs.
    if (cue.performerId || (cue.performer && castNames.has(rolodexKey(cue.performer)))) {
      delete cue.performerId;
      delete cue.performer;
      clearedAssignment = true;
    }
  }
  if (copy.completions) {
    copy.completions.performers = false;
    copy.completions.artists = false;
    if (clearedAssignment) copy.completions.schedule = false;
  }
  return {
    ...copy,
    performers: [],
    artists: [],
    id: generateId(),
    name: options.name ?? `${original.name} (copy)`,
    status: 'upcoming',
    createdAt: now,
    updatedAt: now,
    // A repeat knows its date; a plain duplicate does not, and an empty date
    // is the app's prompt to pick one.
    date: options.date ?? '',
    viewToken: undefined,
    viewNote: undefined,
    recap: undefined,
  };
}
