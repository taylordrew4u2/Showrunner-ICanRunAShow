# Showrunner

> A professional live-show organizer with AI-powered schedule import, multi-device sync, and end-to-end encryption.

Showrunner is a comprehensive show management platform available on **mobile** (iOS & Android), **web**, and **desktop** (macOS). Designed for producers, stage managers, and event coordinators.

## 🌐 Live Demo

**Web App:** [https://showrunner-theta.vercel.app](https://showrunner-theta.vercel.app)

## Tech Stack

- **Mobile:** React Native with Expo SDK 54 + Expo Router v4
- **Web:** React 19 + Vite 7 + PWA support
- **Desktop:** Electron 40 (wraps Vite web build for macOS)
- **Database:** Turso (libSQL) with end-to-end encryption
- **AI Integration:** OpenAI GPT-4o-mini (text & vision)
- **PDF Processing:** PDF.js for client-side extraction
- **Language:** TypeScript throughout
- **Styling:** Custom CSS with black/white/red theme

## ✨ Features

### Core Capabilities
- 📅 **Schedule Management** – Plan timelines with drag-and-drop organization
- 🎤 **Cast & Crew Tracking** – Manage artists, performers, hosts, and staff
- 🎵 **Music Coordination** – Track DJ sets, playlists, and music cues
- 💰 **Budget Tracking** – Monitor expenses and financial planning
- 📄 **PDF Export** – Generate professional show rundowns

### AI-Powered Features
- 🤖 **Smart Import** – Upload schedule files (text, PDF, or images) and let AI extract data automatically
- 🖼️ **Vision Recognition** – Upload screenshots or photos of schedules for instant import
- 📄 **PDF Processing** – Extract text from multi-page PDF documents
- ✨ **Intelligent Parsing** – Handles various time formats and layouts

### Security & Sync
- 🔒 **End-to-End Encryption** – All data encrypted at rest and in transit
- 🔄 **Multi-Device Sync** – Seamless access across web, mobile, and desktop
- 👤 **Private by Default** – No third-party tracking or data sharing

### Design
- 🎨 **Modern UI** – Clean black/white/red color scheme
- 📱 **Responsive** – Optimized for all screen sizes
- ⚡ **Fast** – Built with Vite for instant hot-reload

## 🚀 Quick Start

### For Users

1. **Web App (Instant Access):**
   - Visit [https://showrunner-theta.vercel.app](https://showrunner-theta.vercel.app)
   - No installation required, works in any modern browser
   - Full feature parity with mobile/desktop apps

2. **Mobile Apps:**
   - **Android:** Download APK from [Releases](../../releases)
   - **iOS:** TestFlight link (coming soon)

3. **Desktop (macOS):**
   - Download `.dmg` from [Releases](../../releases)
   - Install to Applications folder

### For Developers

```bash
# Clone and install
git clone https://github.com/taylordrew4u2/showrunner.git
cd showrunner
npm install

# Set up environment
cp .env.example .env.local
# Edit .env.local with your API keys

# Start development server
npm run dev  # Web (http://localhost:5173)
npm run start  # Mobile (Expo)
npm run mac  # Desktop (Electron)
```

---

## 🌐 Web App

**Live at:** [https://showrunner-theta.vercel.app](https://showrunner-theta.vercel.app)

The web app runs in any modern browser with full feature parity to the mobile and desktop apps. All data is encrypted and synced through your account.

### Browser Support
- ✅ Chrome/Edge 90+
- ✅ Firefox 88+
- ✅ Safari 14+

### PWA Support
Install as a Progressive Web App for offline access and native-like experience:
1. Visit the web app
2. Click "Install" in your browser's address bar
3. Access from your home screen or app launcher

---

## Run on Mac (desktop, no simulator)

Showrunner ships an Electron wrapper around the Vite web build so you can run it as a native macOS desktop app — **no iOS Simulator required**.

Data is synced through your account to the cloud database, just like the web and mobile apps.

### Prerequisites

```bash
npm install
```

### Start in development mode (live-reload)

```bash
npm run mac
```

This command starts the Vite dev server and opens a native macOS window pointing at `http://localhost:5173`. Changes to `src/` are reflected instantly.

### Build a distributable `.app` / `.dmg`

```bash
npm run build:mac
```

This command:

1. Compiles the web app to `dist/` via Vite.
2. Packages it into a macOS `.dmg` (universal: x64 + arm64) using electron-builder.

The output is written to `dist-electron/`. Open the `.dmg` to install **Showrunner.app** to your Applications folder.

---

## Data & auth model

- **Authentication:** Password-based account system (no OAuth).
- **Storage:** All data is encrypted and stored in a Turso database (libSQL).
- **Security:** End-to-end encryption ensures your show data is private.
- **Sync:** Data syncs across all your devices when you sign in.

## Download the app (users)

Go to the [Releases](../../releases) page on GitHub, find the latest release, and download **showrunner.apk**. Install it on your Android device — no account or build tools needed.

> **iOS:** Apple does not allow direct APK-style installs. iOS builds are distributed via TestFlight. See the developer section below for details.

---

## Build it yourself (developers)

This project is configured to produce installable mobile binaries using Expo Application Services (EAS).

### 1) Install dependencies

```bash
npm install
```

### 2) Initialize EAS project linkage (developer build step only)

`eas login` is only needed for **developers** creating cloud builds with Expo EAS.

**End users** sign in with their Showrunner account credentials after installing the app.

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

### Mobile (Expo)

Start the Expo dev server (choose your target):

```bash
npm run start    # interactive menu — choose web, iOS, or Android
npm run ios      # iOS Simulator (requires Xcode on Mac)
npm run android  # Android emulator / device
```

### Web (Vite)

Start the Vite web development server:

```bash
npm run dev      # Opens at http://localhost:5173
```

### Desktop (Electron + Vite)

Start the macOS desktop app with live-reload:

```bash
npm run mac      # Vite dev + Electron window
```

### Environment variables

Create a `.env` file in the project root:

```env
VITE_TURSO_DATABASE_URL=your_turso_database_url
VITE_TURSO_AUTH_TOKEN=your_turso_auth_token

# Optional: OpenAI API key for AI-powered schedule import
VITE_OPENAI_API_KEY=sk-your-openai-api-key-here
```

> **⚠️ Security Note:** Never commit your `.env` file or hardcode credentials in source files. The database credentials in `src/utils/db.ts` should be replaced with environment variables in production.

#### AI-Powered Schedule Import (Optional)

Enable intelligent schedule extraction from documents and images:

**Setup:**
1. Get an OpenAI API key from [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Add to your `.env.local`:
   ```env
   VITE_OPENAI_API_KEY=sk-proj-your-actual-openai-key-here
   ```
3. Restart the dev server

**Supported File Types:**
- 📝 **Text files:** `.txt`, `.csv`, `.json`
- 📄 **PDF documents:** Multi-page PDFs with full text extraction
- 🖼️ **Images:** `.jpg`, `.png`, `.gif`, `.bmp`, `.webp` (screenshots, photos, scans)

**How It Works:**
- **GPT-4o-mini** analyzes your document/image
- Extracts times in any format (12h/24h, AM/PM, etc.)
- Intelligently parses event descriptions
- Handles various layouts and formats
- Falls back to regex parsing if AI unavailable

**Example Input Formats:**

```text
# Simple format
7:00 PM - Doors open
7:30 PM - Opening performance
8:00 PM - Main show begins

# 24-hour format
19:00 Soundcheck complete
19:30 Doors
20:00 Show start

# Informal format
Show starts at 8pm
9:30 - intermission break
Ends around 11
```

**Image Support:**
- Upload photos of printed schedules
- Screenshot schedules from emails/documents
- Scan handwritten rundowns
- AI Vision extracts all visible schedule data

**Usage:**
1. Navigate to any show's Schedule section
2. Click "📁 Import Schedule from File"
3. Select your file (text, PDF, or image)
4. AI extracts and adds all items automatically
5. Review and edit as needed

## 🚀 Build for Production

### Web

**Build:**
```bash
npm run build    # Output: dist/
```

**Deploy to Vercel (Recommended):**
```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel          # Preview deployment
vercel --prod   # Production deployment
```

**Other Hosting Options:**
- **Netlify:** Drag & drop the `dist/` folder
- **GitHub Pages:** Use `gh-pages` package
- **AWS S3:** Upload `dist/` to S3 bucket
- **Cloudflare Pages:** Connect your repo

**Environment Variables for Production:**
Make sure to set these in your hosting platform:
- `VITE_TURSO_DATABASE_URL`
- `VITE_TURSO_AUTH_TOKEN`
- `VITE_OPENAI_API_KEY` (optional, for AI import)

### Mobile

**Android:**
```bash
npm run build:android  # Production AAB for Google Play
npm run download:android  # APK for direct install
```

**iOS:**
```bash
npm run build:ios  # Production build for App Store
npm run build:ios:submit  # Build and submit to TestFlight
```

### Desktop

**macOS:**
```bash
npm run build:mac  # Creates .dmg in dist-electron/
```

The DMG is a universal binary (Intel + Apple Silicon) ready for distribution.

---

## 📁 Project Structure

```text
📦 showrunner/
├── 📱 app/                    # Mobile app (Expo + React Native)
│   ├── _layout.tsx           # Root navigation layout
│   ├── index.tsx             # Home screen (show list)
│   ├── settings.tsx          # App settings
│   └── show/[id].tsx         # Show detail screen
│
├── 🌐 src/                    # Web app (Vite + React)
│   ├── App.tsx               # Root component
│   ├── components/           # Web UI components
│   │   ├── Login.tsx         # Authentication
│   │   ├── ShowCard.tsx      # Show list item
│   │   ├── ShowDetail.tsx    # Show detail view
│   │   ├── ShowForm.tsx      # Create/edit show
│   │   ├── Settings.tsx      # App settings
│   │   ├── Modal.tsx         # Modal dialog
│   │   ├── SceneList.tsx     # Scene management
│   │   └── sections/         # Section components
│   │       ├── BasicInfoSection.tsx
│   │       ├── ScheduleSection.tsx (AI import here)
│   │       ├── ArtistsSection.tsx
│   │       ├── PerformersSection.tsx
│   │       ├── HostsSection.tsx
│   │       ├── StaffSection.tsx
│   │       ├── DJMusicSection.tsx
│   │       └── ExpensesSection.tsx
│   ├── utils/                # Web utilities
│   │   ├── db.ts             # Turso database client
│   │   ├── encryption.ts     # E2E encryption
│   │   ├── secure-storage.ts # Encrypted storage
│   │   ├── aiExtractor.ts    # AI import (OpenAI + PDF.js)
│   │   ├── pdfExport.ts      # PDF generation
│   │   └── id.ts             # ID generation
│   └── types/                # TypeScript types
│
├── 🔧 components/             # Shared mobile components
│   ├── ShowCard.tsx          # Mobile show card
│   ├── SectionHeader.tsx     # Section headers
│   └── sections/             # Mobile sections
│
├── ⚙️ utils/                  # Shared mobile utilities
│   ├── db.ts                 # Mobile database
│   ├── storage.ts            # AsyncStorage wrapper
│   ├── encryption.ts         # Mobile encryption
│   ├── pdfExport.ts          # Mobile PDF export
│   └── types.ts              # Mobile types
│
├── 🖥️ desktop/                # Electron wrapper
│   └── main.js               # Electron main process
│
├── 📦 public/                 # Static web assets
│   └── icons/                # App icons
│
├── 🛠️ scripts/                # Build scripts
│   └── run-mac.sh            # macOS dev script
│
├── 📄 Configuration Files
│   ├── package.json          # Dependencies & scripts
│   ├── vite.config.ts        # Vite configuration
│   ├── app.json              # Expo configuration
│   ├── eas.json              # EAS Build profiles
│   ├── electron-builder.yml  # Electron packaging
│   ├── vercel.json           # Vercel deployment
│   ├── tsconfig.json         # TypeScript config
│   └── eslint.config.js      # ESLint rules
│
└── 📝 Documentation
    └── README.md             # This file
```

## 🤝 Contributing

Contributions are welcome! Here's how you can help:

### Ways to Contribute

- 🐛 **Report bugs:** Open an issue with details and reproduction steps
- ✨ **Suggest features:** Share your ideas in GitHub Discussions
- 📝 **Improve docs:** Fix typos or add clarifications
- 💻 **Submit code:** Fork, branch, code, test, and PR!

### Development Workflow

1. **Fork and clone:**
   ```bash
   git clone https://github.com/YOUR_USERNAME/showrunner.git
   cd showrunner
   npm install
   ```

2. **Create a feature branch:**
   ```bash
   git checkout -b feature/your-feature-name
   ```

3. **Make your changes:**
   - Write clean, typed TypeScript
   - Follow existing code style
   - Test on web and mobile if applicable
   - Update README if needed

4. **Test your changes:**
   ```bash
   npm run dev      # Test web app
   npm run start    # Test mobile app
   npm run lint     # Check for errors
   ```

5. **Commit and push:**
   ```bash
   git add .
   git commit -m "feat: add your feature description"
   git push origin feature/your-feature-name
   ```

6. **Open a Pull Request:**
   - Describe what you changed and why
   - Link any related issues
   - Wait for review and feedback

### Code Style

- Use TypeScript strict mode
- Follow existing naming conventions
- Keep functions small and focused
- Add comments for complex logic
- Use functional components and hooks

### Questions?

Open an issue or discussion if you need help getting started!

## 📄 License

MIT License - feel free to use this project for personal or commercial purposes.

See [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- **OpenAI** for GPT-4o-mini API
- **Turso** for serverless database
- **Vercel** for hosting
- **Expo** for mobile framework
- **PDF.js** for PDF processing

---

**Built with ❤️ by the Showrunner team**

🌟 Star this repo if you find it useful!

📢 Share with others who might benefit from it!


