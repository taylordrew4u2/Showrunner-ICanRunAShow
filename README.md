# Showrunner

Showrunner is an Expo app for organizing a live show.

## Build downloadable apps

This project is configured to produce installable mobile binaries using Expo Application Services (EAS).

### 1) Install dependencies and EAS CLI

```bash
npm install
npm install -g eas-cli
```

### 2) Log in and initialize EAS project linkage

```bash
eas login
eas init
```

### 3) Build Android APK (download and sideload)

```bash
npm run build:android:preview
```

When the build finishes, EAS gives you a URL to download the APK directly.

### 4) Build production binaries

Android (store-ready AAB):

```bash
npm run build:android
```

iOS (App Store/TestFlight):

```bash
npm run build:ios
```

## iOS release flow (TestFlight/App Store)

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

- `preview` profile creates a downloadable Android APK for direct install.
- `production` profile is intended for app store submission.
- Bundle/package IDs are set to `com.showrunner.app` in app config.

## Local development

```bash
npm run start
```
