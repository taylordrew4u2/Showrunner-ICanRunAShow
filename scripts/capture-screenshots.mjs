// Automated product-screenshot capture for the README.
//
// Drives the live (or local) app with Playwright: logs in (creating the account
// if needed), seeds a demo show with performers + a run-of-show when the account
// is empty, then captures the showcased screens at phone width into
// docs/screenshots/.
//
// Usage:
//   npm i -D playwright && npx playwright install chromium
//   DEMO_USER=demo DEMO_PASS=demo1234 APP_URL=https://icanrunashow.com \
//     node scripts/capture-screenshots.mjs
//
// Env:
//   APP_URL    target app (default https://icanrunashow.com)
//   DEMO_USER  account username (default "demo")
//   DEMO_PASS  account password (default "demo1234")
//   OUT_DIR    output folder (default docs/screenshots)
//   HEADLESS   "false" to watch it run (default true)
//
// Note: uses a throwaway demo account. Never point DEMO_USER/DEMO_PASS at a real
// account — the seed step assumes it can populate an empty workspace.

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const APP_URL = process.env.APP_URL || 'https://icanrunashow.com';
const USER = process.env.DEMO_USER || 'demo';
const PASS = process.env.DEMO_PASS || 'demo1234';
const OUT_DIR = process.env.OUT_DIR || 'docs/screenshots';
const HEADLESS = process.env.HEADLESS !== 'false';

const log = (...a) => console.log('•', ...a);

async function shot(page, name) {
  await page.waitForTimeout(500); // let any transition settle
  const path = `${OUT_DIR}/${name}.png`;
  await page.screenshot({ path });
  log(`captured ${path}`);
}

/** Sign in; if the credentials don't exist yet, create the account + onboard. */
async function signInOrUp(page) {
  await page.goto(APP_URL, { waitUntil: 'networkidle' });

  // Already signed in (restored session)?
  if (await page.getByRole('button', { name: 'Menu' }).count()) return;

  await page.getByPlaceholder('Enter username').fill(USER);
  await page.getByPlaceholder('Enter your password').fill(PASS);
  await page.getByRole('button', { name: /^Sign In$/ }).click();

  // Either we're in, or the credentials are invalid → switch to sign-up.
  const inApp = page.getByRole('button', { name: 'Menu' });
  const err = page.locator('.login__error');
  await Promise.race([
    inApp.waitFor({ timeout: 8000 }).catch(() => {}),
    err.waitFor({ timeout: 8000 }).catch(() => {}),
  ]);

  if (await inApp.count()) {
    log('signed in to existing account');
    return;
  }

  log('account not found — creating it');
  await page.getByRole('button', { name: /New here\? Create Account/ }).click();
  await page.getByPlaceholder('Enter username').fill(USER);
  await page.getByPlaceholder('Enter your password').fill(PASS);
  await page.getByRole('button', { name: /^Create Account$/ }).click();

  // Onboarding wizard.
  await page.getByRole('button', { name: 'Get started' }).click({ timeout: 8000 });
  await page.getByRole('button', { name: /^Comedy$/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByPlaceholder(/Late Night Laughs/).fill('Late Night Laughs');
  await page.getByRole('button', { name: 'Finish' }).click();
  await page.getByRole('button', { name: 'Menu' }).waitFor({ timeout: 10000 });
  log('account created + onboarded');
}

async function openNewShowForm(page) {
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: 'New Show' }).click();
  await page.locator('.show-form').waitFor();
}

async function expandSection(page, title) {
  const section = page.locator('.accordion-section', { hasText: title }).first();
  // Only click to expand if its content isn't already shown.
  if (!(await section.locator('.accordion-section__content').count())) {
    await section.locator('.accordion-section__header').first().click();
  }
  return section;
}

/** Create one populated demo show so the screenshots look real. */
async function seedShow(page) {
  log('seeding a demo show');
  await openNewShowForm(page);
  await page.getByPlaceholder('Show name').fill('Friday Night Comedy');
  await page.locator('.show-form__input[type="date"]').fill('2026-07-17');
  await page.getByPlaceholder('e.g. 8:00 PM').fill('8:00 PM');
  await page.getByPlaceholder('Venue name').fill('The Basement');
  await page.getByPlaceholder(/City, address/).fill('Brooklyn, NY');
  await page.locator('.show-form').getByRole('button', { name: 'Save' }).click();

  // We land on the new show's detail page. Add a few performers.
  await page.locator('.show-detail').waitFor();
  const performers = ['Corey Cooley', 'Maya Reyes', 'Dev Okafor', 'Sam Tran'];
  await expandSection(page, 'Performers');
  for (const name of performers) {
    await page.getByPlaceholder('Performer name').fill(name);
    await page.getByPlaceholder('@instagram').fill('@' + name.toLowerCase().replace(/\s+/g, ''));
    await page.locator('.section-add-row').getByRole('button', { name: 'Add' }).click();
    await page.waitForTimeout(150);
  }

  // Build a short run-of-show.
  await expandSection(page, 'Schedule');
  const buildBtn = page.getByRole('button', { name: 'Build Your Own' });
  if (await buildBtn.count()) await buildBtn.click();
  const cues = [
    ['8:00 PM', 'Doors + house music'],
    ['8:15 PM', 'Host intro'],
    ['8:20 PM', 'Corey Cooley'],
    ['8:35 PM', 'Maya Reyes'],
    ['8:50 PM', 'Dev Okafor'],
    ['9:05 PM', 'Headliner: Sam Tran'],
  ];
  for (const [time, desc] of cues) {
    await page.getByPlaceholder('8:00 PM').fill(time);
    await page.getByPlaceholder('Add a cue...').fill(desc);
    await page.getByRole('button', { name: 'Add cue' }).click();
    await page.waitForTimeout(150);
  }

  // Collapse the open sections so the detail shot reads as an overview.
  await expandSection(page, 'Schedule');
  await expandSection(page, 'Performers');
  await page.locator('.show-detail').evaluate((el) => el.scrollTo(0, 0));
}

async function captureRunShow(page) {
  await page.locator('.show-detail__run-show').click();
  await page.locator('.run-show').waitFor();
  const start = page.getByRole('button', { name: /^Start$/ });
  if (await start.count()) await start.click();
  await page.waitForTimeout(1200); // let the timer tick
  await shot(page, 'run-show');
  await page.keyboard.press('Escape');
  await page.locator('.show-detail').waitFor();
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({
    viewport: { width: 430, height: 932 }, // a roomy phone
    deviceScaleFactor: 2, // crisp @2x output
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);

  try {
    await signInOrUp(page);

    // Seed only if the workspace is empty.
    const hasShow = await page.locator('.show-card:not(.rolodex-tile)').count();
    if (!hasShow) {
      await seedShow(page);
    } else {
      log('account already has shows — capturing as-is');
      await page.locator('.show-card:not(.rolodex-tile)').first().click();
      await page.locator('.show-detail').waitFor();
    }

    // 1) Show detail (we're already on it after seeding/opening).
    await shot(page, 'show-detail');

    // 2) Run Show live mode.
    await captureRunShow(page);

    // 3) Shows dashboard.
    await page.locator('.show-detail .btn--ghost', { hasText: 'Back' }).first().click();
    await page.locator('.shows-list').waitFor();
    await shot(page, 'shows');

    log('done');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('screenshot capture failed:', err);
  process.exit(1);
});
