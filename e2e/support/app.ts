import { expect, type Page } from '@playwright/test';

/**
 * Getting to the part of the app a test is actually about.
 *
 * Every spec starts from a cold account, because the app has no other entry:
 * the encryption key is derived from the password at sign-in, so there is no
 * way to seed a logged-in session from outside the browser.
 */

export async function signUp(page: Page, username = 'producer'): Promise<void> {
  await page.goto('/');
  await page.getByPlaceholder('Enter username').fill(username);
  await page.getByPlaceholder('Enter your password').fill('correct horse battery staple');
  await page.locator('.login__button').first().click();
}

/** Walk the first-run questions, choosing a show type where one is required. */
export async function completeOnboarding(page: Page): Promise<void> {
  const nav = page.locator('.bottom-nav__item').first();
  const ADVANCE = 'button:text-matches("^(Next|Continue|Skip|Get started|Done|Finish)$", "i")';

  // Sign-in is asynchronous — key derivation, then a first load — so the next
  // screen is not on the page the instant the button is clicked. Waiting for
  // *either* outcome rather than a fixed delay: a fresh account lands on
  // onboarding, a returning one straight on the nav.
  await page.waitForSelector(`.bottom-nav__item, ${ADVANCE}`, { timeout: 30_000 });

  for (let step = 0; step < 14; step++) {
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

/** Create a show and land on its page. Blocks default to lineup + schedule. */
export async function createShow(page: Page, name: string, date = '2026-09-20'): Promise<void> {
  await page.locator('button').filter({ hasText: /New Show/i }).first().click();
  await page.getByPlaceholder('Show name').fill(name);
  await page.locator('input[type=date]').fill(date);
  await page.locator('button').filter({ hasText: /^Save$/ }).last().click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
}

/** Open one of the collapsible sections on a show page by its title. */
export async function openSection(page: Page, title: string): Promise<void> {
  await page.locator('button, [role=button]').filter({ hasText: title }).first().click();
}

export function gotoTab(page: Page, label: string) {
  return page.locator('.bottom-nav__item', { hasText: label }).click();
}
