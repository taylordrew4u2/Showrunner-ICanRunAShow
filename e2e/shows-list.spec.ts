import { expect, test } from '@playwright/test';
import { emptyState, installFakeApi } from './support/fake-api.mjs';
import { createShow, gotoTab, signUpAndOnboard } from './support/app';

/**
 * A list of one is not a list. The panel at the top of the Shows page already
 * gives the next show's name, its date, what it still needs and two ways into
 * it — and underneath, "ALL SHOWS 1" printed the same show again. A producer
 * with one show booked saw it twice and a filter that narrowed one show to
 * one show.
 */
test.describe('the shows list', () => {
  test('does not print the only show twice, but comes back to answer a search', async ({ page, context }) => {
    await installFakeApi(context, emptyState());
    await signUpAndOnboard(page);
    await createShow(page, 'Basement Comedy Hour');
    await gotoTab(page, 'Shows');

    await expect(page.locator('.dash-next__name')).toHaveText('Basement Comedy Hour');
    await expect(page.locator('.shows-list__heading')).toHaveCount(0);
    await expect(page.locator('.show-card')).toHaveCount(0);
    // Nothing to narrow, so nothing offering to narrow it. (The panel shows
    // a tappable summary on a phone and the names themselves with room for
    // them; neither should be here.)
    await expect(page.locator('.dash-panel--attention')).toHaveCount(0);

    // A search is a question about the list, so the list has to answer it.
    await page.getByPlaceholder('Search').fill('Basement');
    await expect(page.locator('.show-card')).toHaveCount(1);
    await page.getByPlaceholder('Search').fill('nothing matches this');
    await expect(page.getByText('No matches')).toBeVisible();
  });

  test('never hides the only show when the panel is not showing it', async ({ page, context }) => {
    // The panel leads with a show that is dated and still ahead. An undated
    // show — or, the one that would really have bitten, the morning after the
    // only show on the books, once it auto-completes — leaves the panel saying
    // "Nothing dated yet". Hiding the list on top of that put the producer's
    // only show nowhere on the page at all.
    await installFakeApi(context, emptyState());
    await signUpAndOnboard(page);
    // A night that has already happened. The panel only leads with a show
    // still ahead, so this one leaves it saying "Nothing dated yet".
    await createShow(page, 'Last Tuesday', '2020-01-07');
    await gotoTab(page, 'Shows');

    await expect(page.locator('.dash-next__name')).toHaveCount(0);
    await expect(page.locator('.show-card')).toHaveCount(1);
    await expect(page.locator('.show-card')).toContainText('Last Tuesday');
  });

  test('lists every show once there is more than one', async ({ page, context }) => {
    await installFakeApi(context, emptyState());
    await signUpAndOnboard(page);
    await createShow(page, 'Basement Comedy Hour');
    await gotoTab(page, 'Shows');
    await createShow(page, 'Tuesday Open Mic', '2026-09-22');
    await gotoTab(page, 'Shows');

    await expect(page.locator('.shows-list__heading')).toBeVisible();
    await expect(page.locator('.show-card')).toHaveCount(2);
    await expect(page.locator('.dash-panel--attention')).toBeVisible();
  });
});

/**
 * A rolodex you cannot read the names in is not a rolodex. On a phone the
 * row's name block was the only thing allowed to shrink, so "Ask for details"
 * and "Edit" squeezed it to nothing: four contacts rendered as the letters
 * D, P, M and N with no names at all.
 */
test('a Rolodex row shows the name at any width', async ({ page, context }) => {
  await installFakeApi(context, emptyState());
  await signUpAndOnboard(page);
  await gotoTab(page, 'Rolodex');
  await page.locator('.rolodex__input').first().fill('Priya Raghunathan');
  await page.locator('button').filter({ hasText: /^Add$/ }).first().click();

  const name = page.locator('.rolodex__name');
  await expect(name).toHaveText('Priya Raghunathan');
  // Not merely present — actually wide enough to read, beside a button that
  // is still its full self.
  expect((await name.boundingBox())!.width).toBeGreaterThan(120);
  await expect(page.locator('button:has-text("Ask for details")')).toBeVisible();
});
