import { expect, test } from '@playwright/test';
import { emptyState, installFakeApi } from './support/fake-api.mjs';
import { createShow, gotoTab, signUpAndOnboard } from './support/app';

test.describe('the Producer plan', () => {
  test('a producer upgrades from Settings and comes back on the Producer plan', async ({ page, context }) => {
    const state = emptyState({ billingConfigured: true });
    await installFakeApi(context, state);
    await signUpAndOnboard(page);

    await gotoTab(page, 'Settings');
    const card = page.locator('.plan-card');
    await expect(card).toContainText('Open Mic');
    await card.getByRole('button', { name: /Upgrade to Producer/ }).click();

    // Back from checkout: Settings opens on its own and says so.
    await expect(page.locator('.plan-card__notice')).toHaveText('Thanks — you’re on the Producer plan.');
    await expect(card).toContainText('Producer');
    await expect(card.getByRole('button', { name: 'Manage billing' })).toBeVisible();
    await expect(page).not.toHaveURL(/billing=/);
  });

  test('before Stripe is set up, nobody is offered a button that cannot work', async ({ page, context }) => {
    await installFakeApi(context, emptyState());
    await signUpAndOnboard(page);
    await gotoTab(page, 'Settings');
    const card = page.locator('.plan-card');
    await expect(card).toContainText('everything is free during early access');
    await expect(card.getByRole('button', { name: /Upgrade/ })).toHaveCount(0);
  });
});

test.describe('Producer features on the free plan', () => {
  test('each one says what it is and how to get it, and upgrading opens them up', async ({ page, context }) => {
    await installFakeApi(context, emptyState({ billingConfigured: true }));
    await signUpAndOnboard(page);
    await createShow(page, 'Basement Laughs');

    // Live link: a new one is Producer.
    await page.locator('button[aria-label="More"], .more-menu__trigger').first().click();
    await page.getByText('Viewer link', { exact: true }).click();
    await expect(page.locator('.viewer-link-modal .producer-lock')).toContainText('A live link for your audience');
    await expect(page.getByRole('button', { name: 'Generate link & publish' })).toHaveCount(0);
    await page.locator('.viewer-link-modal__actions').getByRole('button', { name: 'Close' }).click();

    // Season report and contracts.
    await gotoTab(page, 'More');
    await page.locator('.more-item').filter({ hasText: 'Season report' }).click();
    await expect(page.locator('.producer-lock')).toContainText('The Season report');
    await page.locator('.page-header__back').first().click();
    await page.locator('.more-item').filter({ hasText: 'Contracts' }).click();
    await expect(page.locator('.producer-lock')).toContainText('Sending contracts for signature');
    await expect(page.getByRole('button', { name: 'Add for signature' })).toHaveCount(0);

    // Stage remote.
    await gotoTab(page, 'Settings');
    await expect(page.locator('.producer-lock').filter({ hasText: 'Pairing a stage remote' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pair a remote' })).toHaveCount(0);

    // Upgrading from any of them goes through checkout and comes back unlocked.
    await page.locator('.producer-lock').filter({ hasText: 'Pairing a stage remote' }).getByRole('button', { name: 'Upgrade' }).click();
    await expect(page.locator('.plan-card__notice')).toHaveText('Thanks — you’re on the Producer plan.');
    await expect(page.getByRole('button', { name: 'Pair a remote' })).toBeVisible();
    await gotoTab(page, 'More');
    await page.locator('.more-item').filter({ hasText: 'Season report' }).click();
    await expect(page.getByRole('heading', { name: 'Season report', level: 1 })).toBeVisible();
    await expect(page.locator('.producer-lock')).toHaveCount(0);
  });

  test('a producer whose plan cannot be checked keeps every feature', async ({ page, context }) => {
    // No Stripe on the server: nothing is locked, as before billing existed.
    await installFakeApi(context, emptyState());
    await signUpAndOnboard(page);
    await gotoTab(page, 'More');
    await page.locator('.more-item').filter({ hasText: 'Contracts' }).click();
    await expect(page.getByRole('button', { name: 'Add for signature' })).toBeVisible();
    await expect(page.locator('.producer-lock')).toHaveCount(0);
  });
});
