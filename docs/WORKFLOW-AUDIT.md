# Workflow Audit — Ease of Use & Marketing

_Audit date: 2026-07-10 · Scope: the end-to-end producer journey (first touch → onboarding → build → run) and the public marketing surfaces (landing, guides, SEO, ads)._

This is a review document, not a code change. Findings are prioritized so they can
be turned into issues/PRs in order of impact-to-effort. Each finding cites the file
it lives in.

---

## 1. Executive summary

The product is in good shape: a clear single-column phone-first flow, a real
three-step onboarding, strong SEO/structured-data hygiene, a genuine content
marketing layer (four producer guides), and a coherent landing page. The biggest
wins now are **conversion friction at the top of the funnel** and a few **ease-of-use
gaps that only bite the brand-new user** — the exact moment that decides whether a
first-time producer stays.

Top five things to fix, in order:

| # | Finding | Type | Severity |
|---|---------|------|----------|
| 1 | Auto-ads load inside the logged-in app, not just public pages | Ease of use + policy | **P0** |
| 2 | No "try it" path — every visitor must create an account before seeing anything | Marketing / conversion | **P0** |
| 3 | Empty state is a dead end (`No shows yet`) — no guided first action beyond a button | Ease of use | **P1** |
| 4 | Landing has no screenshots/visual proof above the fold; the app's best asset is invisible | Marketing | **P1** |
| 5 | Password rules are 3-char weak while "no recovery" is the headline risk | Ease of use / trust | **P1** |

---

## 2. The workflow, as it actually is today

Mapped from the code, a first-time producer travels:

```
icanrunashow.com
  └─ Login.tsx  (landing headline + login form + features + guides + FAQ, all on one screen)
      └─ Create Account  (username + password, 3-char minimums — Login.tsx:29,39)
          └─ Onboarding.tsx  (welcome → show types → brand name, 3 steps)
              └─ App.tsx list view  → empty-state "No shows yet" (App.tsx:813)
                  └─ + New Show  → ShowForm  → ShowDetail (sections)
                      └─ build lineup / import schedule / Run Show
```

Public visitors also have an account-free entry point that is strong and should be
marketed harder: the **live viewer** (`?view=`) link.

**The friction is front-loaded.** The landing page and the account wall are the same
screen (`Login.tsx` renders class `landing`), so the marketing copy and the signup
form compete for the same attention, and there is no way to look before you commit.

---

## 3. Ease-of-use findings

### P0 — Auto-ads run inside the working app — RESOLVED
AdSense has since been removed from the project entirely: no loader in the app shell,
no tags on the static guides, no `ads.txt`. Ads can no longer render over the lineup
editor or Run Show because there are no ads.

### P1 — Empty state is a dead end
`App.tsx:813-819` — a new producer who finishes onboarding lands on:
> **No shows yet.** Tap **+ New Show** to get started.

