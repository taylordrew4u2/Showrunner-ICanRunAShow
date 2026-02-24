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

## Run on Mac (Desktop App)

Showrunner ships with an Electron wrapper so it can run as a native macOS desktop window.

### Prerequisites

```bash
npm install
```

### Start in development mode

```bash
npm run mac
```

This starts the Vite web dev server and opens the app in an Electron window automatically.
Changes to source files are reflected live via hot module reload.

### Build macOS installer

```bash
npm run build:mac
```

This compiles the web app and packages it into a `.dmg` installer (and a `.zip` archive) inside the `dist-electron/` directory.

The build produces **arm64** (Apple Silicon) and **x64** (Intel) binaries. Apple Silicon users (M1/M2/M3 and later) should use the `arm64` DMG.

#### Gatekeeper note (unsigned builds)

Because these builds are not code-signed or notarized by Apple, macOS Gatekeeper will block the first launch.
To open an unsigned DMG:

1. Double-click the `.dmg` to mount it.
2. Drag **Showrunner.app** to your **Applications** folder.
3. In Finder, **right-click** Showrunner.app → **Open**.
4. Click **Open** in the Gatekeeper dialog.

You only need to do this once. After that, the app opens normally.

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
