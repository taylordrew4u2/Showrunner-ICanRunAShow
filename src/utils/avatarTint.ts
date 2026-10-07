import type { CSSProperties } from 'react';

// A hue of its own for each person's letter avatar, so a lineup without
// headshots reads as a row of people rather than one badge repeated. Keyed off
// the name, so the same comic keeps the same colour on every screen and every
// device; polish.css turns the hue into a background and a letter colour that
// suit the theme.
export function avatarHue(name: string): number {
  let h = 0;
  for (const ch of name.trim().toLowerCase()) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return h % 360;
}

export function avatarTint(name: string): CSSProperties {
  return { '--avatar-hue': avatarHue(name) } as CSSProperties;
}
