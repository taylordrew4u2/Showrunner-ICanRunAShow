/**
 * Color scheme handling. Each scheme overrides the CSS design tokens defined in
 * App.css via a `data-theme` attribute on <html>. The default ("crimson") is the
 * base `:root` palette, so it uses no attribute. The choice is stored in
 * localStorage so it applies instantly on every visit, even before sign-in.
 */
export type ColorScheme = 'crimson' | 'indigo' | 'teal' | 'light';

export const COLOR_SCHEMES: {
  id: ColorScheme;
  label: string;
  description: string;
  swatch: string; // accent color
  bg: string; // background color, for the swatch preview
}[] = [
  { id: 'crimson', label: 'Crimson', description: 'Dark · vivid red', swatch: '#f43f5e', bg: '#0c0e13' },
  { id: 'indigo', label: 'Indigo', description: 'Dark · electric indigo', swatch: '#6366f1', bg: '#0b0e14' },
  { id: 'teal', label: 'Teal', description: 'Dark · teal / emerald', swatch: '#14b8a6', bg: '#0a0f12' },
  { id: 'light', label: 'Light', description: 'Bright · red accent', swatch: '#e11d48', bg: '#f5f6f8' },
];

const STORAGE_KEY = 'showrunner:theme';

function isColorScheme(value: unknown): value is ColorScheme {
  return value === 'crimson' || value === 'indigo' || value === 'teal' || value === 'light';
}

export function loadColorScheme(): ColorScheme {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (isColorScheme(value)) return value;
  } catch {
    /* ignore */
  }
  return 'crimson';
}

export function applyColorScheme(scheme: ColorScheme): void {
  const root = document.documentElement;
  // Crimson is the base :root palette — no attribute needed.
  if (scheme === 'crimson') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', scheme);
  }
  try {
    localStorage.setItem(STORAGE_KEY, scheme);
  } catch {
    /* ignore */
  }
}
