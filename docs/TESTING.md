# Testing

## Commands

```bash
npm test               # Vitest unit tests
npx tsc -b             # Type-check
npm run lint           # ESLint
npm run build          # Production build (env check, type-check app + API, Vite build)
npm run e2e:install    # Once: install the Chromium build Playwright pins
npx playwright test    # End-to-end, desktop + phone (also: npm run e2e)
```

The end-to-end suite builds and serves the production bundle itself, so there is no dev server to start first, and it needs no database or API keys.

If a pre-installed Chromium doesn't match Playwright's pinned build, every test fails at browser launch. Point Playwright at the installed binary instead:

```bash
PW_CHROMIUM_PATH=/path/to/chrome npx playwright test
```

## Unit tests

Over 1,000 Vitest tests cover the pure logic, most of it in `src/utils/` with a test file beside each module: schedule parsing, cue timing, performer cover-sync, the encryption round-trip, soundboard construction, media reachability, contract signing, post copy, save-conflict merging, and section defaults.

## End-to-end tests

23 Playwright specs (120 tests across the two projects) drive the built app in a real browser. Every test runs in two projects: `desktop` (Desktop Chrome) and `phone` (iPhone 13 viewport and touch, emulated in Chromium).

They cover what would ruin a show night, and properties worth asserting rather than describing. A selection:

| Spec | What it holds to account |
| --- | --- |
| `critical-path` | Sign up, build a show, add and edit a cue, open live mode; and live mode is driveable from the keyboard alone, which is what makes a Bluetooth clicker work as a stage remote |
| `contracts` | A signer in a separate browser context with no session opens a link and signs; signing twice is refused; no request carries the fragment key, and no server-side row holds the signer's name |
| `storage` | The sweep clears a seeded orphan while leaving files still in use, and is not offered at all to a client whose data failed to load |
| `navigation` | Five tabs; More leads to the paperwork and back returns there; every label fits its tab at 320px; the desktop menu opens, and closes on Escape or an outside click |
| `show-flyer` | Every show keeps its own flyer through a reload, a new show starts without one, and the lineup comes before the running order |
| `contract-from-show` | A contract sent from a show's lineup is signed with the required headshot and the cancellation rule acknowledged |
| `save-conflicts` | An older tab cannot erase a newer save; a conflicting edit stays on screen and says it has not saved; losing the signal keeps the edit locally and saves it when the signal returns |

### Why a fake API

The suite runs against an in-memory stand-in for the server API (`e2e/support/fake-api.mjs`) rather than a live database. That keeps CI hermetic and secret-free. Because the app encrypts in the browser, the client code under test is the real thing either way: key derivation, the chunked media store, and the per-request keys behind a signing link all still run. The fake reproduces the server rules that matter, including the sign-once `WHERE signed_at IS NULL`.

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs on every push and pull request to `main`: lint, unit tests, and type-check + build in one job, with the end-to-end suite as a second job that uploads the Playwright report on failure.
