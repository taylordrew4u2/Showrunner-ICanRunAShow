/**
 * Color scheme handling. The app ships a minimal pair — Dark (the default, via
 * a `data-theme="dark"` override) and Light (the base :root palette). The
 * choice is stored in localStorage so it applies instantly on every visit,
 * even before sign-in.
 */
export type ColorScheme = 'light' | 'dark';

export const COLOR_SCHEMES: {
  id: ColorScheme;
  label: string;
  description: string;
  swatch: string; // accent color
  bg: string; // background color, for the swatch preview
}[] = [
  { id: 'dark', label: 'Dark', description: 'Default', swatch: '#e5194b', bg: '#0a0a0b' },
  { id: 'light', label: 'Light', description: 'For bright rooms', swatch: '#e5194b', bg: '#f5f5f5' },
];

/** The browser/PWA chrome color for each scheme (matches --bg). */
const THEME_COLORS: Record<ColorScheme, string> = {
  light: '#f5f5f5',
  dark: '#0a0a0b',
};

const STORAGE_KEY = 'showrunner:theme';

function isColorScheme(value: unknown): value is ColorScheme {
  return value === 'light' || value === 'dark';
}

export function loadColorScheme(): ColorScheme {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (isColorScheme(value)) return value;
  } catch {
    /* ignore */
  }
  // Dark is the app's own look, and it's what you want in a venue. Light is
  // still a tap away in Settings for anyone working in a bright room.
  return 'dark';
}

export function applyColorScheme(scheme: ColorScheme, persist = true): void {
  const root = document.documentElement;
  // Light is the base :root palette — no attribute needed.
  if (scheme === 'dark') {
    root.setAttribute('data-theme', 'dark');
  } else {
    root.removeAttribute('data-theme');
  }
  // Keep the browser/PWA chrome (status bar, address bar) in step with the theme.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLORS[scheme]);
  if (!persist) return;
  try {
    localStorage.setItem(STORAGE_KEY, scheme);
  } catch {
    /* ignore */
  }
}
