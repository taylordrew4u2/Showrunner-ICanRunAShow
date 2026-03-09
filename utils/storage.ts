import AsyncStorage from "@react-native-async-storage/async-storage";
import { Show, AppSettings, DEFAULT_SETTINGS } from "./types";

const SHOWS_KEY = "@showrunner_shows";
const SETTINGS_KEY = "@showrunner_settings";

// ─── ID Generation ────────────────────────────────────────────────────────────

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

// ─── Shows ────────────────────────────────────────────────────────────────────

export async function loadShows(): Promise<Show[]> {
  try {
    const data = await AsyncStorage.getItem(SHOWS_KEY);
    const shows = data ? JSON.parse(data) : [];
    // Ensure backward compatibility: add files array if missing
    return shows.map((show: Show) => ({
      ...show,
      files: show.files || [],
    }));
  } catch (error) {
    console.error("Error loading shows:", error);
    return [];
  }
}

export async function saveShows(shows: Show[]): Promise<void> {
  try {
    await AsyncStorage.setItem(SHOWS_KEY, JSON.stringify(shows));
  } catch (error) {
    console.error("Error saving shows:", error);
    throw error;
  }
}

export async function loadShow(id: string): Promise<Show | null> {
  try {
    const shows = await loadShows();
    return shows.find((s) => s.id === id) ?? null;
  } catch (error) {
    console.error("Error loading show:", error);
    return null;
  }
}

export async function saveShow(show: Show): Promise<void> {
  const shows = await loadShows();
  const index = shows.findIndex((s) => s.id === show.id);
  // Ensure files array always exists
  const safeShow = {
    ...show,
    files: show.files || [],
    updatedAt: new Date().toISOString(),
  };
  if (index >= 0) {
    shows[index] = safeShow;
  } else {
    shows.push(safeShow);
  }
  await saveShows(shows);
}

export async function deleteShow(id: string): Promise<void> {
  const shows = await loadShows();
  await saveShows(shows.filter((s) => s.id !== id));
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export async function loadSettings(): Promise<AppSettings> {
  try {
    const data = await AsyncStorage.getItem(SETTINGS_KEY);
    if (!data) return DEFAULT_SETTINGS;

    const settings = JSON.parse(data);

    // Migrate old format with producerNames string
    if (settings.producerNames && !settings.producers) {
      const names = settings.producerNames
        .split(",")
        .map((n: string) => n.trim())
        .filter(Boolean);
      settings.producers = names.map((name: string) => ({
        id: generateId(),
        name,
        role: "Producer",
      }));
      delete settings.producerNames;
    }

    // Ensure new fields exist
    if (!settings.producers) settings.producers = [];
    if (typeof settings.brandBudget !== "number") settings.brandBudget = 0;
    if (typeof settings.totalSpent !== "number") settings.totalSpent = 0;

    return { ...DEFAULT_SETTINGS, ...settings };
  } catch (error) {
    console.error("Error loading settings:", error);
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    console.error("Error saving settings:", error);
    throw error;
  }
}
