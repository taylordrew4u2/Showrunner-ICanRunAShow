# Showrunner

> Production-grade show management built for live event coordinators — from pre-show logistics to real-time stage management.

[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![Live Demo](https://img.shields.io/badge/demo-live-DC2626)](https://showrunner-theta.vercel.app)

**[→ Live Demo](https://showrunner-theta.vercel.app)**

Built solo from scratch: web app (React + Vite PWA), mobile (React Native + Expo), and desktop (Electron) from a single TypeScript codebase. Deployed to Vercel. No UI library — every component is handwritten CSS.

---

## The Problem

Comedians, promoters, and stage managers who run regular shows cobble together Google Docs, Spotify tabs, and notes apps to manage their lineups. There's no tool that spans the full lifecycle: building the lineup, coordinating staff, importing a schedule from a photo of a printed runsheet, and running the actual live show — all in one place with their data encrypted and synced across devices.

Showrunner is that tool.

---

## What It Does

| Phase | Features |
|---|---|
| **Pre-show** | Build lineup, attach walk-on music per performer, coordinate staff & DJ, track budget, generate PDF runsheet |
| **Day-of** | Import schedule by uploading a photo, PDF, or plain text — AI structures it automatically |
| **Live** | Full-screen stage manager with cue countdowns, progress tracking, and automatic walk-on music cueing |

---

## Architecture

### One Codebase, Three Platforms

```
showrunner/
├── src/              ← Web app (React 19 + Vite 7)
├── app/              ← Mobile (React Native + Expo Router v4)
├── desktop/          ← Desktop (Electron 40 wrapper)
├── components/       ← Shared mobile components
└── utils/            ← Shared utilities
```

Shared TypeScript types across all three targets. The web app deploys to Vercel and installs as a PWA; the desktop app builds a universal macOS binary (x64 + arm64); mobile distributes via EAS Build.

### Security Model

No backend server ever sees plaintext data. All encryption happens client-side before anything touches the network:

```
Password → PBKDF2 (100k iterations, SHA-256, random salt)
         → 256-bit AES-GCM key
Data     → JSON.stringify → AES-GCM encrypt → base64 → Turso (libSQL)
```

Implemented with the [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API) directly — no third-party crypto library. Each user's data is isolated by their derived key. Multi-device access works because any device that knows the password can derive the same key. No OAuth, no analytics, no key escrow.

### Layout System

Three-column dashboard on desktop (sidebar nav + scrollable content + contextual right panel), collapsing to a bottom-nav mobile layout below 1024px.

```
┌──────────────┬────────────────────────┬────────────┐
│   Sidebar    │     Main Content       │ Right Panel│
│   220px      │     1fr (scrollable)   │   280px    │
│              │                        │            │
│  Shows       │  [Show cards, forms,   │  Stats     │
│  Rolodex     │   performer profiles,  │  Recent    │
│  Expenses    │   schedule builder,    │  Upcoming  │
│  Settings    │   live mode...]        │            │
└──────────────┴────────────────────────┴────────────┘
```

Built with CSS Grid `grid-template-areas`. No layout library. Collapses to a fixed bottom nav below 1024px.

---

## Technical Highlights

### AI Schedule Import Pipeline

The schedule section accepts images (photos of printed runsheets, screenshots), multi-page PDFs, and plain text. The extraction pipeline:

1. **PDF.js** — client-side text extraction from multi-page PDFs with no server upload
2. **GPT-4o-mini Vision** — for images; the model returns structured JSON (time + description pairs)
3. **Regex fallback** — handles common time formats (`HH:MM`, `H:MMam`) when the API is unavailable or the key isn't configured

The entire pipeline runs in the browser. No backend server. No file uploads to a third party.

### Live Mode — Performer Name Matching

The core feature of live mode: if a schedule cue's description contains a performer's name, their walk-on music player surfaces automatically. The matching function:

```typescript
function matchPerformer(cue: ScheduleItem | undefined): Performer | null {
  if (!cue || !performers.length) return null;
  const desc = cue.description.toLowerCase();
  return performers.find(
    p => p.walkOnMusic && desc.includes(p.name.toLowerCase())
  ) ?? null;
}
```

This runs on every cue change. Performers without walk-on music are excluded. The current and next-up performers both surface — so the operator can cue the next song before the current act finishes.

### Performer Rolodex

A global entity library that persists across shows. When a performer is saved to the rolodex, their full profile (photo, walk-on music + artist + Spotify/YouTube link, credits, social media) is stored. Adding them to a new show pre-fills all their data. Editing a rolodex entry syncs updated fields to every matching performer in every existing show — the rolodex is the source of truth.

### Slide-in Drawer Pattern

Performer profiles open in a fixed-position drawer panel (580px, full-screen on mobile) using a CSS animation originating from the clicked row:

```css
.perf-drawer {
  animation: perf-slide-in 0.25s cubic-bezier(0.32, 0.72, 0, 1);
}
@keyframes perf-slide-in {
  from { transform: translateX(100%); }
  to   { transform: translateX(0); }
}
```

Show cards use a position-aware expand animation: the clicked card's center is computed as a `transform-origin` percentage, so the detail view scales up from exactly where you tapped.

### Drag-and-Drop Uploads

Photo, audio, and video upload zones accept both click-to-upload and drag-and-drop. MIME type is validated on drop. Each zone shows visual feedback (dashed border → red highlight) on `dragenter`. Implemented with standard browser drag events — no library.

---

## Design System

Custom CSS design system — no Tailwind, no CSS Modules, no styled-components.

### Tokens

```css
:root {
  --bg:               #FAFAFA;
  --surface:          #FFFFFF;
  --surface-strong:   #F5F5F5;
  --text:             #000000;
  --text-muted:       #525252;
  --border:           #E5E5E5;
  --primary:          #DC2626;   /* Red — the brand color */
  --primary-soft:     #FEF2F2;   /* Red tint for backgrounds */
  --shadow-sm:        0 2px 8px rgba(0,0,0,0.08);
  --shadow-md:        0 8px 24px rgba(0,0,0,0.12);
}
```

### Component Patterns

- **BEM-ish naming**: `.section-list-item__body`, `.perf-profile__photo-drop`
- **Utility classes**: `.btn`, `.btn--primary`, `.btn--ghost`, `.btn--sm`, `.pill`, `.pill--red`
- **Responsive strategy**: Desktop-first 3-column grid → single-column mobile stack. No media query libraries.
- **Interaction states**: Every interactive element has `hover`, `active`, `focus`, `disabled`, and `drag` states

---

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript — strict mode, no `any` |
| Web Framework | React 19 — hooks, concurrent features |
| Build | Vite 7 + PWA plugin (Workbox) |
| Mobile | React Native + Expo SDK 54 |
| Mobile Routing | Expo Router v4 — file-based |
| Desktop | Electron 40 |
| Database | Turso — serverless libSQL (SQLite edge) |
| Encryption | Web Crypto API — AES-GCM + PBKDF2 |
| AI | OpenAI GPT-4o-mini — text extraction + vision |
| PDF | PDF.js — client-side, no server upload |
| Styling | Custom CSS — design tokens, zero dependencies |
| Deployment | Vercel (web) + EAS Build (mobile) |

---

## Features

**Show lifecycle** — create shows, track status (upcoming → in-progress → completed → cancelled), manage sections with deadlines and completion indicators

**Lineup management** — performers, artists, hosts, DJ, and staff each have their own section with profiles, media, and notes; drag-and-drop ordering

**Per-performer profiles** — photo, social media, credits/intro notes, walk-on song title + artist + start timestamp + Spotify/YouTube link, audio file, video clip; all stored in the global rolodex

**AI schedule import** — upload a PDF, image, or paste text; AI structures it into a timed cue list automatically

**Live mode** — full-screen stage manager with per-cue countdowns, progress bar, keyboard navigation (space to pause, arrows to navigate), and automatic walk-on music cueing from performer name matching

**Budget tracker** — expense categories with receipt photo upload and running totals

**PDF runsheet** — client-side PDF export of the full show runsheet

**Rolodex** — global performer database; editing an entry syncs to all matching performers across all shows

**Security** — end-to-end encrypted, multi-device, persistent login via localStorage (password never sent to the server)

---

## Quick Start

```bash
git clone https://github.com/taylordrew4u2/showrunner.git
cd showrunner
npm install
npm run dev          # → http://localhost:5173
```

**Environment variables** (copy `.env.example` → `.env`):

```env
VITE_TURSO_DATABASE_URL=your_turso_url
VITE_TURSO_AUTH_TOKEN=your_turso_token
VITE_OPENAI_API_KEY=sk-...   # optional — enables AI schedule import
```

**Other targets:**

```bash
npm run mac          # Electron desktop (macOS, live reload)
npm run start        # Expo mobile dev server
npm run build        # Production web build → dist/
npm run build:mac    # Universal macOS .dmg → dist-electron/
```

---

## Project Structure

```
src/
├── App.tsx                          # Root — auth, routing, global state
├── App.css                          # Design tokens + layout system
├── types/index.ts                   # All shared TypeScript types
├── components/
│   ├── Login.tsx                    # Auth screen (sign in / sign up)
│   ├── ShowCard.tsx                 # Show grid tile with expand animation
│   ├── ShowDetail.tsx               # Per-show management hub
│   ├── LiveMode.tsx                 # Full-screen show runner
│   ├── Settings.tsx                 # Account + app settings
│   ├── Expenses.tsx                 # Global budget tracker
│   └── sections/
│       ├── PerformersSection.tsx    # Lineup with rolodex picker
│       ├── PerformerProfile.tsx     # Drawer profile editor + drag/drop
│       ├── RolodexProfile.tsx       # Rolodex entry editor
│       ├── ScheduleSection.tsx      # Cue builder + AI import
│       ├── ArtistsSection.tsx       # Artists / support acts
│       └── ...
└── utils/
    ├── secure-storage.ts            # AES-GCM + PBKDF2 encryption layer
    ├── aiExtractor.ts               # OpenAI + PDF.js + regex pipeline
    └── pdfExport.ts                 # Client-side runsheet PDF generation
```

---

## License

MIT
