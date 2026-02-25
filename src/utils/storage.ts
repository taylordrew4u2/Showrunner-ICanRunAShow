import type { Show, AppSettings } from "../types";
import { DEFAULT_SETTINGS } from "../types";

const SHOWS_KEY = "showrunner_shows";
const SETTINGS_KEY = "showrunner_settings";

// ─── Shows ────────────────────────────────────────────────────────────────────

export function loadShows(): Show[] {
  try {
    const raw = localStorage.getItem(SHOWS_KEY);
    return raw ? (JSON.parse(raw) as Show[]) : [];
  } catch {
    return [];
  }
}

export function saveShows(shows: Show[]): void {
  localStorage.setItem(SHOWS_KEY, JSON.stringify(shows));
}

export function loadShow(id: string): Show | null {
  const shows = loadShows();
  return shows.find((s) => s.id === id) ?? null;
}

export function saveShow(show: Show): void {
  const shows = loadShows();
  const idx = shows.findIndex((s) => s.id === show.id);
  const updated = { ...show, updatedAt: new Date().toISOString() };
  if (idx >= 0) {
    shows[idx] = updated;
  } else {
    shows.unshift(updated);
  }
  saveShows(shows);
}

export function deleteShow(id: string): void {
  saveShows(loadShows().filter((s) => s.id !== id));
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
