import { expect, type Page } from '@playwright/test';

/**
 * Getting to the part of the app a test is actually about.
 *
 * Every spec starts from a cold account, because the app has no other entry:
 * the encryption key is derived from the password at sign-in, so there is no
 * way to seed a logged-in session from outside the browser.
 */

/** The password every spec's producer signs up with. */
export const PASSWORD = 'correct horse battery staple';

/**
 * Create the account, the way a producer does on their first visit.
 *
 * The screen opens on Sign In, and the fake server — like the real one —
 * refuses a login for an account that was never made. So this is a sign-up:
 * over to Create Account, then the button that actually creates it.
 */
export async function signUp(page: Page, username = 'producer'): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New here? Create Account' }).click();
  await page.getByPlaceholder('Enter username').fill(username);
  await page.getByPlaceholder('Enter your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create Account', exact: true }).click();
}

/** Sign in to an account that already exists, from the screen the app opens on. */
export async function signIn(page: Page, username: string, password: string): Promise<void> {
  await page.getByPlaceholder('Enter username').fill(username);
  await page.getByPlaceholder('Enter your password').fill(password);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
}

/** Walk the first-run questions, choosing a show type where one is required. */
export async function completeOnboarding(page: Page): Promise<void> {
  const nav = page.locator('.app-main');
  const ADVANCE = 'button:text-matches("^(Next|Continue|Skip|Get started|Done|Finish)$", "i")';

  // Sign-in is asynchronous — key derivation, then a first load — so the next
  // screen is not on the page the instant the button is clicked. Waiting for
  // *either* outcome rather than a fixed delay: a fresh account lands on
  // onboarding, a returning one straight on the nav.
  await page.waitForSelector(`.app-main, ${ADVANCE}`, { timeout: 30_000 });

  for (let step = 0; step < 14; step++) {
    // Between steps the page may briefly show neither: the skeleton while the
    // account loads sits between sign-up and onboarding. A count taken in that
    // gap read as "no more steps" and left the walk on the welcome screen.
    await expect
      .poll(async () => (await nav.isVisible().catch(() => false)) || (await page.locator(ADVANCE).count()) > 0)
      .toBe(true);
    if (await nav.isVisible().catch(() => false)) break;
    const advance = page.locator(ADVANCE);
    if ((await advance.count()) === 0) break;
    if (await advance.last().isDisabled()) {
      // A step that gates its button on an answer. Any show type will do.
      const choice = page.locator('button').filter({ hasText: /^Comedy$/ });
      if ((await choice.count()) === 0) break;
      await choice.first().click();
      await expect(advance.last()).toBeEnabled();
    }
    await advance.last().click();
  }

  await expect(nav).toBeVisible();
}

export async function signUpAndOnboard(page: Page): Promise<void> {
  await signUp(page);
  await completeOnboarding(page);
}

/**
 * A calendar date `days` from today, as the `YYYY-MM-DD` a date input takes.
 *
 * Local time, not UTC: the app reads a show's date as a local calendar day,
 * and a fixture built from `toISOString()` would name tomorrow to a test
 * running in the evening on a US machine.
 */
export function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Create a show and land on its page. Blocks default to lineup + schedule.
 *
 * The date is relative to today on purpose. A fixed date was fine until the
 * calendar caught up with it: the Shows page leads with the next show still
 * ahead, and three specs about that panel failed the morning after the
 * fixture's date had passed.
 */
export async function createShow(page: Page, name: string, date = daysFromNow(10)): Promise<void> {
  await page.locator('button').filter({ hasText: /New Show/i }).first().click();
  await page.getByPlaceholder('Show name').fill(name);
  await page.locator('input[type=date]').fill(date);
  await page.locator('button').filter({ hasText: /^Save$/ }).last().click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
  // Most fixture callers immediately populate the lineup. The new overview
  // starts with compact cards, so open its editor explicitly for those callers.
  await page.locator('#show-section-header-performers').click();
}

/** Open one of the collapsible sections on a show page by its title. */
export async function openSection(page: Page, title: string): Promise<void> {
  await page.locator('button, [role=button]').filter({ hasText: title }).first().click();
}

export async function gotoTab(page: Page, label: string) {
  await page.locator('.app-main').waitFor();
  const item = page.locator('.bottom-nav__item', { hasText: label });
  const menu = page.getByRole('button', { name: 'Open navigation menu' });
  /*
   * Wait for one of the two navs to actually be usable before choosing
   * between them.
   *
   * The bottom bar and the menu button swap on width, and the swap is a
   * re-render — so a test that changes the viewport and immediately navigates
   * could read both as invisible: the old bar still in the DOM but hidden, the
   * menu not yet painted. It then clicked the hidden bar and waited out the
   * timeout. Rare enough to pass locally and fail on CI, which is the worst
   * kind.
   */
  // A poll rather than a locator assertion: both navs are in the DOM at the
  // same time, one of them merely hidden, so matching either in one locator
  // is a strict-mode violation.
  await expect
    .poll(async () => (await item.isVisible()) || (await menu.isVisible()))
    .toBe(true);
  if (!(await item.isVisible())) {
    await menu.click();
    await expect(item).toBeVisible();
  }
  return item.click();
}
