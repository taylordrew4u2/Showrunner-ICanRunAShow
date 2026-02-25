# Copilot Instructions for Showrunner

## Project Overview

Showrunner is a live-show organizer app. It exists as **two separate apps** sharing one repository and one `package.json`:

| App | Directory | Runtime | Storage |
|-----|-----------|---------|---------|
| Mobile (Expo / React Native) | `app/` | iOS · Android | `AsyncStorage` via `utils/storage.ts` |
| Web (Vite / React) | `src/` | Browser · Electron (macOS desktop) | `localStorage` via `src/utils/storage.ts` |

There is no backend and no authentication. All data lives entirely on the user's device.

---

## Repository Structure

```
app/              Expo Router screens (React Native)
  _layout.tsx     Root layout
  index.tsx       Home screen (shows list)
  settings.tsx    App settings
  show/           Per-show detail screens
components/       Shared React Native components
utils/            Shared mobile utilities (storage, types, id generation)

src/              Vite/React web app
  App.tsx         Root component
  components/     Web-only components
  types/          Shared TypeScript types (web)
  utils/          Web utilities (storage, id generation)

desktop/
  main.js         Electron main process (wraps the Vite web app)

public/           Static assets for the web app
scripts/          Helper scripts

app.json          Expo config (bundle ID: com.showrunner.app)
eas.json          Expo Application Services build profiles
vite.config.ts    Vite build config (PWA enabled)
electron-builder.yml  macOS DMG config
```

---

## Tech Stack

- **React Native / Expo SDK 54** – mobile app (`app/`)
- **Expo Router v4** – file-based navigation for the mobile app
- **React 19 + Vite 7** – web app (`src/`)
- **Electron 40** – wraps the Vite web build for macOS desktop
- **TypeScript ~5.3** – used throughout both apps
- **ESLint** – linting (`eslint .`)
- No CSS framework – plain CSS in `src/App.css` / `src/index.css`

---

## Development Commands

```bash
# Install dependencies (use --legacy-peer-deps if you hit peer conflicts)
npm install

# --- Mobile (Expo) ---
npm run start          # Interactive Expo menu
npm run android        # Android emulator / device
npm run ios            # iOS Simulator (requires Xcode on macOS)

# --- Web ---
npm run dev            # Vite dev server at http://localhost:5173
npm run build          # Production Vite build → dist/

# --- Desktop (Electron, macOS) ---
npm run mac            # Vite dev server + Electron window (live-reload)
npm run build:mac      # Vite build + electron-builder DMG → dist-electron/

# --- EAS cloud builds ---
npm run build:android  # Production AAB (Google Play)
npm run build:ios      # Production IPA (App Store)
npm run download:app   # Preview APK download link

# --- Quality ---
npm run lint           # ESLint
```

---

## Coding Conventions

- **TypeScript everywhere** – avoid `any`; prefer explicit types.
- **Functional components only** – no class components.
- **React hooks** – `useState`, `useEffect`, `useCallback`, `useMemo` as appropriate.
- **Mobile styles** – use `StyleSheet.create` (never inline style objects for React Native).
- **Web styles** – BEM-style CSS class names in `.css` files; no CSS-in-JS.
- **No shared UI components** between `app/` and `src/` – the two apps have separate component trees.
- **Storage helpers** – always go through the `storage.ts` utility, not raw `AsyncStorage` / `localStorage` calls.
- **IDs** – generate with the `generateId()` helper from `utils/`.
- **No new dependencies** without a strong reason – both runtimes share the same `package.json`.

---

## Key Architecture Notes

- The Expo entry point is `expo-router/entry` (set in `package.json` `"main"`).
- The Vite entry point is `index.html` → `src/main.tsx`.
- Electron loads `http://localhost:5173` in dev and `dist/index.html` in production.
- The `app/` and `src/` directories define **duplicate** type and utility modules because the two runtimes have different storage APIs. Keep them in sync when modifying shared data shapes.
- Brand name, producer names, and rules are user-configurable via the Settings screen and stored locally.
