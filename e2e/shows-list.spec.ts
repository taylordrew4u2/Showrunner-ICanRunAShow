import { expect, test } from '@playwright/test';
import { emptyState, installFakeApi } from './support/fake-api.mjs';
import { createShow, daysFromNow, gotoTab, signUpAndOnboard } from './support/app';

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

  test('takes a past show off the dashboard and keeps it in History', async ({ page, context }) => {
    await installFakeApi(context, emptyState());
    await signUpAndOnboard(page);
    // A night that has already happened. The panel only leads with a show
    // still ahead, so this one leaves it saying "Nothing dated yet".
    await createShow(page, 'Last Tuesday', '2020-01-07');
    await gotoTab(page, 'Shows');

    await expect(page.locator('.dash-next__name')).toHaveCount(0);
    await expect(page.locator('.show-card')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'No upcoming shows' })).toBeVisible();
    await page.getByRole('button', { name: 'History', exact: true }).click();
    await expect(page.locator('.dash')).toHaveCount(0);
    await expect(page.locator('.show-card')).toHaveCount(1);
    await expect(page.locator('.show-card')).toContainText('Last Tuesday');
    await page.locator('.show-card__open').click();
    await expect(page.getByRole('heading', { name: 'Last Tuesday', level: 1 })).toBeVisible();
  });

  test('removes completed and cancelled shows immediately, with their records in History', async ({ page, context }) => {
    await installFakeApi(context, emptyState());
    await signUpAndOnboard(page);
    await createShow(page, 'Finished Show');
    await page.getByRole('combobox', { name: 'Show status' }).selectOption('completed');
    await gotoTab(page, 'Shows');
    await expect(page.getByRole('heading', { name: 'No upcoming shows' })).toBeVisible();
    await expect(page.locator('.dash-next__name, .show-card')).toHaveCount(0);

    await createShow(page, 'Cancelled Show');
    await page.getByRole('combobox', { name: 'Show status' }).selectOption('cancelled');
    await gotoTab(page, 'Shows');
    await expect(page.locator('.dash-next__name, .show-card')).toHaveCount(0);
    await page.getByRole('button', { name: 'History', exact: true }).click();
    await expect(page.locator('.show-card')).toHaveCount(2);
    await expect(page.locator('.shows-grid')).toContainText('Finished Show');
    await expect(page.locator('.shows-grid')).toContainText('Cancelled Show');
    await page.getByPlaceholder('Search').fill('Finished');
    await expect(page.locator('.show-card')).toHaveCount(1);
    await page.getByRole('button', { name: 'Upcoming', exact: true }).click();
    await expect(page.getByPlaceholder('Search')).toHaveValue('');
  });

  test('refreshes an open dashboard after midnight without removing a running show', async ({ page, context }) => {
    const tonight = daysFromNow(0);
    const [year, month, day] = tonight.split('-').map(Number);
    await page.clock.install({ time: new Date(year, month - 1, day, 23, 50) });
    await installFakeApi(context, emptyState());
    await signUpAndOnboard(page);
    await createShow(page, 'Tonight Only', tonight);
    await gotoTab(page, 'Shows');
    await createShow(page, 'Still Running', tonight);
    await page.getByRole('combobox', { name: 'Show status' }).selectOption('in-progress');
    await gotoTab(page, 'Shows');
    await expect(page.locator('.show-card')).toHaveCount(2);

    await page.clock.fastForward(11 * 60_000);
    await expect(page.locator('.dash-next__name')).toHaveText('Still Running');
    await page.getByRole('button', { name: 'History', exact: true }).click();
    await expect(page.locator('.show-card')).toHaveCount(1);
    await expect(page.locator('.show-card')).toContainText('Tonight Only');
    await expect(page.locator('.show-card')).not.toContainText('Still Running');
  });

  test('lists every show once there is more than one', async ({ page, context }) => {
    await installFakeApi(context, emptyState());
    await signUpAndOnboard(page);
    await createShow(page, 'Basement Comedy Hour');
    await gotoTab(page, 'Shows');
    await createShow(page, 'Tuesday Open Mic', daysFromNow(12));
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