That's the single highest-intent screen in the product and it does nothing to reduce
the blank-page problem. Recommended:
- Offer a **"Create your first show"** primary button *in* the empty state (not only in the header), pre-filling a sensible default (tonight's date, the brand name from onboarding).
- Add a one-line link to the **first-show checklist guide** already written in `public/guides/first-show-checklist.html` — turn owned content into in-product help.
- Consider a **sample/demo show** the user can open to see the shape of a finished show, then clear.

### P1 — Password policy vs. the "no recovery" promise
`Login.tsx:29,39` enforce only 3-character minimums for username and password. Because
the password *derives the encryption key* and there is **no recovery by design**
(README "Known Limitations"), a weak password is both a security and a data-loss risk,
and a 3-char rule signals "toy." Recommended:
- Raise the practical minimum (8+), add a lightweight strength hint.
- On signup, show the "there is **no password reset** — write it down" warning *before*
  the account is created, not buried in the privacy page. This is a trust/ease-of-use
  win: set the expectation at the exact moment it matters.

### P2 — Onboarding requires a show-type before continuing, but brand name is skippable-by-accident
`Onboarding.tsx:117` disables **Continue** until at least one show type is picked (good),
but the brand step (`Onboarding.tsx:125-161`) lets **Finish** fire with an empty brand
name. That's a defensible "optional" choice, but there's no "Skip for now" affordance, so
a user who leaves it blank isn't sure if they did something wrong. Add an explicit
**Skip** control or a default ("My Shows") so the state is intentional, not ambiguous.

### P2 — Bottom-nav "New Show" and header "+ New Show" are redundant but the empty state points only at the header one
Minor: `App.tsx:768` (header button) and `App.tsx:1011` (bottom-nav `+`) both create a
show, but the empty-state copy says "Tap **+ New Show**" which matches neither label
exactly on mobile. Align the copy with the actual control the user sees.

### P2 — No inline guidance on the schedule import — the flagship feature
The AI schedule import is the marquee feature (README, landing), but the first-run user
has no in-context nudge toward "upload a photo of your schedule." Surface it in the
Schedule section empty state and in the show empty state.

---

## 4. Marketing findings

### P0 — No look-before-you-signup path (conversion)
The landing (`Login.tsx`) sells well in copy but **gates 100% of the product behind
account creation**. For a free tool whose differentiator is "run the show live," the
single most effective conversion lever is letting people *see* it. Options, cheapest first:
1. **Add screenshots/GIF to the landing** (the repo already ships `docs/screenshots/run-show.gif` and eight PNGs) — visual proof above the fold is the lowest-effort, highest-return change here.
2. **A public read-only demo show** reusing the existing `?view=` viewer route — one link, no new auth surface, shows the live experience instantly.
3. A short **product video** or embedded loop.

### P1 — Landing is copy-only; the app's strongest asset (the live timer UI) is invisible
`Login.tsx:139-193` is three text sections (features, guides, FAQ). There is not a single
image on the marketing screen, yet `docs/screenshots/` holds polished, captioned shots.
Embed at least the Run-Show GIF and the run-of-show builder shot. This is the biggest
marketing gap relative to effort.

### P1 — Guides don't convert as hard as they could
The guides (`public/guides/*.html`) are genuinely good SEO content and each links back to
`/` with a CTA (e.g. `how-to-build-a-run-of-show.html:73-74`). Improvements:
- The CTA links to `/` (the login wall). Point it at a **demo** or anchor to the landing's feature section instead, so a reader who clicked from Google isn't immediately asked to sign up.
- Add **internal cross-links** between guides (they currently only link home) — keeps readers on-site, helps SEO topical clustering.
- Add the `Article`/`HowTo` structured data to each guide (the app page has `SoftwareApplication` JSON-LD; the guides have none) — eligible for rich results.

### P1 — Ads on the guides may undercut the conversion goal — RESOLVED
The guides no longer carry ad tags, so their CTA is the only thing competing for the
click.

### P2 — Meta/OG is strong; two gaps
`index.html` SEO is well done (canonical, OG, Twitter, JSON-LD, `llms.txt`). Gaps:
- The `SoftwareApplication` schema has `offers.price: 0` (good) but no `aggregateRating` — add once you have testimonials; it drives CTR.
- No `og:image` variant featuring the live timer; the current `og-image.png` is generic. A share card showing the countdown UI would lift social CTR.

### P2 — "Free" is stated but the model isn't
Landing FAQ says "It's free to use" (`Login.tsx:184-185`). With ads removed, that is
now literally true and worth saying plainly — "free, no ads, no tracking" preempts the
"what's the catch" hesitation better than "free" alone.

### P2 — Social proof is entirely absent
No testimonials, no "used to run N shows," no venue logos. Even one real quote from a
producer who used it alongside a real show (the README says it was "built and refined
alongside real live shows") would materially lift the landing.

---

## 5. Quick-wins backlog (highest impact-to-effort first)

| Change | File(s) | Effort | Payoff |
|--------|---------|--------|--------|
| Embed the existing Run-Show GIF + one screenshot on the landing | `Login.tsx`, `docs/screenshots/*` | S | Biggest marketing lift |
| Make the empty state a guided first action (pre-filled show + link to checklist guide) | `App.tsx:813` | S | First-run activation |
| Show the "no password recovery" warning at signup + raise min length to 8 | `Login.tsx` | S | Trust + data-loss prevention |
| Public read-only **demo show** link on the landing (reuses `?view=` route) | `Login.tsx`, `App.tsx:697` | M | Look-before-signup conversion |
| Add `HowTo`/`Article` JSON-LD + cross-links to guides | `public/guides/*.html` | S | SEO rich results |

---

## 6. What's already good (keep it)

- Clean, consistent phone-first single-column model — low cognitive load.
- Real onboarding that tailors terminology to show type (`Onboarding.tsx`, `terminology.ts`).
- Account-free public viewer link — a genuine growth loop that's under-marketed.
- Strong technical SEO: canonical, OG, Twitter cards, `SoftwareApplication` JSON-LD, `llms.txt`, sitemap (`index.html`, `vercel.json`).
- Owned content marketing (four substantive producer guides) — most side-projects have none.
- Backup nudge + skeleton loading + boot splash — thoughtful retention/perf touches.

---

_Next step: turn §5 into individual issues/PRs. Items 1–4 are each an afternoon and
cover the P0/P1 surface._
