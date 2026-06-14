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
  { id: 'light', label: 'Light', description: 'Bright, minimal', swatch: '#c84d5e', bg: '#f7f8fa' },
  { id: 'dark', label: 'Dark', description: 'Dim, minimal', swatch: '#dd7280', bg: '#0e1116' },
];

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
  // Default to Light until the user picks something else.
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
  if (!persist) return;
  try {
    localStorage.setItem(STORAGE_KEY, scheme);
  } catch {
    /* ignore */
  }
}
