import type { Show } from '../types';

const STORAGE_KEY = 'showrunner_shows';

export function loadShows(): Show[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Show[]) : [];
  } catch {
    return [];
  }
}

export function saveShows(shows: Show[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(shows));
}
