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
  { id: 'dark', label: 'Dark', description: 'Control room', swatch: '#f5a623', bg: '#0b0d12' },
  { id: 'light', label: 'Light', description: 'Playbill', swatch: '#9a6400', bg: '#f6f4ef' },
];

/** The browser/PWA chrome color for each scheme (matches --bg). */
const THEME_COLORS: Record<ColorScheme, string> = {
  dark: '#0b0d12',
  light: '#f6f4ef',
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
  // Default to the signature Dark "control room" look until the user changes it.
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
