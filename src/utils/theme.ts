/**
 * Color scheme handling. The app ships a minimal pair — Light (the base :root
 * palette) and Dark (a `data-theme="dark"` override). The choice is stored in
 * localStorage so it applies instantly on every visit, even before sign-in.
 */
export type ColorScheme = 'light' | 'dark';

export const COLOR_SCHEMES: {
  id: ColorScheme;
  label: string;
  description: string;
  swatch: string; // accent color
  bg: string; // background color, for the swatch preview
}[] = [
  { id: 'light', label: 'Light', description: 'Default', swatch: '#dc2626', bg: '#f5f5f5' },
  { id: 'dark', label: 'Dark', description: 'Dark', swatch: '#dc2626', bg: '#111111' },
];

/** The browser/PWA chrome color for each scheme (matches --bg). */
const THEME_COLORS: Record<ColorScheme, string> = {
  light: '#f5f5f5',
  dark: '#111111',
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
  return 'light';
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
