# Showrunner

Showrunner is an Expo app for organizing a live show.

## Just download the app

This project is configured to produce installable mobile binaries using Expo Application Services (EAS).

### 1) Install dependencies

```bash
npm install
```

### 2) Log in and initialize EAS project linkage

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
