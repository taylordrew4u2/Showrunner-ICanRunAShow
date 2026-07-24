# iOS App (Capacitor)

The repo ships with a native iOS wrapper built with [Capacitor](https://capacitorjs.com).
The Xcode project lives in `ios/App` and wraps the app in a real iOS shell you can
run on a simulator, install on your iPhone, or submit to the App Store.

## How it's set up

- **The shell loads the live site.** `capacitor.config.ts` points the native
  webview at `https://icanrunashow.com`. Every `/api` call stays same-origin
  (the API has no CORS headers, so bundled-asset builds would be blocked), and
  web deploys reach the iOS app instantly — no App Store release needed for
  web-side changes.
- **Swift Package Manager, no CocoaPods.** The project was scaffolded with
  `--packagemanager SPM`, so Xcode resolves Capacitor automatically on first
  open. You don't need to install CocoaPods or run `pod install`.
- The app icon in `ios/App/App/Assets.xcassets` is generated from
  `public/icons/icon-512x512.png`.

## Opening the project in Xcode

You need a Mac with [Xcode](https://apps.apple.com/app/xcode/id497799835) and
Node 20+.

```bash
git clone https://github.com/taylordrew4u2/Showrunner-ICanRunAShow.git
cd Showrunner-ICanRunAShow
npm install
npm run ios:sync   # builds the web app and syncs it into ios/App
npm run ios:open   # opens the project in Xcode
```

(`npm run ios:open` is equivalent to opening `ios/App/App.xcodeproj` manually.)

## Running it

1. In Xcode, select the **App** target → **Signing & Capabilities** and pick
   your Apple ID team (a free account works for running on your own device).
2. Choose a simulator or your plugged-in iPhone from the device picker.
3. Press **Run** (⌘R).

## App Store notes

- The bundle id is `com.icanrunashow.app` (change it under Signing &
  Capabilities if you need a different one).
- Archive with **Product → Archive**, then distribute via App Store Connect.
- Because the shell loads the website, review guideline 4.2 (minimum
  functionality) can apply. If Apple pushes back, the fallback is to bundle
  the web assets in the app: remove the `server.url` block from
  `capacitor.config.ts`, add CORS headers (including `OPTIONS` preflight
  handling for the `x-user-id`/`x-auth` headers) to the routes in `api/`, and
  point API calls at the deployment with an absolute base URL.

## Day-to-day workflow

Native-side files (icons, splash screen, Info.plist, entitlements) are edited
in Xcode and committed like any other code. Web-side changes need nothing —
the app picks them up from the live site. After upgrading Capacitor packages,
re-run `npm run ios:sync`.
