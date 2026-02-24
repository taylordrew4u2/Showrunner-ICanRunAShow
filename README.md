# Showrunner

Showrunner is an Expo app for organizing a live show.

---

## Run on Mac (quickest path)

No Xcode, no EAS account, no Android device needed — just a browser.

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later recommended)
- npm (included with Node)

### Option A — one-liner helper script

```bash
bash scripts/run-mac.sh
```

The script checks for Node/npm, syncs dependencies, and opens the app in your browser.

### Option B — manual commands

```bash
npm install        # install dependencies (first time only)
npm run mac        # starts expo in web mode — opens in your browser
```

### Option C — iOS Simulator (requires Xcode)

If you have Xcode installed on your Mac you can run the native iOS build instead:

```bash
npm install
npm run ios
```

---

## Data & auth model

- No OAuth or account sign-in is required.
- All app data is stored locally on the device (or browser local storage on web).
- Data is not synced to a backend by this app.

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

`eas login` is only needed for developers creating cloud builds with Expo EAS.
End users installing the app do not sign in to use Showrunner.

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

## Run on Mac (desktop, no simulator)

Showrunner ships an Electron wrapper around the Vite web build so you can run it as a native macOS desktop app — **no iOS Simulator required**.

Data is persisted via the browser's `localStorage` inside the Electron window, stored in the app's sandboxed profile on your Mac.

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

## Local development

Start the Expo dev server (choose your target):

```bash
npm run start    # interactive menu — choose web, iOS, or Android
npm run mac      # web only (browser) — simplest on Mac
npm run ios      # iOS Simulator (requires Xcode on Mac)
npm run android  # Android emulator / device
```
