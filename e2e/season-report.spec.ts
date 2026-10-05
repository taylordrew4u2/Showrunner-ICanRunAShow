import { expect, test } from '@playwright/test';
import { emptyState, installFakeApi } from './support/fake-api.mjs';
import { createShow, gotoTab, signUpAndOnboard } from './support/app';

test.describe('season report', () => {
  test('a producer sees their shows added up and can copy a pitch for a venue', async ({ page, context }) => {
    await installFakeApi(context, emptyState());
    await signUpAndOnboard(page);
    await createShow(page, 'Basement Laughs');

    await gotoTab(page, 'More');
    await page.locator('.more-item').filter({ hasText: 'Season report' }).click();
    await expect(page.getByRole('heading', { name: 'Season report', level: 1 })).toBeVisible();

    // All time, so a show ten days out still counts when the suite runs in late December.
    await page.getByRole('button', { name: 'All time' }).click();
    const runTile = page.locator('.season__tile').filter({ hasText: 'Shows run' });
    await expect(runTile).toContainText('0');
    await expect(runTile).toContainText('1 coming up');
    await expect(page.locator('.season__pitch-text')).toContainText('We have 1 show on the calendar.');
  });
});

test.describe('sample show', () => {
  test('a new producer can open a sample night and press Run Show on it', async ({ page, context }) => {
    await installFakeApi(context, emptyState());
    await signUpAndOnboard(page);

    await page.getByRole('button', { name: 'Try a sample show' }).click();
    await expect(page.getByRole('heading', { name: 'Sample Show — try Run Show', level: 1 })).toBeVisible();
    await page.locator('button:has-text("Run Show")').first().click();
    await expect(page.locator('.run-show')).toBeVisible();
    await expect(page.locator('.run-show')).toContainText('Headliner');
    await page.keyboard.press('Escape');

    // Nobody made up lands in the Rolodex.
    await gotoTab(page, 'Rolodex');
    await expect(page.locator('.rolodex__item')).toHaveCount(0);
  });
});
