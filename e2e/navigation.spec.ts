import { expect, test } from '@playwright/test';
import { emptyState, installFakeApi } from './support/fake-api.mjs';
import { gotoTab, signUpAndOnboard } from './support/app';

test.describe('navigation', () => {
  test('the bar holds five tabs and More leads to the paperwork', async ({ page, context }) => {
    await installFakeApi(context, emptyState());
    await signUpAndOnboard(page);

    await expect(page.locator('.bottom-nav__item')).toHaveText([
      'Shows',
      'Rolodex',
      'Music',
      'More',
      'Settings',
    ]);

    await gotoTab(page, 'More');
    await expect(page.locator('.more-item__label')).toHaveText([
      'Contracts',
      'Email list',
      'Expenses',
    ]);

    // Opening a page behind More keeps More lit, and back returns there
    // rather than dumping the producer on the show list.
    for (const row of ['Contracts', 'Email list', 'Expenses']) {
      await page.locator('.more-item').filter({ hasText: row }).click();
      await expect(page.locator('.bottom-nav__item--active')).toHaveText('More');
      await page.locator('.page-header__back').first().click();
      await expect(page.getByRole('heading', { name: 'More', level: 1 })).toBeVisible();
    }
  });

  test('every tab label fits its tab at the narrowest phone', async ({ page, context }) => {
    // Seven tabs did not fit, and the captions had to be shrunk twice to hide
    // it. This is the measurement that caught it, kept so it cannot come back.
    await installFakeApi(context, emptyState());
    await signUpAndOnboard(page);
    await page.setViewportSize({ width: 320, height: 700 });

    const overflow = await page.$$eval('.bottom-nav__item', (items) =>
      items.map((item) => {
        const label = item.querySelector('span')!;
        return label.getBoundingClientRect().width - item.getBoundingClientRect().width;
      }),
    );
    for (const px of overflow) expect(px).toBeLessThan(0);
  });
});
