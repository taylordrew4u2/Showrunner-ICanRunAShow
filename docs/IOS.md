# iOS App (Capacitor)

The repo ships with a native iOS wrapper built with [Capacitor](https://capacitorjs.com).
The Xcode project lives in `ios/App` and wraps the app in a real iOS shell you can
run on a simulator, install on your iPhone, or submit to the App Store.

## How it's set up

- **The shell loads the live site.** `capacitor.config.ts` points the native
  webview at `https://icanrunashow.com`. Every `/api` call stays same-origin
  (the API has no CORS headers, so bundled-asset builds would be blocked), and
  web deploys reach the iOS app without an App Store release.
- **It works offline after one online launch.** The site's service worker
  runs in the shell because the domain is app-bound (see
  [Offline mode](#offline-mode)), so the app opens from its cache with no
  signal. Like the installed web app, a deploy downloads in the background and
  the app offers a reload; it never reloads itself mid-show.
- **`window.open` does not work in the shell.** Capacitor's WKWebView
  delegate hands every `window.open` URL to the system and returns `nil`, so
  `window.open("", "_blank")` gives the page `null` instead of a new tab.
  Anything that needs a second window has to fall back to a same-document
  route or it silently does nothing in the App Store build. The print/PDF
  exports do: `openPrintable` in `src/utils/pdfExport.ts` prints from a hidden
  iframe when `window.open` gives it nothing. Reuse it rather than calling
  `window.open` again.
- **Swift Package Manager, no CocoaPods.** The project was scaffolded with
  `--packagemanager SPM`, so Xcode resolves Capacitor automatically on first
  open. You don't need to install CocoaPods or run `pod install`.
- The app icon in `ios/App/App/Assets.xcassets` is generated from
  `public/icons/icon-512x512.png`.

## Offline mode

WKWebView only gives a page `navigator.serviceWorker` when the page's domain
is listed in the app's `WKAppBoundDomains` and the webview is created with
`limitsNavigationsToAppBoundDomains`. Without both, the Workbox worker that
`src/main.tsx` registers never runs in the shell, nothing is precached, and a
launch with no signal shows nothing. Three settings make it work:

- **`WKAppBoundDomains` in `ios/App/App/Info.plist`** lists
  `icanrunashow.com` and `localhost`. WebKit matches entries by registrable
  domain, so `icanrunashow.com` covers `www.` too (which redirects to the apex
  anyway). `localhost` is the shell's own origin, `capacitor://localhost`,
  where the offline page is served; Capacitor's docs ask for it whenever the
  limit is on. iOS reads at most ten entries.
- **`ios.limitsNavigationsToAppBoundDomains: true`** in
  `capacitor.config.ts`.
- **`server.errorPath: 'offline.html'`** in `capacitor.config.ts`. When a
  page load fails, Capacitor shows this page from the app bundle instead of a
  blank webview. Its source is `public/offline.html`, so Vite copies it to
  `dist` and `npm run ios:sync` copies it into the app. It explains that the
  app has to open once with a connection, and goes back to the live site when
  Retry is tapped or when the connection returns. It must use only files in
  the bundle: nothing on it may come from the network. Capacitor shows it
  after any failed page load, including one cancelled because another started,
  so it can occasionally appear with a connection; Retry recovers.

`ios/App/App/capacitor.config.json` is generated from `capacitor.config.ts`
and gitignored, so a change to the TypeScript config reaches the app only
after `npm run ios:sync`.

### Links to other domains

The limit does not trap links. Capacitor's navigation delegate
(`WebViewDelegationHandler` in `@capacitor/ios`) decides first: any top-level
navigation that isn't under `server.url` or `capacitor://localhost` is handed
to iOS with `UIApplication.open` and cancelled in the webview. WebKit applies
the app-bound check only to navigations the delegate lets through. So
`mailto:` links, `target="_blank"` links (performer videos, socials) and any
`window.location.assign` to another site open in Safari or Mail exactly as
before, and the tour, guides, privacy and terms pages stay in the app.
Requests that aren't navigations — `/api` calls, `fetch`, scripts and images —
are not affected.

What the limit does block is a page load the shell allows to a domain that
isn't app-bound. There is none today, but if you ever add
`server.allowNavigation` entries, put each domain in `WKAppBoundDomains` too;
otherwise WebKit refuses the load and Capacitor shows the offline page.

### Testing offline on a device

Run these on a real iPhone; the simulator shares the Mac's network.

1. `npm run ios:sync`, then delete any earlier build of the app from the
   phone so it starts with no cache, and **Run** from Xcode.
2. **First launch, online.** Sign in and open a show. In a debug build, Safari
   → Develop → your iPhone → the app's page shows
   `navigator.serviceWorker.controller` as non-null, and Storage → Cache
   Storage has a `workbox-precache` entry. Give it a few seconds on a slow
   connection; the precache downloads in the background.
3. **Relaunch in Airplane Mode.** Swipe the app away, turn on Airplane Mode
   and open it again. It should open to the app, not the offline page, and
   behave as the installed web app does with no signal: open a show and Run
   Show, make an edit, and the save status says Offline. Turn Airplane Mode
   off and check the edit syncs.
4. **First launch with no signal.** Delete the app, turn on Airplane Mode and
   run it again. The offline page appears, ink and ivory with the Garamond
   heading. Retry says there's still no connection. Turn Airplane Mode off and
   the app loads by itself (if the network is slow to come up, tap Retry).
5. **Links still leave the app.** A performer's email opens Mail, a video or
   social link opens Safari, and the tour and guides open inside the app.
6. **Updates.** After a web deploy, open the app online: it offers "A new
   version of the app is ready" with a Reload button.

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
the app picks them up from the live site through the service worker's update
prompt. After upgrading Capacitor packages, or changing `capacitor.config.ts`
or `public/offline.html`, re-run `npm run ios:sync`.
