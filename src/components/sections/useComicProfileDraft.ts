import { useEffect, useRef, useState } from 'react';
import type { Performer } from '../../types';

const fields = [
  'name', 'socialMedia', 'email', 'phone', 'notes', 'credits',
  'walkOnMusicName', 'walkOnMusicArtist', 'walkOnMusicTimestamp', 'walkOnMusicLink',
] as const;
type Field = typeof fields[number];
type Profile = Pick<Performer, 'id' | Field>;

/** Keep only edits locally, so other fields follow the shared comic immediately. */
export function useComicProfileDraft<T extends Profile>(profile: T, onChange: (updated: T) => void) {
  const latest = useRef(profile);
  const change = useRef(onChange);
  useEffect(() => {
    latest.current = profile;
    change.current = onChange;
  }, [profile, onChange]);
  const [edits, setEdits] = useState<{ id: string; values: Partial<Record<Field, string>> }>({
    id: profile.id, values: {},
  });
  const values = edits.id === profile.id ? edits.values : {};
  const draft = Object.fromEntries(fields.map(field => [field, values[field] ?? profile[field] ?? ''])) as Record<Field, string>;

  function setField(field: Field, value: string) {
    setEdits(previous => {
      const next = previous.id === profile.id ? { ...previous.values } : {};
      if (value === (profile[field] ?? '')) delete next[field];
      else next[field] = value;
      return { id: profile.id, values: next };
    });
  }

  function update(patch: Partial<T>) {
    // An upload started for a different open profile must never attach here.
    if (latest.current.id !== profile.id) return latest.current;
    const updated = { ...latest.current, ...patch };
    latest.current = updated;
    change.current(updated);
    return updated;
  }

  /**
   * Write the edits through. `finish` sees the whole profile as it is about
   * to be saved and may reshape it — one write, so nothing downstream ever
   * sees the edits without the reshaping.
   */
  function save(finish?: (next: T) => T) {
    const patch = Object.fromEntries(Object.entries(values).map(([field, value]) => [
      field, value?.trim() || (field === 'name' ? latest.current.name : undefined),
    ])) as Partial<T>;
    const updated = update(finish ? finish({ ...latest.current, ...patch }) : patch);
    setEdits({ id: profile.id, values: {} });
    return updated;
  }

  return { draft, setField, dirty: Object.keys(values).length > 0, save, update };
}
