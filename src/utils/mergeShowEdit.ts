import type { Show } from '../types';

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((value, index) => sameValue(value, right[index]));
  }
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].every(key => sameValue(a[key], b[key]));
}

/** Merge flat row fields and explicit list operations from their source snapshot. */
function mergeRows<T extends { id: string }>(baseline: T[], incoming: T[], current: T[]): T[] {
  const beforeById = new Map(baseline.map(person => [person.id, person]));
  const incomingById = new Map(incoming.map(person => [person.id, person]));
  const currentIds = new Set(current.map(person => person.id));
  let merged = current.flatMap(person => {
    const before = beforeById.get(person.id);
    const edited = incomingById.get(person.id);
    if (before && !edited) return [];
    if (!before || !edited) return [person];
    let result = person;
    const keys = new Set([...Object.keys(before), ...Object.keys(edited)] as (keyof T)[]);
    for (const key of keys) {
      if (key === 'id' || sameValue(before[key], edited[key]) || sameValue(person[key], edited[key])) continue;
      if (result === person) result = { ...person };
      result[key] = edited[key];
    }
    return [result];
  });

  // Reorder only slots the editor knew; concurrent slots keep their positions.
  const byId = new Map(merged.map(person => [person.id, person]));
  const baselineOrder = baseline.filter(person => byId.has(person.id) && incomingById.has(person.id)).map(person => person.id);
  const editedOrder = incoming.filter(person => byId.has(person.id) && beforeById.has(person.id)).map(person => person.id);
  if (!sameValue(baselineOrder, editedOrder)) {
    const reorderIds = new Set(editedOrder);
    let index = 0;
    merged = merged.map(person => reorderIds.has(person.id) ? byId.get(editedOrder[index++])! : person);
  }

  for (let index = 0; index < incoming.length; index++) {
    const person = incoming[index];
    // A deleted slot cannot return through a stale upload callback.
    if (beforeById.has(person.id) || currentIds.has(person.id) || merged.some(row => row.id === person.id)) continue;
    const prior = incoming.slice(0, index).reverse().find(row => merged.some(item => item.id === row.id));
    const following = incoming.slice(index + 1).find(row => merged.some(item => item.id === row.id));
    const insertAt = prior ? merged.findIndex(row => row.id === prior.id) + 1
      : following ? merged.findIndex(row => row.id === following.id) : merged.length;
    merged.splice(insertAt, 0, person);
  }

  return merged.length === current.length && merged.every((person, index) => person === current[index]) ? current : merged;
}

/** Apply one show's edited fields while retaining changes made since the editor rendered. */
export function mergeShowEdit(baseline: Show, incoming: Show, current: Show): Show {
  let merged = current;
  const keys = new Set([...Object.keys(baseline), ...Object.keys(incoming)] as (keyof Show)[]);
  for (const key of keys) {
    if (key === 'id' || key === 'performers' || key === 'artists' || key === 'schedule' || sameValue(baseline[key], incoming[key])) continue;
    if (sameValue(current[key], incoming[key])) continue;
    merged = { ...merged, [key]: incoming[key] };
  }
  const performers = mergeRows(baseline.performers, incoming.performers, current.performers);
  const artists = mergeRows(baseline.artists, incoming.artists, current.artists);
  let schedule = mergeRows(baseline.schedule, incoming.schedule, current.schedule);
  const baselinePeople = new Map([...baseline.performers, ...baseline.artists].map(person => [person.id, person]));
  const renames = new Map<string, { before: string; after: string }>();
  for (const person of [...incoming.performers, ...incoming.artists]) {
    const before = baselinePeople.get(person.id);
    if (before && before.name !== person.name) renames.set(person.id, { before: before.name, after: person.name });
  }
  let renamedCue = false;
  const renamedSchedule = schedule.map(cue => {
    const rename = cue.performerId ? renames.get(cue.performerId) : undefined;
    if (!rename || cue.performer !== rename.before) return cue;
    renamedCue = true;
    return { ...cue, performer: rename.after };
  });
  if (renamedCue) schedule = renamedSchedule;
  if (performers !== current.performers || artists !== current.artists || schedule !== current.schedule) {
    merged = { ...merged, performers, artists, schedule };
  }
  return merged;
}
