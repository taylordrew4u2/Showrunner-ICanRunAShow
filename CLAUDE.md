# Working on I Can Run A Show

## No third-party services

**Do not integrate any external service.** Not a paid one, not a freemium one,
and not one with a free trial. This includes, but is not limited to: scheduling
and calendar APIs, payment processors, email and SMS senders, analytics,
error tracking, AI or transcription APIs, image or audio hosting, link
shorteners, and social posting APIs.

A free trial is not an exception. It is a bill and a dependency with a delay on
it, and it becomes load-bearing for a live show before anyone notices.

This also rules out adding an npm dependency whose job is to talk to such a
service. If a feature seems to need one, build the local version instead and
say plainly what it cannot do:

- Announcing a show → compose the post and copy it to the clipboard. Do not
  post it.
- Getting a performer's details → produce something they can fill in and send
  back. Do not integrate a forms product.
- Anything timed → compute it in the app. Do not reach for a scheduler.

The services already wired into this repo (Vercel hosting, Turso/libsql for
sync) predate this rule and stay. It governs *new* integrations.

## Adding dependencies

Prefer none. The app runs in venue basements on bad connections, and every
package is weight in a bundle that has to load before doors. Before adding one,
check whether `src/utils/` already has the helper — several near-duplicates have
been written by accident.

## Running the checks

```
npm test          # vitest, unit
npx tsc -b        # types
npm run lint      # eslint
npm run build     # production build
npx playwright test   # e2e, desktop + phone
```

In a fresh container the pre-installed Chromium usually does not match the
Playwright build, and **every** e2e test then dies at browser launch in a few
milliseconds — which looks like a catastrophic regression and is not one. Point
Playwright at the installed binary:

```
PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx playwright test
```

The config already reads that variable. Check the path — the build number
changes.

## Conventions worth matching

- Times are free text (`"8:00 PM"`, `"20:00"`, `"8pm"`). Parse with
  `parseClockToMinutes` and print with `clockLabel`; never hand-roll either.
- Comments explain *why*, not what. The existing ones are the house style.
- Tests are named as sentences about the product, not the function.
- Never delete a producer's shows, contracts, or performers as a side effect of
  a feature. Replacing something (a running order, say) needs a warning first
  and a way back.
