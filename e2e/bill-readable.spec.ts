import { expect, test } from '@playwright/test';
import { emptyState, installFakeApi } from './support/fake-api.mjs';
import { createShow, signUpAndOnboard } from './support/app';

async function addPerformer(page: import('@playwright/test').Page, name: string) {
  const toggle = page.locator('.lineup-add__toggle');
  if ((await toggle.count()) && /Add performer/.test((await toggle.textContent()) ?? '')) {
    await toggle.click();
  }
  await page.locator('.lineup-add__name').fill(name);
  await page.locator('.lineup-add__submit').click();
}

/**
 * The bill is what a producer reads on stage between sets. A name on it is the
 * one thing that cannot be abbreviated — and between the two reorder arrows
 * and the profile control, a phone was rendering "Priya Raghunathan" as
 * "Priya Raghu…".
 */
test.describe('the bill', () => {
  test('shows a long performer name in full', async ({ page, context }) => {
    await installFakeApi(context, emptyState());
    await signUpAndOnboard(page);
    await createShow(page, 'Basement Comedy Hour');
    if ((await page.locator('.lineup-add__name').count()) === 0) {
      await page.locator('button', { hasText: 'Performers' }).first().click();
    }
    await addPerformer(page, 'Priya Raghunathan');

    const name = page.locator('.section-list-item__name').filter({ hasText: 'Priya' }).first();
    await expect(name).toHaveText('Priya Raghunathan');
    // Not cut off: an ellipsised name overflows its own box.
    const overflowing = await name.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(overflowing).toBe(false);
    // And the reorder controls are still there to be tapped.
    await expect(page.locator('.section-list-item__buttons').first()).toBeVisible();
  });

  test('says who was filed in the Rolodex as one sentence', async ({ page, context }) => {
    await installFakeApi(context, emptyState());
    await signUpAndOnboard(page);
    await createShow(page, 'Basement Comedy Hour');
    if ((await page.locator('.lineup-add__name').count()) === 0) {
      await page.locator('button', { hasText: 'Performers' }).first().click();
    }
    await addPerformer(page, 'Priya Raghunathan');

    // The note is a flex row of a tick and a sentence. Left bare, the bold
    // name and the words after it became two flex items in separate columns,
    // each wrapping on its own, and a long name printed over its own sentence.
    const text = page.locator('.section-filed__text');
    await expect(text).toContainText('Priya Raghunathan was added to your Rolodex');
  });
});
