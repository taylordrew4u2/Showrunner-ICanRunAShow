# Showrunner

Showrunner is a live-show organizer app available on mobile (iOS & Android), web, and desktop (macOS).

## Tech stack

- **Mobile:** React Native with Expo SDK 54 + Expo Router v4
- **Web:** React 19 + Vite 7 + PWA support
- **Desktop:** Electron 40 (wraps Vite web build for macOS)
- **Database:** Turso (libSQL) with end-to-end encryption
- **Language:** TypeScript throughout

## Features

- 📅 **Schedule management** – Plan show timelines and segments
- 🎤 **Artist & performer tracking** – Manage cast and crew details
- 🎵 **DJ & music coordination** – Track songs and music cues
- 👥 **Staff & host assignments** – Organize your production team
- 💰 **Expense tracking** – Monitor show budgets
- 📄 **PDF export** – Generate professional show documents
- 🔒 **Secure & private** – End-to-end encryption for all your data
- 🔄 **Multi-device sync** – Access your shows from anywhere

## Quick start

1. **Try the web app:** Visit [your-deployment-url] (no installation needed)
2. **Get the mobile app:** Download from [Releases](../../releases) or App Store/TestFlight
3. **Run on Mac:** Download the `.dmg` from [Releases](../../releases)
4. **For developers:** Clone this repo and run `npm install` then `npm run dev`

---

## Web app

Access Showrunner online at **[your-deployment-url]** — no installation required.

The web app runs in any modern browser with full feature parity to the mobile apps. All data is synced through your account.

---

## Run on Mac (desktop, no simulator)

Showrunner ships an Electron wrapper around the Vite web build so you can run it as a native macOS desktop app — **no iOS Simulator required**.

Data is synced through your account to the cloud database, just like the web and mobile apps.

### Prerequisites

```bash
npm install
```

### Start in development mode (live-reload)

```bash
npm run mac
```

This command starts the Vite dev server and opens a native macOS window pointing at `http://localhost:5173`. Changes to `src/` are reflected instantly.

### Build a distributable `.app` / `.dmg`

```bash
npm run build:mac
```

This command:

1. Compiles the web app to `dist/` via Vite.
2. Packages it into a macOS `.dmg` (universal: x64 + arm64) using electron-builder.

The output is written to `dist-electron/`. Open the `.dmg` to install **Showrunner.app** to your Applications folder.

---

## Data & auth model

- **Authentication:** Password-based account system (no OAuth).
- **Storage:** All data is encrypted and stored in a Turso database (libSQL).
- **Security:** End-to-end encryption ensures your show data is private.
- **Sync:** Data syncs across all your devices when you sign in.

## Download the app (users)

Go to the [Releases](../../releases) page on GitHub, find the latest release, and download **showrunner.apk**. Install it on your Android device — no account or build tools needed.

> **iOS:** Apple does not allow direct APK-style installs. iOS builds are distributed via TestFlight. See the developer section below for details.

---

## Build it yourself (developers)

This project is configured to produce installable mobile binaries using Expo Application Services (EAS).

### 1) Install dependencies

```bash
npm install
```

### 2) Initialize EAS project linkage (developer build step only)

`eas login` is only needed for **developers** creating cloud builds with Expo EAS.

**End users** sign in with their Showrunner account credentials after installing the app.

```bash
eas login
eas init
```

### 3) Downloadable app build (fastest)

```bash
npm run download:app
```

When the build finishes, EAS gives you a URL to download the APK directly.

You can also run this explicitly:

```bash
npm run download:android
```

### 4) Build production binaries

Android (store-ready AAB):

```bash
npm run build:android
```

iOS (App Store/TestFlight):

```bash
npm run build:ios
```

## iOS download

Apple does not allow direct public IPA download like Android APK.
Use TestFlight distribution (or internal ad hoc for registered devices).

Create iOS internal install build:

```bash
npm run download:ios
```

For public user download on iPhone, submit and share TestFlight:

```bash
npm run build:ios:submit
```

## iOS App Store flow

Build and auto-submit in one command:

```bash
npm run build:ios:submit
```

Or submit the latest completed iOS build manually:

```bash
npm run submit:ios
```

After submission completes, manage testers and releases in App Store Connect.

### Notes

- `download:app` and `preview` use a downloadable Android APK for direct install.
- `production` profile is intended for app store submission.
- Bundle/package IDs are set to `com.showrunner.app` in app config.

## Local development

### Mobile (Expo)

Start the Expo dev server (choose your target):

```bash
npm run start    # interactive menu — choose web, iOS, or Android
npm run ios      # iOS Simulator (requires Xcode on Mac)
npm run android  # Android emulator / device
```

### Web (Vite)

Start the Vite web development server:

```bash
npm run dev      # Opens at http://localhost:5173
```

### Desktop (Electron + Vite)

Start the macOS desktop app with live-reload:

```bash
npm run mac      # Vite dev + Electron window
```

### Environment variables

Create a `.env` file in the project root:

```env
VITE_TURSO_DATABASE_URL=your_turso_database_url
VITE_TURSO_AUTH_TOKEN=your_turso_auth_token
```

> **⚠️ Security Note:** Never commit your `.env` file or hardcode credentials in source files. The database credentials in `src/utils/db.ts` should be replaced with environment variables in production.

## Build for production

### Web

```bash
npm run build    # Output: dist/
```

Deploy the `dist/` folder to Vercel, Netlify, or any static hosting service.

---

## Project structure

```text
app/              Mobile app (Expo + React Native)
  _layout.tsx     Root navigation layout
  index.tsx       Home screen (show list)
  settings.tsx    App settings
  show/[id].tsx   Show detail screen

src/              Web app (Vite + React)
  App.tsx         Root component
  components/     Web UI components
  utils/          Web utilities (db, encryption, storage)
  
components/       Shared mobile components
utils/            Shared mobile utilities

desktop/
  main.js         Electron main process

public/           Static web assets
scripts/          Build and deployment scripts
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

[Add your license here]
