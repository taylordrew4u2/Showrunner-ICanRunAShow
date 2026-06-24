# Screenshots

Drop product screenshots in this folder and they'll appear in the main README's
**Screenshots** section — uncomment the `<img>` block there once the files exist.

The live app is at **https://icanrunashow.com** (or use a PR preview). It's a
phone-first, single-column app, so capture the in-app screens at a phone width
(~430px) for the most representative look. Light is the default theme; Dark is
available in Settings.

Suggested shots (PNG, keep each under ~500 KB):

| Filename | What to capture |
| --- | --- |
| `shows.png` | The shows dashboard — bento summary tiles, search/filter, a few show cards |
| `show-detail.png` | A show's detail page — host slot, status, the section accordion |
| `run-show.png` | Run Show full-screen live mode — timer, on-stage card, controls |
| `artist-signup.png` | The public artist sign-up page (optional) |
| `viewer.png` | The public read-only viewer link — live on-stage / up-next (optional) |

Tips:
- Use a seeded demo account so the screens look populated.
- Crop to the app content; hide any personal data.
- The filenames above are what the README's commented `<img>` block expects —
  once `shows.png`, `show-detail.png`, and `run-show.png` are here, just remove
  the `<!-- -->` around that block.

## Automated capture

`scripts/capture-screenshots.mjs` drives the app with Playwright: it logs in
(creating the account + onboarding if it doesn't exist), seeds a demo show with
performers and a run-of-show when the workspace is empty, then captures the
screens at phone width into this folder.

**Locally:**

```bash
npm i -D playwright && npx playwright install chromium
DEMO_USER=demo DEMO_PASS=demo1234 APP_URL=https://icanrunashow.com npm run screenshots
```

Use a **throwaway demo account** — never a real one (the seed step assumes it can
populate an empty workspace). Set `HEADLESS=false` to watch it run.

**Via GitHub Actions:** add repo secrets `DEMO_USER` and `DEMO_PASS`, then run the
**Capture screenshots** workflow (Actions tab → Run workflow). It captures the
shots, uploads them as an artifact, and pushes them to a `chore/screenshots-*`
branch you can open a PR from.

After the PNGs land here, uncomment the `<img>` block in the main README.
