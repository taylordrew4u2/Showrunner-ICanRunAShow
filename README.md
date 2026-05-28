# Showrunner

Show management software for live event coordinators — build lineups, import schedules, and run shows in real time.

## Live Demo

[https://showrunner-theta.vercel.app](https://showrunner-theta.vercel.app)

## Screenshots

TODO: Add screenshots of the main user flow, dashboard/interface, and mobile view.

---

## Overview

Showrunner is a full-stack production tool for comedians, promoters, and stage managers who run recurring live shows. It covers the full show lifecycle: building a lineup, coordinating staff, importing a schedule from a PDF or photo, and operating the show in a full-screen live mode with automated cue timing and walk-on music.

The target user is an independent promoter or stage manager who currently uses a mix of spreadsheets, notes apps, and Spotify. Showrunner puts all of that in one place and syncs it across devices.

---

## Problem

Live show coordinators have no dedicated tool that spans pre-show planning and real-time stage management. Building a lineup, attaching walk-on music to performers, importing a printed schedule, and actually running the show are all separate workflows — usually spread across Google Docs, spreadsheets, and whatever music player is open. Nothing connects them.

---

## Solution

Showrunner handles the full workflow in a single application:

- Before the show: build the lineup, attach walk-on music and profile data to each performer, track the budget, coordinate staff and hosts, and export a PDF runsheet
- Day of: upload a photo, PDF, or plain text to import the schedule automatically using AI
- During the show: run a full-screen live mode with per-cue countdowns and automatic walk-on music cueing based on performer name matching in the schedule

---

## Features

- Create and manage multiple shows with status tracking (upcoming, in-progress, completed, cancelled)
- Per-show lineup with performer profiles: photo, social media, credits, walk-on song title, artist, start timestamp, Spotify/YouTube link, audio file, and video
- Global performer rolodex — save a performer once, reuse across shows; editing a rolodex entry syncs to all matching performers in all shows
- AI schedule import via GPT-4o-mini Vision (images), PDF.js (PDFs), and a regex fallback for plain text — runs entirely in the browser
- Full-screen live mode with per-cue countdown timers, progress bar, and keyboard navigation
- Automatic walk-on music cueing: the current performer's audio player surfaces when their name appears in the active schedule cue
- Budget tracker with expense categories
- PDF runsheet export generated client-side
- Per-show todo list and section deadlines
- Drag-and-drop file uploads with MIME type validation for photo, audio, and video
- Slide-in drawer for performer profile editing without leaving the lineup view
- Persistent login via localStorage (stays logged in until explicit logout)
- Installable as a PWA
- Mobile app (React Native + Expo) and desktop app (Electron) share the same TypeScript types

---

## Tech Stack

- **Frontend:** React 19, TypeScript (strict mode)
- **Build:** Vite 7, vite-plugin-pwa (Workbox)
- **Mobile:** React Native, Expo SDK 54, Expo Router v4
- **Desktop:** Electron 40
- **Database:** Turso (libSQL — serverless SQLite edge)
- **Encryption:** crypto-js (PBKDF2 key derivation, AES encryption)
- **AI:** OpenAI GPT-4o-mini (text and vision)
- **PDF:** PDF.js (pdfjs-dist) — client-side extraction
- **Styling:** Custom CSS — design tokens, no CSS framework
- **Hosting:** Vercel (web), EAS Build (mobile)
- **Authentication:** Username/password — password-derived key used to encrypt stored data; no OAuth
- **APIs/libraries:** @libsql/client, crypto-js, pdfjs-dist, workbox-window

---

## Architecture

```
showrunner/
├── src/                         # Web app (React + Vite)
│   ├── App.tsx                  # Root — auth, routing, global state
│   ├── App.css                  # Design tokens + CSS layout system
│   ├── types/index.ts           # All shared TypeScript types
│   ├── components/
│   │   ├── Login.tsx            # Auth screen
│   │   ├── ShowCard.tsx         # Show grid tile
│   │   ├── ShowDetail.tsx       # Per-show management hub
│   │   ├── LiveMode.tsx         # Full-screen show runner
│   │   ├── Settings.tsx
│   │   ├── Expenses.tsx
│   │   └── sections/            # Per-section components inside ShowDetail
│   │       ├── PerformersSection.tsx
│   │       ├── PerformerProfile.tsx
│   │       ├── RolodexProfile.tsx
│   │       ├── ScheduleSection.tsx
│   │       ├── ArtistsSection.tsx
│   │       └── ...
│   └── utils/
│       ├── secure-storage.ts    # Encryption + Turso read/write
│       ├── encryption.ts        # Key derivation and AES helpers
│       ├── aiExtractor.ts       # OpenAI + PDF.js + regex pipeline
│       ├── pdfExport.ts         # Client-side PDF generation
│       └── db.ts                # Turso client
├── app/                         # Mobile app (Expo Router)
├── desktop/                     # Electron wrapper
├── components/                  # Shared mobile components
└── utils/                       # Shared mobile utilities
```

**App flow:**

User signs in → password is used to derive an encryption key via PBKDF2 → all show data and settings are decrypted from Turso on load → user edits shows, performers, schedule → changes are encrypted and written back to Turso on a debounced interval → in live mode, schedule cues are matched against performer names to surface the correct walk-on music automatically.

---

## How to Run Locally

```bash
git clone https://github.com/taylordrew4u2/showrunner.git
cd showrunner
npm install
npm run dev
```

Production build:

```bash
npm run build
```

### Environment Variables

```env
VITE_TURSO_DATABASE_URL=
VITE_TURSO_AUTH_TOKEN=
VITE_OPENAI_API_KEY=

# Artist sign-up email notifications (Brevo — free 300/day)
BREVO_API_KEY=
BREVO_SENDER_EMAIL=
BREVO_SENDER_NAME=Showrunner
```

`VITE_OPENAI_API_KEY` is optional. Without it, the AI schedule import falls back to regex parsing. The Turso variables are required for data persistence; the app will not load stored shows without them.

#### Artist notification emails (free)

The "You're up" button in Artist admin sends a real email via [Brevo](https://www.brevo.com) (formerly Sendinblue) — free tier allows 300 emails/day with no domain verification required.

One-time setup:

1. Sign up at brevo.com → verify your email
2. Settings → Senders & IP → add a sender email and click the verification link in your inbox (any email you own; Gmail works)
3. Settings → SMTP & API → API Keys → Generate a new v3 API key
4. In Vercel project settings → Environment Variables add:
   - `BREVO_API_KEY` — the key from step 3
   - `BREVO_SENDER_EMAIL` — the verified sender from step 2
   - `BREVO_SENDER_NAME` — display name (e.g. your show name)
5. Redeploy

Without these, the Email button shows a clear error explaining what's missing.

---

## Usage

1. Open the app and create an account (username + password)
2. Create a show and fill in basic info (name, date, venue)
3. Add performers to the lineup; upload walk-on music, photo, and profile data per performer
4. In the Schedule section, import a schedule by uploading a PDF, image, or pasting text
5. Use the PDF export to print a runsheet
6. On show day, enter Live Mode — cues advance with countdown timers, and the walk-on music player for the current performer surfaces automatically

---

## What I Built

- Designed and built the entire application from scratch, solo
- Implemented the 3-column desktop layout using CSS Grid `grid-template-areas` with a responsive collapse to a bottom-nav mobile layout below 1024px — no layout library
- Built the encryption and account system: password-derived AES keys via PBKDF2 (crypto-js), with all data encrypted before it reaches Turso
- Built the AI schedule import pipeline: GPT-4o-mini Vision for images, PDF.js for multi-page PDFs, and a regex fallback for plain text — runs fully in the browser
- Built the live mode performer name-matching algorithm that surfaces the correct walk-on audio player from the active schedule cue
- Built the performer rolodex with cross-show sync: editing a rolodex entry propagates updated fields to matching performers in all existing shows
- Implemented drag-and-drop file uploads with MIME validation for photo, audio, and video
- Built the slide-in drawer pattern for performer profile editing with CSS keyframe animation
- Implemented a show card expand animation using computed `transform-origin` from the clicked card's position
- Set up the React Native + Expo mobile app and Electron desktop wrapper sharing types with the web app
- Deployed to Vercel

---

## Technical Decisions

**No CSS framework.** Every component is styled with hand-written CSS using a design token system (`--primary`, `--surface`, `--border`, etc.). This keeps the bundle small and gives full control over every interaction state and animation.

**Encryption in the client, not the server.** The server (Turso) stores only ciphertext. The password-derived key never leaves the device. This avoids the need to trust the database host with user data. The trade-off is that there is no password recovery — by design.

**AI pipeline with fallback.** The schedule import works without an API key by falling back to regex matching for common time formats. This makes the feature usable offline or in environments where the OpenAI key is not configured.

**Shared TypeScript types across targets.** The web, mobile, and desktop apps share a single set of TypeScript interfaces. This prevents data shape mismatches when adding or modifying fields.

**Debounced auto-save.** Changes to shows are saved to Turso after a 1-second debounce rather than on every keystroke. This avoids hammering the database while keeping data loss risk low.

**Rolodex as source of truth.** Rather than duplicating performer data across shows at creation time and leaving it to drift, editing a rolodex entry propagates updated fields (photo, social media, walk-on music, credits) to all matching performers in all shows at save time.

---

## Challenges Solved

**Matching performers to schedule cues at runtime.**
The live mode needed to surface the correct walk-on music player for the current cue without requiring the user to manually link performers to schedule entries. The solution: case-insensitive substring matching between the cue description and each performer's name. Only performers with uploaded walk-on audio are considered. This runs on every cue change and is fast enough for real-time use.

**Preventing data loss on save failure.**
If the Turso write fails during auto-save, the in-memory state must not be overwritten by a subsequent load. The solution: a `dataLoaded` ref that is set after the initial load succeeds. The auto-save effect checks this ref before writing, so a failed load does not trigger a save that would wipe the database row.

**Accurate expand animation origin.**
The show card expand animation needed to originate from the card that was clicked, not the center of the screen. The solution: on click, the card's `getBoundingClientRect()` is used to compute the card center as a percentage of the main content area, which is passed as a CSS custom property (`--expand-origin-x`, `--expand-origin-y`) to the detail view's `transform-origin`.

---

## Testing

Automated tests are not currently implemented.

Manual testing should cover:

- Main user flow (create show, add performers, import schedule, enter live mode)
- Form validation (required fields, file type enforcement)
- Error states (invalid login, failed save, missing API key)
- Mobile/responsive layout
- Data persistence across sessions and devices

---

## Security

- Passwords are not stored; a PBKDF2-derived key is used for encryption and a separate hash is stored for authentication
- All show data and settings are encrypted with AES (via crypto-js) before being written to Turso
- Environment variables are used for all API keys and database credentials
- The static salt used in key derivation (`encryption.ts`) is a known limitation — per-user random salts would improve security
- No input sanitization beyond basic trimming is currently implemented
- No rate limiting on the authentication endpoint

---

## Accessibility

Accessibility has not been formally reviewed.

Basic considerations present in the codebase:

- Form inputs have associated labels
- Interactive elements have minimum touch target sizes (44px)
- Semantic HTML elements are used in most components

Accessibility review is a future improvement.

---

## Known Limitations

- The PBKDF2 implementation uses a static salt and 1000 iterations — adequate for a personal project but below current security recommendations for production use
- No automated tests
- No password recovery — losing the password means losing access to all data
- The AI schedule import depends on an external API key (OpenAI); without it, only the regex fallback is available
- Error handling is present but not comprehensive — some failure states surface as console errors rather than user-facing messages
- The mobile app (Expo) and desktop app (Electron) share types with the web app but have not been maintained at the same level as the web build
- No CI/CD pipeline beyond Vercel's automatic preview deployments

---

## Roadmap

- Add per-user random salts and increase PBKDF2 iterations
- Add automated tests (unit + integration)
- Add comprehensive error handling and user-facing error messages
- Improve accessibility (keyboard navigation audit, ARIA labels)
- Add CI/CD workflow with lint and type-check on every PR
- Add a LICENSE file
- Add screenshots to this README
- Harden the mobile and desktop builds to match web feature parity

---

## Status

Active. The web app is deployed and functional. The mobile and desktop targets exist but are not the primary focus of current development.

---

## License

No license has been added yet.

---

## Repository Notes

**Suggested GitHub description:**
> Show management app for live event coordinators — lineup building, AI schedule import, and real-time live mode with automated walk-on music cueing.

**Suggested topics:**
`react` `typescript` `vite` `pwa` `react-native` `expo` `electron` `turso` `libsql` `openai` `show-management` `live-events`

**Files to review:**
- `src/utils/encryption.ts` — static salt is a security limitation worth addressing before wider use
- No `LICENSE` file exists — add one if the repo is public
- No `.env.example` file exists — consider adding one so contributors know what variables are required
