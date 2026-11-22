import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Show } from '../src/types';
import { decryptWithKey } from '../src/utils/encryption';
import { addCoproducerLink, emptyState, installFakeApi } from './support/fake-api.mjs';
import { createShow, gotoTab, PASSWORD, signIn, signUpAndOnboard } from './support/app';
import { accountKeys, openAsCoproducer } from './support/coproducer';

/**
 * The guided tour and the Help & setup page.
 *
 * Both are optional, so half of what is checked here is what they leave
 * alone: the page behind the offer still works, the tour changes nothing but
 * adding the sample show, and co-producer view gets neither.
 */

const SAMPLE = /Sample Show/;

/** The guide's card on the page. Inside Run Show it is the board's own. */
const dock = (page: Page): Locator => page.locator('.guide-dock--app');
const boardDock = (page: Page): Locator => page.locator('.run-show').getByRole('region', { name: 'Guide' });
const dockTitle = (page: Page): Locator => dock(page).locator('.guide-dock__title');
const nextStep = (page: Page): Locator => dock(page).getByRole('button', { name: 'Next step' });

async function takeTheTour(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Take the tour' }).click();
  await page.getByRole('button', { name: 'Add it and start' }).click();
  await expect(page.getByRole('heading', { name: SAMPLE, level: 1 })).toBeVisible();
  await expect(dock(page)).toContainText('step 1 of');
}

/** Press "Next step" until the card is on the step with this title. */
async function nextUntil(page: Page, title: string): Promise<void> {
  for (let presses = 0; presses < 40; presses++) {
    if ((await dockTitle(page).textContent()) === title) return;
    const before = await dock(page).locator('.guide-dock__progress').textContent();
    await nextStep(page).click();
    await expect(dock(page).locator('.guide-dock__progress')).not.toHaveText(before ?? '');
  }
  throw new Error(`The tour never reached "${title}"`);
}

async function openHelp(page: Page): Promise<void> {
  await gotoTab(page, 'More');
  await page.locator('.more-item').filter({ hasText: 'Help & setup' }).click();
  await expect(page.getByRole('heading', { name: 'Help & setup', level: 1 })).toBeVisible();
}

async function signOutAndIn(page: Page): Promise<void> {
  await expect(page.locator('.sync-status--saved')).toBeVisible();
  await gotoTab(page, 'Settings');
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await signIn(page, 'producer', PASSWORD);
  await expect(page.locator('.app-main')).toBeVisible({ timeout: 30_000 });
}

/**
 * The outlined control is on screen and not under the guide's card. The
 * card is fixed over the page, so a control under it cannot be seen or
 * tapped. Polled: the page settles, and the card can grow, after a step.
 */
async function expectClearOfCard(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => {
    const target = document.querySelector('[data-tour-on]');
    const card = document.querySelector('.guide-dock--app');
    if (!target || !card) return 'missing';
    const t = target.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    if (t.top < 0 || t.bottom > window.innerHeight) return `off screen at ${t.top}-${t.bottom}`;
    if (t.right <= c.left || t.left >= c.right || t.bottom <= c.top) return 'clear';
    return `under the card: ${t.top}-${t.bottom}, card from ${c.top}`;
  }), { timeout: 8_000 }).toBe('clear');
}

/** Focus is somewhere, not dropped to the start of the page. */
const focusKept = (page: Page) => page.evaluate(() => !!document.activeElement && document.activeElement !== document.body);

const wizardRow = (page: Page, title: string): Locator => page.locator('.help-wizard').filter({ has: page.locator('.help-wizard__title', { hasText: title }) });

