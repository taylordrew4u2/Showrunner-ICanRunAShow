import { expect, test } from '@playwright/test';
import { emptyState, installFakeApi } from './support/fake-api.mjs';
import { createShow, openSection, signUpAndOnboard } from './support/app';

/**
 * The announcement, composed from the booking.
 *
 * Worth an end-to-end test because the value is entirely in the assembly: the
 * caption has to carry the show's own details and the handles saved against the
 * bill, and it has to name whoever has no handle. A post that quietly drops
 * someone is the failure this is meant to prevent.
 */
test.describe('post copy', () => {
  test('writes the bill, the details and the handles, and names who is missing one', async ({
    page,
    context,
  }) => {
    await installFakeApi(context, emptyState());

    await signUpAndOnboard(page);
    await createShow(page, 'Basement Comedy Hour');

    // One comic with a handle saved, one without.
    await page.locator('button').filter({ hasText: /^Contact details$/ }).click();
    await page.getByLabel('Performer name').fill('Mona Sable');
    await page.getByLabel('Instagram handle').fill('@monasable');
    await page.locator('button').filter({ hasText: /^Add$/ }).first().click();
    await expect(page.locator('.section-list')).toContainText('Mona Sable');

    await page.getByLabel('Performer name').fill('Dev Okonjo');
    await page.locator('button').filter({ hasText: /^Add$/ }).first().click();
    await expect(page.locator('.section-list')).toContainText('Dev Okonjo');

    await openSection(page, 'Basic Info');
    await page.getByLabel('Venue Name').fill('The Cellar');

    await page.locator('button').filter({ hasText: /^Post copy$/ }).click();

    const caption = page.locator('.announce__text');
    await expect(caption).toBeVisible();
    await expect(caption).toHaveValue(/BASEMENT COMEDY HOUR/);
    await expect(caption).toHaveValue(/The Cellar/);
    await expect(caption).toHaveValue(/Mona Sable @monasable/);

    // The person with nothing saved is named, not silently left off.
    await expect(page.locator('.announce__missing')).toContainText('Dev Okonjo');
  });
});
