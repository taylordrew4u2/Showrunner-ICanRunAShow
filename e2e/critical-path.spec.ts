import { expect, test } from '@playwright/test';
import { emptyState, installFakeApi } from './support/fake-api';
import { createShow, openSection, signUpAndOnboard } from './support/app';

/**
 * The path a producer walks on a show night. If any step of this breaks, the
 * app has failed at the one moment it cannot fail — in a venue, with an
 * audience already in the room.
 */
test.describe('critical path', () => {
  test('sign up, build a show, and open it in live mode', async ({ page, context }) => {
    const state = emptyState();
    await installFakeApi(context, state);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await signUpAndOnboard(page);
    await createShow(page, 'Basement Comedy Hour');

    // A new show opens with the two sections the app exists for. It used to
    // open with neither, which read as the app being broken.
    await expect(page.getByText('Performers', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('Schedule', { exact: false }).first()).toBeVisible();

    await openSection(page, 'Schedule');
    const build = page.locator('.schedule-choice__option').first();
    if (await build.count()) await build.click();

    await page.locator('input[aria-label="Description"]').fill('Doors open');
    await page.locator('button[aria-label="Add cue"]').click();
    await expect(page.locator('.cue-list')).toContainText('Doors open');

    // A cue can be changed after the fact, not only added.
    await page.locator('button[aria-label="Edit"]').first().click();
    const description = page.getByLabel('Edit segment');
    await expect(description).toBeVisible();
    await description.fill('Doors open (house music)');
    await description.press('Enter');
    await expect(page.locator('.cue-list')).toContainText('house music');

    await page.locator('button:has-text("Run Show")').first().click();
    await expect(page.locator('.run-show')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('live mode is driveable from the keyboard alone', async ({ page, context }) => {
    // What makes a Bluetooth clicker work as a stage remote: it pairs as a
    // keyboard, so every control has to be reachable without a pointer.
    const state = emptyState();
    await installFakeApi(context, state);

    await signUpAndOnboard(page);
    await createShow(page, 'Keyboard Test');
    await openSection(page, 'Schedule');
    const build = page.locator('.schedule-choice__option').first();
    if (await build.count()) await build.click();
    for (const cue of ['Opening set', 'Headliner']) {
      await page.locator('input[aria-label="Description"]').fill(cue);
      await page.locator('button[aria-label="Add cue"]').click();
    }
    await page.locator('button:has-text("Run Show")').first().click();
    await expect(page.locator('.run-show')).toBeVisible();

    const position = page.locator('.rs-clock__pos');
    // textContent, not innerText: the label is uppercased in CSS, and
    // toHaveText compares the underlying text rather than the rendered form.
    const before = (await position.textContent())!.trim();
    await page.keyboard.press('ArrowRight');
    await expect(position).not.toHaveText(before);
    await page.keyboard.press('ArrowLeft');
    await expect(position).toHaveText(before);

    // The music key must not throw when the cue has no audio attached.
    await page.keyboard.press('s');
    await expect(page.locator('.run-show')).toBeVisible();
  });
});
