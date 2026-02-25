import type { Show, AppSettings } from "../types";
import { DEFAULT_SETTINGS } from "../types";

const STORAGE_SHOWS_KEY = "showrunner_shows";
const STORAGE_SETTINGS_KEY = "showrunner_settings";

export function loadShows(): Show[] {
  try {
    const raw = localStorage.getItem(STORAGE_SHOWS_KEY);
    return raw ? (JSON.parse(raw) as Show[]) : [];
  } catch {
    return [];
  }
}

export function saveShows(shows: Show[]): void {
  localStorage.setItem(STORAGE_SHOWS_KEY, JSON.stringify(shows));
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_SETTINGS_KEY);
    return raw ? (JSON.parse(raw) as AppSettings) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(STORAGE_SETTINGS_KEY, JSON.stringify(settings));
}