test.describe('the tour offer', () => {
  test('is offered to a new account and never forced on it', async ({ page, context }) => {
    const state = emptyState();
    await installFakeApi(context, state);
    await signUpAndOnboard(page);

    const offer = page.getByRole('complementary', { name: 'Getting started' });
    await expect(offer).toBeVisible();
    await expect(offer).toContainText('New here?');
    await expect(dock(page)).toHaveCount(0);
    await expect(page.locator('.sync-status--saved')).toBeVisible();
    const settingsAfterOnboarding = state.settings;
    const versionsAfterOnboarding = state.settingsSnapshots.length;

    // The page behind it is the page it always was.
    await page.locator('button').filter({ hasText: /New Show/i }).first().click();
    await expect(page.getByPlaceholder('Show name')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Try a sample show' })).toBeVisible();

    await page.getByRole('button', { name: 'Dismiss the tour offer' }).click();
    await expect(offer).toHaveCount(0);

    // Gone for good on this device, and remembered there: not in the account.
    await signOutAndIn(page);
    await expect(page.getByRole('heading', { name: 'Shows', level: 1 })).toBeVisible();
    await expect(offer).toHaveCount(0);
    expect(state.settings).toBe(settingsAfterOnboarding);
    expect(state.settingsSnapshots.length).toBe(versionsAfterOnboarding);
  });
});

test.describe('what the guide keeps on this device', () => {
  // Another account made later under the same name starts as never opened.
  test('is forgotten when the account is deleted', async ({ page, context }) => {
    await installFakeApi(context, emptyState());
    await signUpAndOnboard(page);
    await page.getByRole('button', { name: 'Dismiss the tour offer' }).click();
    const stored = () => page.evaluate(() => localStorage.getItem('showrunner:guide:producer'));
    await expect.poll(stored).not.toBeNull();

    await gotoTab(page, 'Settings');
    await page.locator('.settings__details-summary').filter({ hasText: 'Delete account' }).click();
    await page.getByLabel(/Type your username/).fill('producer');
    await page.getByRole('button', { name: 'Delete my account' }).click();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible({ timeout: 30_000 });
    expect(await stored()).toBeNull();
  });
});

test.describe('the guided tour', () => {
  test('walks every part of the app on the sample show and changes nothing else', async ({ page, context }) => {
    test.setTimeout(120_000);
    const state = emptyState();
    await installFakeApi(context, state);
    await signUpAndOnboard(page);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await takeTheTour(page);
    await expect(dockTitle(page)).toHaveText('This is a show');
    await expect(page.locator('[data-tour="show-hero"][data-tour-on]')).toBeVisible();
    await expect(dock(page).getByRole('button', { name: 'Previous step' })).toHaveCount(0);

    await nextStep(page).click();
    await expect(dockTitle(page)).toHaveText('Your shows');
    await expect(page.getByRole('heading', { name: 'Shows', level: 1 })).toBeVisible();
    await expect(page.locator('[data-tour-on]')).toHaveCount(1);

    await nextUntil(page, 'The lineup');
    await expect(page.getByRole('heading', { name: SAMPLE, level: 1 })).toBeVisible();
    await expect(page.locator('#show-section-header-performers')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('[data-tour-on]')).toHaveCount(1);

    await nextUntil(page, 'Run the night');
    await expect(page.locator('[data-tour="show-run"][data-tour-on]')).toBeVisible();
    await page.locator('.show-detail__run-show').click();

    // Inside the board the card is the board's own, and the page's is gone.
    await expect(boardDock(page)).toContainText('The clock');
    await expect(dock(page)).toHaveCount(0);
    await expect(page.locator('[data-tour="run-clock"][data-tour-on]')).toBeVisible();
    await expect(boardDock(page).getByRole('button', { name: 'Previous step' })).toHaveCount(0);
    await boardDock(page).getByRole('button', { name: 'Next step' }).click();
    await expect(boardDock(page)).toContainText('The soundboard');
    await boardDock(page).getByRole('button', { name: 'Next step' }).click();
    await expect(boardDock(page)).toContainText('Leaving the board');
    // Closing the board is the way on.
    await expect(boardDock(page).getByRole('button', { name: 'Next step' })).toHaveAttribute('aria-disabled', 'true');
    await page.getByRole('button', { name: 'Close run show' }).click();
    await expect(page.locator('.run-show')).toHaveCount(0);
    await expect(dockTitle(page)).toHaveText('Viewer link');

    await nextUntil(page, 'The Rolodex');
    await expect(page.getByRole('heading', { name: /Rolodex/, level: 1 })).toBeVisible();
    await nextUntil(page, 'Contracts');
    await expect(page.getByRole('heading', { name: 'Contracts', level: 1 })).toBeVisible();
    await expect(page.locator('[data-tour="contracts-add"][data-tour-on]')).toBeVisible();
    await nextUntil(page, 'Your data');
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
    await expect(page.locator('[data-tour="settings-data"][data-tour-on]')).toBeVisible();

    await nextUntil(page, 'That is the tour');
    await expect(page.getByRole('heading', { name: 'Help & setup', level: 1 })).toBeVisible();
    await expect(nextStep(page)).toHaveCount(0);
    await dock(page).getByRole('button', { name: 'Finish tour' }).click();
    await expect(dock(page)).toHaveCount(0);
    await expect(page.locator('[data-tour-on]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Take the tour again' })).toBeVisible();

    // Nothing was made but the sample show: nobody filed, nothing sent, no link.
    await gotoTab(page, 'Rolodex');
    await expect(page.locator('.rolodex__item')).toHaveCount(0);
    await gotoTab(page, 'More');
    await page.locator('.more-item').filter({ hasText: 'Contracts' }).click();
    await expect(page.getByText('Signed agreements and signature requests')).toBeVisible();
    await expect(page.locator('.sync-status--saved')).toBeVisible();
    const { key } = accountKeys();
    const shows = state.shows.map((row: { encryptedData: string }) => decryptWithKey<Show>(row.encryptedData, key));
    expect(shows).toHaveLength(1);
    expect(shows[0].sample).toBe(true);
    expect(shows[0].viewToken).toBeUndefined();
    expect(shows[0].performers).toEqual([]);
    expect(Object.keys(state.live)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('can be stopped, and picked up later where it was left', async ({ page, context }) => {
    await installFakeApi(context, emptyState());
    await signUpAndOnboard(page);
    await takeTheTour(page);
    await nextUntil(page, 'Saved as you work');
    await expect(dock(page)).toContainText('step 5 of');

    await dock(page).getByRole('button', { name: 'End tour' }).press('Enter');
    await expect(dock(page)).toContainText('Tour closed. Pick it up again from More, then Help & setup.');
    await expect(page.locator('[data-tour-on]')).toHaveCount(0);
    // The note's OK takes the place of the button pressed, and then focus goes back to the page.
    const ok = dock(page).getByRole('button', { name: 'OK' });
    await expect(ok).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dock(page)).toHaveCount(0);
    expect(await focusKept(page)).toBe(true);
    await expect(page.getByRole('complementary', { name: 'Getting started' })).toContainText('You stopped the tour at step 5.');

    // It never reopens itself on a cold start.
    await signOutAndIn(page);
    await expect(dock(page)).toHaveCount(0);

    await openHelp(page);
    await page.getByRole('button', { name: /^Resume the tour \(step 5 of/ }).click();
    await expect(dockTitle(page)).toHaveText('Saved as you work');
    await expect(dock(page)).toContainText('step 5 of');
    await expect(page.getByRole('heading', { name: 'Shows', level: 1 })).toBeVisible();
  });

  // Ended early, the sample show would otherwise sit in Shows with nothing said about it.
  test('says the sample show is still there when it is ended early, and deletes it only on a press', async ({ page, context }) => {
    const state = emptyState();
    await installFakeApi(context, state);
    await signUpAndOnboard(page);
    await takeTheTour(page);
    await nextUntil(page, 'Saved as you work');

    await dock(page).getByRole('button', { name: 'End tour' }).press('Enter');
    await expect(dock(page)).toContainText('Tour closed. Pick it up again from More, then Help & setup.');
    await expect(dock(page)).toContainText('The sample show is still in your Shows.');
    const ok = dock(page).getByRole('button', { name: 'OK' });
    await expect(ok).toBeFocused();
    await expect(page.locator('.sync-status--saved')).toBeVisible();
    await expect.poll(() => state.shows.length).toBe(1);

    // Tab reaches the delete button from OK, and Enter on it is the only thing that removes the show.
    await page.keyboard.press('Tab');
    const remove = dock(page).getByRole('button', { name: 'Delete the sample show' });
    await expect(remove).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dock(page)).toHaveCount(0);
    expect(await focusKept(page)).toBe(true);
    await expect(page.getByText('No shows yet')).toBeVisible();
    // Stopped, not finished: it can still be picked up.
    await expect(page.getByRole('complementary', { name: 'Getting started' })).toContainText('You stopped the tour at step 5.');

    // The ordinary delete: gone from the account once it has saved.
    await expect(page.locator('.sync-status--saved')).toBeVisible();
    await expect.poll(() => state.shows.length).toBe(0);
  });

  test('keeps the sample show when the note is just closed', async ({ page, context }) => {
    const state = emptyState();
    await installFakeApi(context, state);
    await signUpAndOnboard(page);
    await takeTheTour(page);
    await nextUntil(page, 'Saved as you work');
    await dock(page).getByRole('button', { name: 'End tour' }).click();
    await dock(page).getByRole('button', { name: 'OK' }).click();
    await expect(dock(page)).toHaveCount(0);
    await expect(page.getByText('No shows yet')).toHaveCount(0);
    await expect(page.locator('.sync-status--saved')).toBeVisible();
    await expect.poll(() => state.shows.length).toBe(1);
  });

  test('asks before putting the sample show back when it is started again', async ({ page, context }) => {
    await installFakeApi(context, emptyState());
    await signUpAndOnboard(page);
    await takeTheTour(page);
    await dock(page).getByRole('button', { name: 'End tour' }).click();
    await dock(page).getByRole('button', { name: 'OK' }).click();

    await page.getByRole('button', { name: 'More show actions' }).click();
    await page.getByRole('menuitem', { name: 'Delete show' }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Shows', level: 1 })).toBeVisible();
    await expect(page.getByText('No shows yet')).toBeVisible();

    await openHelp(page);
    await page.getByRole('button', { name: 'Start again from the beginning' }).click();
    await expect(page.getByRole('dialog', { name: 'Add the sample show?' })).toBeVisible();
    await page.getByRole('button', { name: 'Add it and start' }).click();
    await expect(page.getByRole('heading', { name: SAMPLE, level: 1 })).toBeVisible();
    await expect(dock(page)).toContainText('step 1 of');
  });

  test('offers to put the sample show back when it is deleted part-way', async ({ page, context }) => {
    await installFakeApi(context, emptyState());
    await signUpAndOnboard(page);
    await takeTheTour(page);
    await page.getByRole('button', { name: 'More show actions' }).click();
    await page.getByRole('menuitem', { name: 'Delete show' }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(dockTitle(page)).toHaveText('The sample show is gone');
    await dock(page).getByRole('button', { name: 'Add the sample show' }).click();
    await expect(page.getByRole('heading', { name: SAMPLE, level: 1 })).toBeVisible();
    await expect(dockTitle(page)).toHaveText('This is a show');
  });

  test('stays out of the way of dialogs, the nav and unsaved settings', async ({ page, context }, testInfo) => {
    await installFakeApi(context, emptyState());
    await signUpAndOnboard(page);
    await takeTheTour(page);
    await nextUntil(page, 'Start a show');

    // Under a dialog the card is gone, and back when the dialog closes.
    await page.locator('button').filter({ hasText: /New Show/i }).first().click();
    await expect(page.getByPlaceholder('Show name')).toBeVisible();
    await expect(dock(page)).toBeHidden();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dock(page)).toBeVisible();

    if (testInfo.project.name === 'desktop') {
      // The menu still opens and still navigates with the card showing.
      await page.getByRole('button', { name: 'Open navigation menu' }).click();
      await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
    }
    await gotoTab(page, 'Music');
    await expect(page.getByRole('heading', { name: /Music/, level: 1 })).toBeVisible();
    // Wandering off does not drag the tour along, or snap the page back.
    await expect(dockTitle(page)).toHaveText('Start a show');
    await expect(page.locator('[data-tour-on]')).toHaveCount(0);
    await dock(page).getByRole('button', { name: 'Go to this step' }).click();
    await expect(page.getByRole('heading', { name: 'Shows', level: 1 })).toBeVisible();

    // Settings does not save itself, and the tour does not walk off with it.
    await nextUntil(page, 'Assistants and co-producers');
    await page.getByLabel('Brand name').fill('Basement Comedy');
    await nextStep(page).click();
    const leave = page.getByRole('dialog', { name: 'Leave without saving?' });
    await expect(leave).toBeVisible();
    await leave.getByRole('button', { name: 'Stay' }).click();
    await expect(dockTitle(page)).toHaveText('Assistants and co-producers');
    await expect(page.getByLabel('Brand name')).toHaveValue('Basement Comedy');
  });

  test('can be folded down to see what is under it', async ({ page, context }) => {
    await installFakeApi(context, emptyState());
    await signUpAndOnboard(page);
    await takeTheTour(page);
    await dock(page).getByRole('button', { name: 'Hide the guide card' }).click();
    await expect(dockTitle(page)).toHaveCount(0);
    const pill = dock(page).getByRole('button', { name: /Tour: step 1 of/ });
    await expect(pill).toHaveAttribute('aria-expanded', 'false');
    await pill.click();
    await expect(dockTitle(page)).toHaveText('This is a show');

    // From the keyboard, focus goes to whatever replaces the button pressed.
    const fold = dock(page).getByRole('button', { name: 'Hide the guide card' });
    await fold.press('Enter');
    await expect(pill).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(fold).toBeFocused();
    await expect(dockTitle(page)).toHaveText('This is a show');
  });

  test('keeps the control it points at clear of the card', async ({ page, context }) => {
    test.setTimeout(90_000);
    await installFakeApi(context, emptyState());
    await signUpAndOnboard(page);
    await takeTheTour(page);

    await nextUntil(page, 'More sections');
    await expect(page.locator('[data-tour="show-sections"][data-tour-on], [data-tour="show-more"][data-tour-on]')).toHaveCount(1);
    await expectClearOfCard(page);

    // An empty Music library: the upload button sits high on a short page.
    await nextUntil(page, 'Music');
    await expect(page.locator('[data-tour="music-upload"][data-tour-on]')).toBeVisible();
    await expectClearOfCard(page);

    // Scrolled under the card once the page has settled, the jump brings the
    // control back out before focusing it.
    await page.waitForTimeout(3_500);
    await page.evaluate(() => {
      const card = document.querySelector('.guide-dock--app')!.getBoundingClientRect();
      const target = document.querySelector('[data-tour-on]')!;
      const by = target.getBoundingClientRect().top - card.top - 4;
      (document.scrollingElement ?? document.documentElement).scrollBy(0, by);
    });
    await dock(page).getByRole('button', { name: 'Jump to the control' }).click();
    await expect(page.locator('[data-tour="music-upload"][data-tour-on]')).toBeFocused();
    await expectClearOfCard(page);
  });

  test('works from the keyboard, on the page and inside Run Show', async ({ page, context }) => {
    await installFakeApi(context, emptyState());
    await signUpAndOnboard(page);
    await takeTheTour(page);
    await nextUntil(page, 'Start a show');
    await expect(page.getByRole('region', { name: 'Guide' })).toBeVisible();

    // The card is in the tab order with everything else, not a trap.
    await page.locator('.page-header__title').click();
    let reached = false;
    for (let presses = 0; presses < 60 && !reached; presses++) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(() => document.activeElement?.textContent === 'Next step');
    }
    expect(reached).toBe(true);

    // The keyboard's way to the control the outline shows.
    await expect(page.locator('[data-tour="shows-new"][data-tour-on]')).toBeVisible();
    await dock(page).getByRole('button', { name: 'Jump to the control' }).click();
    await expect(page.locator('[data-tour="shows-new"][data-tour-on]')).toBeFocused();

    // Enter moves the tour, and focus stays on the button that was pressed.
    await nextStep(page).focus();
    await page.keyboard.press('Enter');
    await expect(dockTitle(page)).toHaveText('Getting around');
    await expect(nextStep(page)).toBeFocused();

    await nextUntil(page, 'Run the night');
    await page.locator('.show-detail__run-show').click();
    await expect(boardDock(page)).toContainText('The clock');
    // Tab goes through the card's buttons and the board's, and never leaves the board.
    const visited = new Set<string>();
    for (let presses = 0; presses < 40; presses++) {
      await page.keyboard.press('Tab');
      const where = await page.evaluate(() => {
        const active = document.activeElement;
        return {
          inBoard: !!active?.closest('.run-show'),
          inCard: !!active?.closest('.guide-dock'),
          name: active?.getAttribute('aria-label') ?? active?.textContent ?? '',
        };
      });
      expect(where.inBoard).toBe(true);
      visited.add(`${where.inCard ? 'card' : 'board'}:${where.name}`);
    }
    expect(visited.has('card:Next step')).toBe(true);
    expect(visited.has('card:End tour')).toBe(true);
    expect(visited.has('board:Close run show')).toBe(true);

    // The tour can be ended from inside the board too, and focus stays in the board.
    await boardDock(page).getByRole('button', { name: 'End tour' }).press('Enter');
    await expect(boardDock(page)).toHaveCount(0);
    await expect(page.locator('.run-show')).toBeVisible();
    expect(await page.evaluate(() => !!document.activeElement?.closest('.run-show'))).toBe(true);
  });

  test('says what the free plan holds back without breaking on it', async ({ page, context }) => {
    test.setTimeout(120_000);
    await installFakeApi(context, emptyState({ billingConfigured: true }));
    await signUpAndOnboard(page);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await openHelp(page);
    const contracts = wizardRow(page, 'Contracts and signing');
    await contracts.locator('.help-wizard__header').click();
    const first = contracts.locator('.help-step').first();
    await expect(first.locator('.producer-lock')).toContainText('Sending contracts for signature is part of the Producer plan');
    // The guide's own words never name a price. The lock note does that.
    await expect(first.locator('.help-step__text')).not.toContainText('$');
    await expect(first.getByRole('button', { name: 'Open Contracts' })).toBeVisible();
    // A locked step is not held against the wizard.
    await expect(wizardRow(page, 'Money and the season').locator('.help-wizard__chip')).toHaveText('Not started');

    await page.getByRole('button', { name: 'Start the tour' }).click();
    await page.getByRole('button', { name: 'Add it and start' }).click();
    await expect(dock(page)).toContainText('step 1 of');
    await nextUntil(page, 'Contracts');
    await expect(page.getByRole('heading', { name: 'Contracts', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add for signature' })).toHaveCount(0);
    await expect(dock(page)).toContainText('Sending contracts for signature is part of the Producer plan. Filing agreements you already have is not.');
    // With no button to point at, the outline falls back to the page's own lock note.
    await expect(page.locator('.app-main [data-tour="producer-lock"][data-tour-on]')).toBeVisible();
    await nextStep(page).click();
    await expect(dockTitle(page)).toHaveText('Season report');
    await expect(dock(page)).toContainText('It is part of the Producer plan.');
    await expect(page.getByRole('heading', { name: 'Season report', level: 1 })).toBeVisible();
    await nextStep(page).click();
    await expect(dockTitle(page)).toHaveText('Expenses and the email list');
    expect(errors).toEqual([]);
  });
});

test.describe('Help & setup', () => {
  test('a wizard takes you to the real page and knows when the step is done', async ({ page, context }) => {
    await installFakeApi(context, emptyState());
    await signUpAndOnboard(page);
    await openHelp(page);
    // Finding the page is the end of the offer on the Shows list.
    const rolodex = wizardRow(page, 'Your Rolodex');
    await expect(rolodex.locator('.help-wizard__chip')).toHaveText('Not started');
    await rolodex.locator('.help-wizard__header').click();
    await expect(rolodex.locator('.help-wizard__header')).toHaveAttribute('aria-expanded', 'true');
    await rolodex.getByRole('button', { name: 'Open the Rolodex' }).first().click();

    await expect(page.getByRole('heading', { name: /Rolodex/, level: 1 })).toBeVisible();
    await expect(dock(page)).toContainText('Rolodex: step 1 of 4');
    await expect(dockTitle(page)).toHaveText('Add someone');
    await expect(page.locator('[data-tour="rolodex-add"][data-tour-on]')).toBeVisible();
    await expect(dock(page).locator('.guide-dock__done')).toHaveCount(0);

    await page.locator('.rolodex__input').first().fill('Ada Lovelace');
    await page.locator('.rolodex__add').click();
    await expect(page.locator('.rolodex__item')).toHaveCount(1);
    await expect(dock(page).locator('.guide-dock__done')).toHaveText('Done');

    await dock(page).getByRole('button', { name: 'Back to Help & setup' }).click();
    await expect(page.getByRole('heading', { name: 'Help & setup', level: 1 })).toBeVisible();
    await expect(dock(page)).toHaveCount(0);
    // The row it came from is still open, and counts what the account holds.
    await expect(rolodex.locator('.help-wizard__chip')).toHaveText('1 of 4');
    await expect(rolodex.locator('.help-step').first()).toContainText('Done');

    // A step with nothing to read is ticked by hand, and the tick is kept.
    const music = wizardRow(page, 'Music and walk-ons');
    await music.locator('.help-wizard__header').click();
    await expect(rolodex.locator('.help-wizard__header')).toHaveAttribute('aria-expanded', 'false');
    await music.getByLabel('I have done this').check();
    await expect(music.locator('.help-wizard__chip')).toHaveText('1 of 4');

    await gotoTab(page, 'Shows');
    await expect(page.getByRole('complementary', { name: 'Getting started' })).toHaveCount(0);
  });

  test('a step that needs a show leads to making one first', async ({ page, context }) => {
    await installFakeApi(context, emptyState());
    await signUpAndOnboard(page);
    await openHelp(page);
    const promo = wizardRow(page, 'Flyer and Post copy');
    await promo.locator('.help-wizard__header').click();
    await promo.getByRole('button', { name: 'Make a show first' }).first().click();
    await expect(page.getByPlaceholder('Show name')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dock(page)).toContainText('First show: step 1 of 4');
    await dock(page).getByRole('button', { name: 'Close guide' }).press('Enter');
    await expect(dock(page)).toHaveCount(0);
    expect(await focusKept(page)).toBe(true);

    // With a show of their own, the same step opens it.
    await createShow(page, 'Friday Laughs');
    await openHelp(page);
    // The page opens on the wizard that was last used: the one it led to.
    await expect(wizardRow(page, 'Your first show').locator('.help-wizard__header')).toHaveAttribute('aria-expanded', 'true');
    await expect(wizardRow(page, 'Your first show').locator('.help-wizard__chip')).toHaveText('1 of 4');
    await promo.locator('.help-wizard__header').click();
    await promo.getByRole('button', { name: 'Open a show' }).first().click();
    await expect(page.getByRole('heading', { name: 'Friday Laughs', level: 1 })).toBeVisible();
    await expect(dock(page)).toContainText('Flyer and post: step 1 of 3');
    await expect(page.locator('[data-tour="show-flyer"][data-tour-on]')).toBeVisible();
  });

  // With nobody on the bill there is no Post copy or headshot button yet.
  test('the lineup steps on a show with nobody on it point at adding someone first', async ({ page, context }) => {
    await installFakeApi(context, emptyState());
    await signUpAndOnboard(page);
    await createShow(page, 'Friday Laughs');
    await openHelp(page);
    const promo = wizardRow(page, 'Flyer and Post copy');
    if ((await promo.locator('.help-wizard__header').getAttribute('aria-expanded')) !== 'true') await promo.locator('.help-wizard__header').click();
    await promo.locator('.help-step').filter({ hasText: 'Copy the lineup for a post' }).getByRole('button', { name: 'Open a show' }).click();
    await expect(page.getByRole('heading', { name: 'Friday Laughs', level: 1 })).toBeVisible();
    await expect(dockTitle(page)).toHaveText('Copy the lineup for a post');
    await expect(dock(page).locator('.guide-dock__body')).toContainText('add someone to the lineup first');
    await expect(page.locator('[data-tour-on]')).toHaveCount(1);
    await expect(page.locator('[data-tour="lineup-name"][data-tour-on]')).toBeVisible();

    await nextStep(page).click();
    await expect(dockTitle(page)).toHaveText('Download headshots');
    await expect(dock(page).locator('.guide-dock__body')).toContainText('add someone to the lineup first');
    await expect(page.locator('[data-tour="lineup-name"][data-tour-on]')).toBeVisible();
  });

  test('a wizard step keeps the control it points at clear of the card', async ({ page, context }) => {
    await installFakeApi(context, emptyState());
    await signUpAndOnboard(page);
    await createShow(page, 'Friday Laughs');
    await openHelp(page);
    const first = wizardRow(page, 'Your first show');
    if ((await first.locator('.help-wizard__header').getAttribute('aria-expanded')) !== 'true') await first.locator('.help-wizard__header').click();
    await first.locator('.help-step').filter({ hasText: 'Pick the sections you need' }).getByRole('button', { name: 'Show me' }).click();
    await expect(page.getByRole('heading', { name: 'Friday Laughs', level: 1 })).toBeVisible();
    await expect(dockTitle(page)).toHaveText('Pick the sections you need');
    await expectClearOfCard(page);

    // Back to Help & setup: the card goes, and focus does not fall off the page.
    await dock(page).getByRole('button', { name: 'Back to Help & setup' }).press('Enter');
    await expect(page.getByRole('heading', { name: 'Help & setup', level: 1 })).toBeVisible();
    await expect(dock(page)).toHaveCount(0);
    expect(await focusKept(page)).toBe(true);
  });

  test('is read-only in co-producer view, with no tour and nothing stored', async ({ page, context, browser }) => {
    const state = emptyState();
    await installFakeApi(context, state);
    await signUpAndOnboard(page);
    await expect(page.locator('.sync-status--saved')).toBeVisible();
    const token = addCoproducerLink(state, { ...accountKeys(), label: 'Sam Rivera', expiresAt: Date.now() + 86_400_000 });
    const coproducer = await openAsCoproducer(browser, state, token);

    await expect(coproducer.getByRole('heading', { name: 'Shows', level: 1 })).toBeVisible();
    await expect(coproducer.locator('.guide-offer')).toHaveCount(0);

    await gotoTab(coproducer, 'More');
    await coproducer.locator('.more-item').filter({ hasText: 'Help & setup' }).click();
    await expect(coproducer.getByRole('heading', { name: 'Help & setup', level: 1 })).toBeVisible();
    await expect(coproducer.getByText('You are helping with Sam Rivera’s shows. Anything you change here is sent to them to approve.')).toBeVisible();
    await expect(coproducer.getByRole('button', { name: 'Start the tour' })).toHaveCount(0);
    await expect(coproducer.locator('.help-wizard__title')).toHaveText([
      'Your Rolodex',
      'Contracts and signing',
      'Viewer link and Run Show',
      'Music and walk-ons',
      'Flyer and Post copy',
      'Money and the season',
    ]);
    await expect(coproducer.locator('.help-wizard__chip')).toHaveCount(0);

    const rolodex = wizardRow(coproducer, 'Your Rolodex');
    await rolodex.locator('.help-wizard__header').click();
    await expect(rolodex.getByLabel('I have done this')).toHaveCount(0);
    await rolodex.getByRole('button', { name: 'Open the Rolodex' }).first().click();
    await expect(coproducer.getByRole('heading', { name: /Rolodex/, level: 1 })).toBeVisible();
    // It only navigates: no card, nothing asked of the owner, nothing kept on this device.
    await expect(coproducer.locator('.guide-dock')).toHaveCount(0);
    expect(Object.keys(state.coproducerRequests)).toEqual([]);
    const kept = await coproducer.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('showrunner:guide:')));
    expect(kept).toEqual([]);
    await coproducer.context().close();
  });
});
