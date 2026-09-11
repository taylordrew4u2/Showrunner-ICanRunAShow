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

test('the desktop hamburger frees the workspace and dismisses naturally', async ({ page, context }) => {
  await installFakeApi(context, emptyState());
  await page.setViewportSize({ width: 1280, height: 900 });
  await signUpAndOnboard(page);
  const toggle = page.getByRole('button', { name: 'Open navigation menu' });
  const nav = page.getByRole('navigation', { name: 'Primary navigation' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(nav).toBeHidden();
  const app = (await page.locator('.app').boundingBox())!;
  const main = (await page.locator('.app-main').boundingBox())!;
  expect(main.width).toBeCloseTo(app.width, 0);
  await toggle.click();
  await expect(nav).toBeVisible();
  await expect(page.locator('.bottom-nav__item--active')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(nav).toBeHidden();
  await expect(toggle).toBeFocused();
  await toggle.click();
  await page.locator('.app-main').click({ position: { x: 800, y: 600 } });
  await expect(nav).toBeHidden();
  await gotoTab(page, 'Settings');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(nav).toBeHidden();
  await toggle.click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(toggle).toBeHidden();
  await expect(nav).toBeVisible();
  await gotoTab(page, 'Shows');
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(nav).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});
