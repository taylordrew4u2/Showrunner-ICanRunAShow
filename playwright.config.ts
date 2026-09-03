import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end configuration.
 *
 * The suite runs against a production build served by `vite preview`, not the
 * dev server: the service worker, the precache manifest and the minified
 * bundle are all part of what ships, and a dev-only pass would not exercise
 * them.
 *
 * `PW_CHROMIUM_PATH` is an escape hatch for sandboxes that already have a
 * Chromium on disk and cannot download Playwright's pinned build. CI installs
 * the pinned one and ignores this.
 */
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

/**
 * `--no-sandbox` because container images commonly run as root, where
 * Chromium's sandbox refuses to start. The browser only ever loads this app
 * from localhost, so there is nothing untrusted for the sandbox to contain.
 */
const launchOptions = { args: ['--no-sandbox'], ...(executablePath ? { executablePath } : {}) };

export default defineConfig({
  testDir: './e2e',
  // Every spec drives a real sign-up and onboarding, so these are slower than
  // unit tests by nature; the timeout is generous rather than flaky-tight.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    launchOptions,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], launchOptions } },
    // The primary surface: this is an app operated from a phone in a venue.
    //
    // Pinned to Chromium rather than the descriptor's default WebKit. This
    // buys the viewport, the touch behaviour and the device pixel ratio
    // without a second browser download in CI — but it is emulation, not
    // Safari, so a WebKit-specific rendering bug would slip past. Adding a
    // real WebKit project is the honest next step if that ever bites.
    {
      name: 'phone',
      use: { ...devices['iPhone 13'], browserName: 'chromium', launchOptions },
    },
  ],
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
