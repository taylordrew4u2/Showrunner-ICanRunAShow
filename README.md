# Showrunner

Showrunner is an Expo app for organizing a live show.

## Run on Mac (Desktop App)

Showrunner includes an **Electron wrapper** that lets you run the app as a native macOS desktop application — no iOS simulator or mobile device required.

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later) and npm

### 1) Install dependencies

```bash
npm install
```

### 2) Run the desktop app (development)

```bash
npm run mac
```

This starts the Vite web dev server and opens the app in an Electron window. Live reload is enabled — edits to `src/` are reflected immediately.

### 3) Build a distributable `.app`

```bash
npm run build:mac
```

This builds the web assets with Vite and packages them into a macOS desktop app using [electron-builder](https://www.electron.build/). The built artifact is placed in the `release/` directory:

- **`release/Showrunner-<version>.dmg`** — drag-and-drop installer
- **`release/mac/Showrunner.app`** — standalone `.app` bundle

### Data persistence

All show data is stored in Electron's built-in `localStorage` (same API as the browser). On macOS this lives inside Electron's app profile folder:

```
~/Library/Application Support/Showrunner/
```

To reset app data, quit the app and delete the `Local Storage/` subfolder in that directory.

> **Note:** This is a desktop wrapper around the Vite/React web build in `src/`. The Expo mobile app (`app/`) is a separate entry point for iOS/Android.

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

## Local development

```bash
npm run start
```
