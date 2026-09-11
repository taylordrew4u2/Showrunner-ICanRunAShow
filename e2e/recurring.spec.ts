import { expect, test } from '@playwright/test';
import { emptyState, installFakeApi } from './support/fake-api.mjs';
import { createShow, gotoTab, signUpAndOnboard } from './support/app';

for (const action of ['duplicate', 'repeat'] as const) {
  test(`${action} starts empty lineups without changing the original or Rolodex`, async ({ page, context }) => {
    await installFakeApi(context, emptyState());
    await signUpAndOnboard(page);
    await createShow(page, 'Tuesday Night Laughs', '2026-04-07');
    await page.getByPlaceholder('Performer name').fill('Ada Cole');
    await page.locator('button').filter({ hasText: /^Add$/ }).first().click();
    await expect(page.locator('.section-list-item__name').filter({ hasText: 'Ada Cole' })).toBeVisible();

    await page.locator('button[aria-label="More"], .more-menu__trigger').first().click();
    if (action === 'repeat') {
      await page.getByText('Repeat this show…').click();
      await expect(page.locator('.repeat-show__sub')).toContainText('empty performer lineup');
      await expect(page.locator('.repeat-show__rule')).toHaveText('Every week on Tuesday');
      await expect(page.locator('.repeat-show__dates li')).toHaveCount(4);
      await expect(page.locator('.repeat-show__dates li').first()).toContainText(/14/);
      await expect(page.locator('.repeat-show__dates li').last()).toContainText(/May|5/);
      await page.locator('.repeat-show__actions .btn--primary').click();
    } else {
      await page.getByText('Duplicate show', { exact: true }).click();
    }

    const count = action === 'repeat' ? 5 : 2;
    await expect(page.locator('.show-card')).toHaveCount(count);
    // Inspect every new date, not merely the first card (which may be the original).
    for (let i = 0; i < count; i++) {
      const card = page.locator('.show-card').nth(i);
      const date = card.locator('.show-card__date-day');
      const day = await date.count() ? await date.textContent() : '';
      const isOriginal = day?.trim() === '7';
      await card.click();
      await expect(page.locator('.show-detail')).toBeVisible();
      const performer = page.locator('.section-list-item__name').filter({ hasText: 'Ada Cole' });
      if (isOriginal) await expect(performer).toBeVisible();
      else {
        await expect(performer).toHaveCount(0);
        await expect(page.getByPlaceholder('Performer name')).toBeVisible();
      }
      await gotoTab(page, 'Shows');
    }
    // The contact is still filed once, with no copy created by either action.
    await gotoTab(page, 'Rolodex');
    await expect(page.locator('.rolodex__item')).toHaveCount(1);
    await expect(page.locator('.rolodex__name')).toHaveText('Ada Cole');
    await page.reload();
    await gotoTab(page, 'Shows');
    await expect(page.locator('.show-card')).toHaveCount(count);
  });
}
