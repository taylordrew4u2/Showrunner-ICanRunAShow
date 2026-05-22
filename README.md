# Showrunner

> Full-stack, multi-platform show management app with end-to-end encryption, AI-powered schedule import, and real-time live show coordination.

**[Live Demo →](https://showrunner-theta.vercel.app)**

Built solo from scratch — web, mobile (iOS/Android), and desktop (macOS) from a single TypeScript codebase.

---

## What It Does

Showrunner is a production tool for live event coordinators: comedians, promoters, and stage managers who run shows regularly. It handles everything from pre-show logistics to real-time stage management:

- **Pre-show:** Build the lineup, attach walk-on music per performer, coordinate staff, track the budget, and generate a PDF runsheet
- **Day-of:** Import the schedule by uploading a photo, PDF, or plain text — AI extracts and structures it automatically
- **Live:** Run the show from a full-screen live mode that tracks cue timing, displays countdowns, and automatically surfaces a performer's walk-on music the moment they're up next

---

## Architecture

### Multi-Platform from One Codebase

| Platform | Stack |
|---|---|
| Web | React 19 + Vite 7 + PWA |
| Mobile | React Native + Expo SDK 54 + Expo Router v4 |
| Desktop | Electron 40 wrapping the Vite build |

Shared TypeScript types across all three targets. The web app is deployed to Vercel and installable as a PWA; the desktop app is a universal macOS binary (x64 + arm64); mobile is distributed via EAS Build.

### Security Model

All user data is encrypted **before** it leaves the device using AES-GCM with a key derived from the user's password (PBKDF2). The database (Turso/libSQL) stores only ciphertext — the server never sees plaintext data. There is no OAuth, no third-party auth provider, and no analytics.

### Layout System

Three-column dashboard layout on desktop (fixed sidebar nav + scrollable content + contextual right panel), collapses to a bottom-nav mobile layout below 1024px. Built with CSS Grid `grid-template-areas` — no layout library.

---

## Technical Highlights

### AI Schedule Import
The schedule section accepts text files, multi-page PDFs, and images (photos of printed runsheets, scanned documents, screenshots). PDF.js handles client-side text extraction; images go to GPT-4o-mini Vision. A regex fallback handles common time formats when the API is unavailable. The entire extraction pipeline runs in the browser with no backend server required.

### Live Mode
A full-screen stage management view built for use during an actual show. It tracks elapsed/remaining time per cue with a live countdown, auto-advances the progress bar, and supports keyboard shortcuts (space to pause, arrow keys to navigate). The key feature: if a schedule cue description contains a performer's name, their walk-on music player surfaces inline automatically — so the operator never has to hunt for it mid-show.

### Performer Rolodex
Performers saved across shows are stored in a global rolodex with their full profile: photo, social media, walk-on music file, credits, and intro notes. When building a new show, any rolodex entry can be added to the lineup with one click — all their data pre-fills. This pattern (entity library → show-level use) mirrors how real production companies operate.

### Encryption Architecture
```
Password → PBKDF2 (100k iterations, SHA-256) → AES-GCM key
Data → JSON.stringify → encrypt → base64 → Turso
```
Each user's data is isolated by their derived key. The app supports multi-device access: any device that knows the password can decrypt. No key escrow, no recovery codes — by design.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript (strict mode throughout) |
| Web Framework | React 19 (hooks, concurrent features) |
| Build Tool | Vite 7 with PWA plugin |
| Mobile | React Native + Expo SDK 54 |
| Mobile Routing | Expo Router v4 (file-based) |
| Desktop | Electron 40 |
| Database | Turso (libSQL — serverless SQLite) |
| Encryption | Web Crypto API (AES-GCM + PBKDF2) |
| AI | OpenAI GPT-4o-mini (text + vision) |
| PDF Processing | PDF.js (client-side) |
| Styling | Custom CSS (design tokens, BEM-ish, no framework) |
| Deployment | Vercel (web) + EAS Build (mobile) |

---

## Features

### Show Management
- Create and manage multiple shows with full lifecycle tracking (upcoming → in-progress → completed)
- Per-show lineup: performers, artists, hosts, DJ, staff — each with their own profile, media, and notes
- Drag-and-drop schedule builder with time-based cue system
- Budget tracker with expense categories and receipt photo upload
- PDF export of the full runsheet (generated client-side)
- Todo list per show
- Section deadlines and completion tracking

### Performer Profiles
Each performer has a dedicated profile card (photo, social media, credits, walk-on song + timestamp, video). Profiles are stored in a global rolodex and can be reused across shows. Walk-on music is attached to the performer, not the schedule — it surfaces automatically in live mode when their cue is active.

### AI Schedule Import
Upload any of the following and the schedule populates automatically:
- Plain text or CSV
- Multi-page PDF documents
- Photos, screenshots, or scans of printed runsheets

### Live Mode
Full-screen show coordination with per-cue countdown timers, progress tracking, keyboard navigation, and automatic walk-on music cueing based on performer name matching in the schedule.

### Security & Sync
- End-to-end encrypted at rest and in transit
- Multi-device: sign in from any device, data syncs via encrypted cloud storage
- Session persistence across browser refreshes (sessionStorage)
- Trash/recovery system for deleted shows

---

## Quick Start

```bash
git clone https://github.com/taylordrew4u2/showrunner.git
cd showrunner
npm install

# Web
npm run dev          # http://localhost:5173

# Desktop (macOS)
npm run mac          # Electron + Vite live reload

# Mobile
npm run start        # Expo dev server
```

### Environment Variables

```env
VITE_TURSO_DATABASE_URL=your_turso_url
VITE_TURSO_AUTH_TOKEN=your_turso_token
VITE_OPENAI_API_KEY=sk-...   # Optional — enables AI schedule import
```

---

## Project Structure

```
showrunner/
├── src/                        # Web app (React + Vite)
│   ├── App.tsx                 # Root — auth, routing, state
│   ├── components/
│   │   ├── LiveMode.tsx        # Full-screen show runner
│   │   ├── ShowDetail.tsx      # Per-show management hub
│   │   ├── sections/
│   │   │   ├── PerformersSection.tsx   # Lineup management
│   │   │   ├── PerformerProfile.tsx    # Per-performer profile view
│   │   │   ├── ScheduleSection.tsx     # Cue builder + AI import
│   │   │   ├── ExpensesSection.tsx     # Budget tracking
│   │   │   └── ...
│   └── utils/
│       ├── secure-storage.ts   # E2E encryption layer
│       ├── aiExtractor.ts      # OpenAI + PDF.js pipeline
│       └── pdfExport.ts        # Client-side PDF generation
│
├── app/                        # Mobile app (Expo Router)
├── desktop/                    # Electron wrapper
├── components/                 # Shared mobile components
└── utils/                      # Shared mobile utilities
```

---

## Build & Deploy

```bash
# Web production build
npm run build          # Output: dist/
vercel --prod          # Deploy to Vercel

# macOS desktop
npm run build:mac      # Universal .dmg → dist-electron/

# Android
npm run build:android  # Production AAB (Google Play)
npm run download:android  # Direct-install APK

# iOS
npm run build:ios      # App Store build via EAS
npm run build:ios:submit  # Build + submit to TestFlight
```

---

## License

MIT
