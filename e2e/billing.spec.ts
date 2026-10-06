import { expect, test } from '@playwright/test';
import { emptyState, installFakeApi } from './support/fake-api.mjs';
import { gotoTab, signUpAndOnboard } from './support/app';

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
