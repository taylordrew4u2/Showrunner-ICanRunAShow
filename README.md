# Showrunner

Showrunner is an Expo app for organizing a live show.

## Data & auth model

- No OAuth or account sign-in is required.
- All app data is stored locally on the device (or browser local storage on web).
- Data is not synced to a backend by this app.

## Download the app (users)

Go to the [Releases](../../releases) page on GitHub, find the latest release, and download **showrunner.apk**. Install it on your Android device — no account or build tools needed.

> **iOS:** Apple does not allow direct APK-style installs. iOS builds are distributed via TestFlight. See the developer section below for details.

---

## Run as a Mac Desktop App

Showrunner includes an Electron wrapper around its web build, giving you a true desktop app experience on macOS.

### Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- npm (comes with Node.js)

### Development (live-reload)

```bash
npm install
npm run mac
```

This command starts the Vite web dev server and opens the app in an Electron desktop window. The app reloads automatically when you make changes to the source in `src/`.

> **Note:** `npm run mac` starts both the Vite dev server and Electron in parallel. Electron waits for the dev server to be ready before opening the window.

### Production build

```bash
npm install
npm run build:mac
```

This exports a static web build to `dist/` and then packages it with Electron into a macOS `.app` (and `.dmg` / `.zip` archives). Output is written to the `release/` folder.

Open the resulting `.app` from Finder or run:
```bash
open release/mac*/Showrunner.app
```

### Architecture

- The desktop app is an **Electron wrapper** around the Vite/React web build located in `src/`.
- The Electron main process lives in `electron/main.js`.
- In development, Electron loads `http://localhost:5173` (the Vite dev server).
- In production, Electron loads the static build from `dist/index.html` bundled inside the `.app`.

### Persistence

App data (shows and settings) is stored in Electron's Chromium `localStorage` which persists between sessions. On macOS, this data lives in:

```
~/Library/Application Support/Showrunner/
```

To **back up** your data: copy the above directory to a safe location.

To **reset** your data: delete the above directory (or clear localStorage via DevTools).

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

## Local development

```bash
npm run start
```
