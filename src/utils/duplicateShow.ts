import type { Show } from '../types';
import { generateId } from './id';
import { rolodexKey } from './rolodex';
import { withoutRemovedWalkOns } from './walkOnSongs';

/** A new night keeps the show setup, but its cast must be booked separately. */
export function duplicateShow(original: Show, options: { name?: string; date?: string } = {}): Show {
  const now = new Date().toISOString();
  // A show is plain JSON, saved and loaded as JSON, so this copies all of
  // it. structuredClone would too, but iOS 15.0 to 15.3 do not have it.
  const copy = JSON.parse(JSON.stringify(original)) as Show;
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
    // The host's handover the generator writes, "Intro — <act>", is the
    // host's cue, so unlinking left it naming last night's act on the new
    // night, a surprise guest included, where the viewer would show it. The
    // handover stays, with its prefix; only the name goes. A line the
    // producer wrote around a name is theirs and left as it is.
    const intro = cue.description?.match(/^Intro — (.+)$/);
    if (intro && castNames.has(rolodexKey(intro[1]))) {
      cue.description = 'Intro — next act';
      clearedAssignment = true;
    }
  }
  if (copy.completions) {
    copy.completions.performers = false;
    copy.completions.artists = false;
    if (clearedAssignment) copy.completions.schedule = false;
  }
  // Scene progress and ticked to-dos belong to the night they were done on;
  // carried over, a new card shows a full progress bar before anyone has
  // planned it. `undefined` stays undefined so an unused section stays hidden.
  for (const scene of copy.scenes ?? []) scene.status = 'planned';
  for (const todo of copy.todos ?? []) todo.completed = false;
  return {
    ...copy,
    performers: [],
    artists: [],
    // The walk-on rows the old cast put on the DJ list. Emptying the bill here
    // skips the cleanup that runs when an act leaves it, so the DJ was handed
    // songs for acts who were not on. A row with audio on it stays, as it
    // does there.
    djSongs: withoutRemovedWalkOns(copy.djSongs ?? [], [...original.performers, ...original.artists], []),
    id: generateId(),
    name: options.name ?? `${original.name} (copy)`,
    status: 'upcoming',
    createdAt: now,
    updatedAt: now,
    // A repeat knows its date; a plain duplicate does not, and an empty date
    // is the app's prompt to pick one.
    date: options.date ?? '',
    viewToken: undefined,
    viewerKey: undefined,
    viewNote: undefined,
    recap: undefined,
    // A copy of the sample is someone turning the demo into a real night.
    sample: undefined,
  };
}
